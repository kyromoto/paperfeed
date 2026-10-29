import type { Logger } from "@logtape/logtape";
import type { Queue } from "bullmq";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleHealthCheck, handleWebhook } from "./controllers";
import type { DriveMonitor } from "./drive-monitor";
import type { Config } from "./types";

const ACCOUNT = { id: "acc-1", name: "Alice" };
const CHANNEL_ID = "channel-1";
const TOKEN = "good-token";

const config = (collectChangesSec = 5) =>
	({ server: { queue: { debounce: { collectChangesSec } } }, accounts: [ACCOUNT] }) as unknown as Config;

const fakeMonitor = (channelId: string | null = CHANNEL_ID) =>
	({
		getChannelId: () => channelId,
		verifyChannelToken: (token: string | undefined) => token === TOKEN,
	}) as unknown as DriveMonitor;

const request = (headers: Record<string, string>) => {
	const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
	return { get: (name: string) => lower[name.toLowerCase()], headers: lower } as unknown as Request;
};

const response = () => {
	const res = { status: vi.fn(), send: vi.fn(), json: vi.fn() };
	res.status.mockReturnValue(res);
	return res;
};

const validHeaders = (state = "update") => ({
	"X-Goog-Channel-Id": CHANNEL_ID,
	"X-Goog-Resource-State": state,
	"X-Goog-Channel-Token": TOKEN,
});

describe("handleWebhook", () => {
	let queue: { name: string; add: ReturnType<typeof vi.fn> };
	let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
	let handler: (req: Request, res: Response) => Promise<void>;

	const setup = (cfg = config(), monitors = new Map([[ACCOUNT.id, fakeMonitor()]])) => {
		logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		queue = { name: "collect-changes", add: vi.fn(async () => undefined) };
		handler = handleWebhook(logger as unknown as Logger, cfg, queue as unknown as Queue, monitors);
	};

	beforeEach(() => setup());

	it("queues a debounced collect-changes job for a valid notification and answers 200", async () => {
		const res = response();

		await handler(request(validHeaders()), res as unknown as Response);

		expect(queue.add).toHaveBeenCalledTimes(1);
		const [name, data, options] = queue.add.mock.calls[0];
		expect(name).toBe("collect-changes");
		expect(data).toEqual({ accountId: ACCOUNT.id });
		expect(options.jobId).toMatch(/^collect-changes-acc-1-\d{4}-\d{2}-\d{2}T/);
		expect(options.deduplication).toEqual({ id: "collect-changes-acc-1", ttl: 5000, extend: true, replace: true });
		expect(options.delay).toBe(5000);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.send).toHaveBeenCalledWith("OK");
	});

	it("derives debounce delay and ttl from the configuration", async () => {
		setup(config(15));

		await handler(request(validHeaders()), response() as unknown as Response);

		const options = queue.add.mock.calls[0][2];
		expect(options.delay).toBe(15000);
		expect(options.deduplication.ttl).toBe(15000);
	});

	it.each([
		"update",
		"change",
		"add",
		"remove",
		"trash",
		"untrash",
	])("queues a job for the resource state %s", async (state) => {
		await handler(request(validHeaders(state)), response() as unknown as Response);

		expect(queue.add).toHaveBeenCalledTimes(1);
	});

	it.each(["sync", "SYNC"])("ignores the sync handshake (%s)", async (state) => {
		const res = response();

		await handler(request(validHeaders(state)), res as unknown as Response);

		expect(queue.add).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.send).toHaveBeenCalledWith("OK");
	});

	it.each([
		["channel id", { "X-Goog-Resource-State": "update", "X-Goog-Channel-Token": TOKEN }],
		["resource state", { "X-Goog-Channel-Id": CHANNEL_ID, "X-Goog-Channel-Token": TOKEN }],
		["both", {}],
	])("ignores requests without the %s header but still answers 200", async (_label, headers) => {
		const res = response();

		await handler(request(headers), res as unknown as Response);

		expect(queue.add).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("without required headers"), expect.anything());
	});

	it("ignores an unknown channel id", async () => {
		const res = response();

		await handler(request({ ...validHeaders(), "X-Goog-Channel-Id": "someone-else" }), res as unknown as Response);

		expect(queue.add).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("No account found"), expect.anything());
	});

	it("ignores a monitor without an active channel", async () => {
		setup(config(), new Map([[ACCOUNT.id, fakeMonitor(null)]]));

		await handler(request(validHeaders()), response() as unknown as Response);

		expect(queue.add).not.toHaveBeenCalled();
	});

	it("ignores a channel that belongs to a monitor without a configured account", async () => {
		setup(config(), new Map([["unconfigured", fakeMonitor()]]));

		await handler(request(validHeaders()), response() as unknown as Response);

		expect(queue.add).not.toHaveBeenCalled();
	});

	it.each([
		["wrong token", { ...validHeaders(), "X-Goog-Channel-Token": "wrong-but-secret" }],
		["missing token", { "X-Goog-Channel-Id": CHANNEL_ID, "X-Goog-Resource-State": "update" }],
	])("ignores a notification with a %s, still answers 200 and never logs the token", async (_label, headers) => {
		const res = response();

		await handler(request(headers), res as unknown as Response);

		expect(queue.add).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(200);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Invalid or missing channel token"),
			expect.anything(),
		);
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("wrong-but-secret");
	});

	it("checks the token before honoring the sync state", async () => {
		await handler(
			request({ ...validHeaders("sync"), "X-Goog-Channel-Token": "wrong" }),
			response() as unknown as Response,
		);

		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Invalid or missing channel token"),
			expect.anything(),
		);
	});

	it("answers 200 and logs an error when queueing fails, so Google does not redeliver in a loop", async () => {
		queue.add.mockRejectedValue(new Error("redis down"));
		const res = response();

		await handler(request(validHeaders()), res as unknown as Response);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.send).toHaveBeenCalledWith("OK");
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("redis down"), expect.anything());
	});

	it("routes the notification to the account that owns the channel", async () => {
		const other = { id: "acc-2", name: "Bob" };
		const cfg = { ...config(), accounts: [ACCOUNT, other] } as unknown as Config;
		setup(
			cfg,
			new Map([
				[ACCOUNT.id, fakeMonitor("channel-of-alice")],
				[other.id, fakeMonitor(CHANNEL_ID)],
			]),
		);

		await handler(request(validHeaders()), response() as unknown as Response);

		expect(queue.add.mock.calls[0][1]).toEqual({ accountId: "acc-2" });
	});
});

describe("handleHealthCheck", () => {
	it("answers 200 with status OK", async () => {
		const res = response();

		await handleHealthCheck()(request({}), res as unknown as Response);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ status: "OK" });
	});
});
