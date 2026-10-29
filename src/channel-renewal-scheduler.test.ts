import type { Logger } from "@logtape/logtape";
import Database from "better-sqlite3";
import type { Queue } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RENEW_OFFSET_MS, startChannelRenewalScheduler } from "./channel-renewal-scheduler";
import { ChannelRepository } from "./channel-repository";
import { migrate } from "./db";
import type { Account } from "./types";

const POLL_MS = 15_000;
const NOW = new Date("2026-10-29T12:00:00.000Z");

const account = (id: string, name: string) => ({ id, name }) as unknown as Account;
const ALICE = account("acc-1", "Alice");
const BOB = account("acc-2", "Bob");

describe("startChannelRenewalScheduler", () => {
	let channels: ChannelRepository;
	let queue: { add: ReturnType<typeof vi.fn> };
	let logger: { info: ReturnType<typeof vi.fn>; getChild: ReturnType<typeof vi.fn> };
	let childLogger: { error: ReturnType<typeof vi.fn> };
	let timer: NodeJS.Timeout | undefined;

	const start = (accounts: Account[] = [ALICE]) => {
		timer = startChannelRenewalScheduler(
			logger as unknown as Logger,
			accounts,
			channels,
			queue as unknown as Queue,
			POLL_MS,
		);
		return timer;
	};

	const expiresIn = (accountId: string, ms: number) =>
		channels.upsert(accountId, `channel-${accountId}`, `resource-${accountId}`, Date.now() + ms);

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		const db = new Database(":memory:");
		migrate(db);
		channels = new ChannelRepository(db);
		queue = { add: vi.fn(async () => undefined) };
		childLogger = { error: vi.fn() };
		logger = { info: vi.fn(), getChild: vi.fn(() => childLogger) };
	});

	afterEach(() => {
		if (timer) {
			clearInterval(timer);
		}
		timer = undefined;
		vi.useRealTimers();
	});

	it("does nothing before the first interval has elapsed", async () => {
		start();

		await vi.advanceTimersByTimeAsync(POLL_MS - 1);

		expect(queue.add).not.toHaveBeenCalled();
	});

	it("enqueues a renewal when no channel exists for the account", async () => {
		start();

		await vi.advanceTimersByTimeAsync(POLL_MS);

		expect(queue.add).toHaveBeenCalledTimes(1);
		const [name, data, options] = queue.add.mock.calls[0];
		expect(name).toBe("renew-channel");
		expect(data).toEqual({ accountId: "acc-1" });
		expect(options.jobId).toMatch(/^renew-channel-acc-1-2026-10-29T12:00:15\.000Z$/);
		expect(options.deduplication).toEqual({ id: "renew-channel-acc-1" });
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Channel renewal due for Alice"));
	});

	it("enqueues a renewal when the channel expires within the renew offset", async () => {
		expiresIn(ALICE.id, 10_000);
		start();

		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(POLL_MS);

		expect(queue.add).toHaveBeenCalledTimes(1);
	});

	it("enqueues a renewal for a channel that is already expired", async () => {
		expiresIn(ALICE.id, -60_000);
		start();

		await vi.advanceTimersByTimeAsync(POLL_MS);

		expect(queue.add).toHaveBeenCalledTimes(1);
	});

	it("treats exactly the renew offset as due and a bit more as not due", async () => {
		// the check runs one poll interval after start, so subtract it from the remaining lifetime
		expiresIn(ALICE.id, POLL_MS + RENEW_OFFSET_MS);
		start();
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(queue.add).toHaveBeenCalledTimes(1);

		queue.add.mockClear();
		expiresIn(BOB.id, POLL_MS + RENEW_OFFSET_MS + 1);
		clearInterval(timer);
		start([BOB]);
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(queue.add).not.toHaveBeenCalled();
	});

	it("leaves a channel with plenty of lifetime alone", async () => {
		expiresIn(ALICE.id, 30 * 60_000);
		start();

		await vi.advanceTimersByTimeAsync(POLL_MS * 4);

		expect(queue.add).not.toHaveBeenCalled();
	});

	it("polls on every interval", async () => {
		start();

		await vi.advanceTimersByTimeAsync(POLL_MS * 3);

		expect(queue.add).toHaveBeenCalledTimes(3);
	});

	it("decides per account", async () => {
		expiresIn(ALICE.id, 30 * 60_000);
		expiresIn(BOB.id, 5_000);
		start([ALICE, BOB]);

		await vi.advanceTimersByTimeAsync(POLL_MS);

		expect(queue.add).toHaveBeenCalledTimes(1);
		expect(queue.add.mock.calls[0][1]).toEqual({ accountId: "acc-2" });
	});

	it("logs a failure for one account and still checks the others", async () => {
		queue.add.mockImplementation(async (_name: string, data: { accountId: string }) => {
			if (data.accountId === "acc-1") {
				throw new Error("redis down");
			}
		});
		start([ALICE, BOB]);

		await vi.advanceTimersByTimeAsync(POLL_MS);

		expect(queue.add).toHaveBeenCalledTimes(2);
		expect(logger.getChild).toHaveBeenCalledWith("Alice");
		expect(childLogger.error).toHaveBeenCalledWith(expect.stringContaining("redis down"), expect.anything());
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Bob"));
	});

	it("keeps polling after a failed tick", async () => {
		queue.add.mockRejectedValueOnce(new Error("redis down"));
		start();

		await vi.advanceTimersByTimeAsync(POLL_MS * 2);

		expect(queue.add).toHaveBeenCalledTimes(2);
	});

	it("stops polling when the returned timer is cleared", async () => {
		const interval = start();
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(queue.add).toHaveBeenCalledTimes(1);

		clearInterval(interval);
		await vi.advanceTimersByTimeAsync(POLL_MS * 5);

		expect(queue.add).toHaveBeenCalledTimes(1);
	});
});
