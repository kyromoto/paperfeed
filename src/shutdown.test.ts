import type { Logger } from "@logtape/logtape";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ShutdownResources, setupShutdownHandler } from "./shutdown";

type Handler = (...args: unknown[]) => unknown;

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("setupShutdownHandler", () => {
	let handlers: Record<string, Handler>;
	let order: string[];
	let exit: ReturnType<typeof vi.spyOn>;
	let logger: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; fatal: ReturnType<typeof vi.fn> };
	let resources: ShutdownResources;
	let interval: NodeJS.Timeout;

	const record = (name: string) => () => {
		order.push(name);
	};

	beforeEach(() => {
		vi.useFakeTimers();
		handlers = {};
		order = [];
		vi.spyOn(process, "on").mockImplementation(((event: string, handler: Handler) => {
			handlers[event] = handler;
			return process;
		}) as never);
		exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
		logger = { info: vi.fn(), error: vi.fn(), fatal: vi.fn() };
		interval = setInterval(() => undefined, 1000);
		const clearSpy = vi.spyOn(globalThis, "clearInterval");
		clearSpy.mockImplementation(((handle: NodeJS.Timeout) => {
			if (handle === interval) {
				order.push("scheduler");
			}
		}) as never);
		resources = {
			server: {
				close: (callback: (error?: Error) => void) => {
					order.push("server");
					callback();
				},
				closeIdleConnections: record("idle-connections"),
			},
			renewalSchedulerInterval: interval,
			workers: [{ close: async () => void order.push("worker-1") }, { close: async () => void order.push("worker-2") }],
			monitors: new Map([
				["a", { stop: async () => void order.push("monitor-a") }],
				["b", { stop: async () => void order.push("monitor-b") }],
			]),
			notifier: { flush: async () => void order.push("notifier-flush") },
			queues: [{ close: async () => void order.push("queue-1") }, { close: async () => void order.push("queue-2") }],
			redisConnection: { quit: async () => void order.push("redis") },
			db: { close: record("db") },
		} as unknown as ShutdownResources;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	const setup = (timeoutMs?: number) => setupShutdownHandler(logger as unknown as Logger, resources, timeoutMs);

	it("registers handlers for SIGINT, SIGTERM, SIGHUP and uncaught exceptions", () => {
		setup();

		expect(Object.keys(handlers).sort()).toEqual(["SIGHUP", "SIGINT", "SIGTERM", "uncaughtException"]);
	});

	it("does nothing until a signal arrives", async () => {
		setup();

		await flush();

		expect(order).toEqual([]);
		expect(exit).not.toHaveBeenCalled();
	});

	it.each(["SIGINT", "SIGTERM", "SIGHUP"])("shuts down in order on %s and exits with 0", async (signal) => {
		setup();

		handlers[signal]();
		await flush();

		expect(order).toEqual([
			"server",
			"idle-connections",
			"scheduler",
			"worker-1",
			"worker-2",
			"monitor-a",
			"monitor-b",
			"notifier-flush",
			"queue-1",
			"queue-2",
			"redis",
			"db",
		]);
		expect(exit).toHaveBeenCalledTimes(1);
		expect(exit).toHaveBeenCalledWith(0);
		expect(logger.info).toHaveBeenCalledWith("Goodbye!");
	});

	it("waits for active jobs before it stops the monitors and closes redis", async () => {
		let finishJob: () => void = () => undefined;
		resources.workers = [
			{
				close: () =>
					new Promise<void>((resolve) => {
						order.push("worker-closing");
						finishJob = () => {
							order.push("worker-done");
							resolve();
						};
					}),
			},
		] as unknown as ShutdownResources["workers"];
		setup();

		handlers.SIGTERM();
		await flush();

		expect(order).toContain("worker-closing");
		expect(order).not.toContain("monitor-a");
		expect(order).not.toContain("redis");
		expect(exit).not.toHaveBeenCalled();

		finishJob();
		await flush();

		expect(order.indexOf("worker-done")).toBeLessThan(order.indexOf("monitor-a"));
		expect(exit).toHaveBeenCalledWith(0);
	});

	it("continues with the remaining steps when one step fails and still exits with 0", async () => {
		resources.redisConnection = {
			quit: async () => {
				throw new Error("redis already gone");
			},
		} as unknown as ShutdownResources["redisConnection"];
		resources.monitors = new Map([
			[
				"a",
				{
					stop: async () => {
						throw new Error("drive unreachable");
					},
				},
			],
			["b", { stop: async () => void order.push("monitor-b") }],
		]) as unknown as ShutdownResources["monitors"];
		setup();

		handlers.SIGTERM();
		await flush();

		expect(order).toContain("monitor-b");
		expect(order).toContain("db");
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("redis already gone"), expect.anything());
		expect(exit).toHaveBeenCalledWith(0);
	});

	it("keeps going when the http server cannot be closed", async () => {
		resources.server = {
			close: (callback: (error?: Error) => void) => callback(new Error("not running")),
			closeIdleConnections: () => undefined,
		} as unknown as ShutdownResources["server"];
		setup();

		handlers.SIGTERM();
		await flush();

		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("not running"), expect.anything());
		expect(order).toContain("db");
		expect(exit).toHaveBeenCalledWith(0);
	});

	it("hands over pending notifications after the workers and monitors and before it closes the queues", async () => {
		setup();

		handlers.SIGTERM();
		await flush();

		const at = (name: string) => order.indexOf(name);
		expect(at("notifier-flush")).toBeGreaterThan(at("worker-2"));
		expect(at("notifier-flush")).toBeGreaterThan(at("monitor-b"));
		expect(at("notifier-flush")).toBeLessThan(at("queue-1"));
	});

	it("keeps going when handing over the notifications fails", async () => {
		resources.notifier = {
			flush: async () => {
				throw new Error("redis already gone");
			},
		};
		setup();

		handlers.SIGTERM();
		await flush();

		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("redis already gone"), expect.anything());
		expect(order).toContain("queue-1");
		expect(order).toContain("db");
		expect(exit).toHaveBeenCalledWith(0);
	});

	it("shuts down as before when notifications are not configured", async () => {
		resources.notifier = undefined;
		setup();

		handlers.SIGTERM();
		await flush();

		expect(order).not.toContain("notifier-flush");
		expect(order).toContain("db");
		expect(exit).toHaveBeenCalledWith(0);
	});

	it("ignores further signals while a shutdown is already running", async () => {
		setup();

		handlers.SIGTERM();
		handlers.SIGINT();
		handlers.SIGHUP();
		await flush();

		expect(order.filter((entry) => entry === "db")).toHaveLength(1);
		expect(exit).toHaveBeenCalledTimes(1);
	});

	it("logs an uncaught exception as fatal, shuts down and exits with 1", async () => {
		setup();

		handlers.uncaughtException(new Error("boom"));
		await flush();

		expect(logger.fatal).toHaveBeenCalledWith(expect.stringContaining("boom"), expect.anything());
		expect(order).toContain("db");
		expect(exit).toHaveBeenCalledWith(1);
	});

	it("forces the exit with code 1 when the shutdown takes longer than the timeout", async () => {
		resources.workers = [
			{ close: () => new Promise<void>(() => undefined) },
		] as unknown as ShutdownResources["workers"];
		setup(1000);

		handlers.SIGTERM();
		await vi.advanceTimersByTimeAsync(999);
		expect(exit).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);

		expect(exit).toHaveBeenCalledWith(1);
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("did not finish within 1000ms"));
		expect(order).not.toContain("db");
	});
});
