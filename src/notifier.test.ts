import type { Logger } from "@logtape/logtape";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
	attachNotificationLogging,
	createNotifier,
	type FinalFailure,
	formatFailure,
	formatSummary,
	formatTest,
	makeNotificationProcessor,
	type WebhookBody,
} from "./notifier";

const URL = "https://hookshot.example.com/webhook/0c1b-secret-path";

const failure = (overrides: Partial<FinalFailure> = {}): FinalFailure => ({
	queue: "process-changes",
	label: "invoice.pdf processing",
	error: "Paperless upload failed",
	attemptsMade: 1,
	attempts: 1,
	...overrides,
});

describe("notifier", () => {
	let post: Mock<(url: string, body: WebhookBody) => Promise<unknown>>;
	let logger: { warn: ReturnType<typeof vi.fn> };

	const notifierWith = (windowMs = 60_000) => {
		const notifier = createNotifier({ url: URL, logger: logger as unknown as Logger, post, windowMs });
		if (!notifier) {
			throw new Error("expected a notifier");
		}
		return notifier;
	};

	beforeEach(() => {
		vi.useFakeTimers();
		post = vi.fn<(url: string, body: WebhookBody) => Promise<unknown>>(async () => ({ status: 200 }));
		logger = { warn: vi.fn() };
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("createNotifier", () => {
		it.each([undefined, ""])("returns undefined without a webhook url (%s)", (url) => {
			expect(createNotifier({ url, logger: logger as unknown as Logger, post })).toBeUndefined();
		});

		it("never calls the network without a webhook url", () => {
			createNotifier({ url: undefined, logger: logger as unknown as Logger, post });

			expect(post).not.toHaveBeenCalled();
		});
	});

	describe("message", () => {
		it("posts a json body with username and a text that names queue, job, error and attempts", async () => {
			notifierWith().notifyFinalFailure(failure());
			await vi.advanceTimersByTimeAsync(0);

			expect(post).toHaveBeenCalledTimes(1);
			const [url, body] = post.mock.calls[0];
			expect(url).toBe(URL);
			expect(body.username).toBe("paperfeed");
			expect(body.text).toBe(
				[
					"job failed permanently",
					"- queue: `process-changes`",
					"- job: `invoice.pdf processing`",
					"- error: `Paperless upload failed`",
					"- attempts: `1/1`",
				].join("\n"),
			);
		});

		it("shows the attempts of a retried job", () => {
			expect(formatFailure(failure({ queue: "renew-channel", attemptsMade: 3, attempts: 3 }))).toContain(
				"- attempts: `3/3`",
			);
		});

		it("shows a question mark when the attempts are unknown (job already gone)", () => {
			expect(formatFailure(failure({ attemptsMade: undefined, attempts: undefined }))).toContain("- attempts: `?/?`");
		});

		it("does not repeat the username: Hookshot already prefixes it in bold", () => {
			for (const text of [formatFailure(failure()), formatSummary("process-changes", 2), formatTest()]) {
				expect(text.startsWith("paperfeed")).toBe(false);
			}
		});

		it("puts one fact per line as a bullet list below a title line", () => {
			const lines = formatFailure(failure()).split("\n");

			expect(lines[0]).toBe("job failed permanently");
			expect(lines.slice(1).every((line) => line.startsWith("- "))).toBe(true);
		});

		it("keeps values out of Markdown: code spans, no line breaks, no backticks inside", () => {
			const text = formatFailure(
				failure({ label: "my_file*name*.pdf processing", error: "line one\nline two with `ticks`" }),
			);

			expect(text).toContain("- job: `my_file*name*.pdf processing`");
			expect(text).toContain("- error: `line one line two with 'ticks'`");
			expect(text.split("\n")).toHaveLength(5);
		});

		it("makes the test message look like a real failure so the rendering can be checked", () => {
			const lines = formatTest().split("\n");

			expect(lines[0]).toBe("test notification");
			expect(lines.filter((line) => line.startsWith("- "))).toHaveLength(4);
		});

		it("truncates a very long error message and says so", () => {
			const text = formatFailure(failure({ error: "x".repeat(2000) }));

			expect(text).toContain("… (truncated)");
			expect(text.length).toBeLessThan(700);
		});

		it("keeps a message of exactly 500 characters unchanged", () => {
			expect(formatFailure(failure({ error: "y".repeat(500) }))).not.toContain("truncated");
		});

		it("builds a summary that names the count and the queue", () => {
			expect(formatSummary("process-changes", 4)).toContain("4 more jobs failed permanently");
			expect(formatSummary("process-changes", 1)).toContain("1 more job failed permanently");
			expect(formatSummary("process-changes", 4)).toContain("- queue: `process-changes`");
		});
	});

	describe("best effort", () => {
		it("logs a failed delivery as a warning without the webhook url and does not throw", async () => {
			post.mockRejectedValue(
				Object.assign(new Error(`connect ECONNREFUSED while calling ${URL}`), { code: "ECONNREFUSED" }),
			);

			expect(() => notifierWith().notifyFinalFailure(failure())).not.toThrow();
			await vi.advanceTimersByTimeAsync(0);

			expect(logger.warn).toHaveBeenCalledTimes(1);
			const logged = JSON.stringify(logger.warn.mock.calls);
			expect(logged).not.toContain("secret-path");
			expect(logged).toContain("ECONNREFUSED");
		});

		it("reports the http status of an error response", async () => {
			post.mockRejectedValue(
				Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } }),
			);

			notifierWith().notifyFinalFailure(failure());
			await vi.advanceTimersByTimeAsync(0);

			expect(logger.warn.mock.calls[0][1]).toEqual({
				error: expect.objectContaining({ status: 404 }),
			});
		});

		it("returns before the delivery finishes", () => {
			post.mockReturnValue(new Promise(() => undefined));

			expect(notifierWith().notifyFinalFailure(failure())).toBeUndefined();
		});
	});

	describe("flood control per queue", () => {
		it("sends the first failure immediately and holds back the next ones within the window", async () => {
			const notifier = notifierWith();

			notifier.notifyFinalFailure(failure());
			notifier.notifyFinalFailure(failure({ label: "b.pdf processing" }));
			notifier.notifyFinalFailure(failure({ label: "c.pdf processing" }));
			await vi.advanceTimersByTimeAsync(59_999);

			expect(post).toHaveBeenCalledTimes(1);
		});

		it("reports the held back failures in one summary when the window ends", async () => {
			const notifier = notifierWith();
			for (let i = 0; i < 5; i += 1) {
				notifier.notifyFinalFailure(failure({ label: `file-${i}.pdf processing` }));
			}

			await vi.advanceTimersByTimeAsync(60_000);

			expect(post).toHaveBeenCalledTimes(2);
			expect(post.mock.calls[1][1].text).toContain("4 more jobs failed permanently");
			expect(post.mock.calls[1][1].text).toContain("- queue: `process-changes`");
		});

		it("sends no summary when nothing was held back", async () => {
			notifierWith().notifyFinalFailure(failure());

			await vi.advanceTimersByTimeAsync(5 * 60_000);

			expect(post).toHaveBeenCalledTimes(1);
		});

		it("allows a new immediate message once a quiet window has passed", async () => {
			const notifier = notifierWith();
			notifier.notifyFinalFailure(failure());
			await vi.advanceTimersByTimeAsync(60_000);

			notifier.notifyFinalFailure(failure({ label: "later.pdf processing" }));
			await vi.advanceTimersByTimeAsync(0);

			expect(post).toHaveBeenCalledTimes(2);
			expect(post.mock.calls[1][1].text).toContain("later.pdf processing");
		});

		it("never sends more than one message per window, a summary opens the next window", async () => {
			const notifier = notifierWith();
			notifier.notifyFinalFailure(failure());
			notifier.notifyFinalFailure(failure({ label: "b.pdf processing" }));
			await vi.advanceTimersByTimeAsync(60_000);
			expect(post).toHaveBeenCalledTimes(2);

			notifier.notifyFinalFailure(failure({ label: "c.pdf processing" }));
			await vi.advanceTimersByTimeAsync(59_000);
			expect(post).toHaveBeenCalledTimes(2);

			await vi.advanceTimersByTimeAsync(1_000);
			expect(post).toHaveBeenCalledTimes(3);
			expect(post.mock.calls[2][1].text).toContain("1 more job failed permanently");
		});

		it("tracks queues independently", async () => {
			const notifier = notifierWith();

			notifier.notifyFinalFailure(failure({ queue: "process-changes" }));
			notifier.notifyFinalFailure(failure({ queue: "renew-channel", label: "acc channel renewal" }));
			await vi.advanceTimersByTimeAsync(0);

			expect(post).toHaveBeenCalledTimes(2);
			expect(post.mock.calls.map(([, body]) => body.text)).toEqual([
				expect.stringContaining("- queue: `process-changes`"),
				expect.stringContaining("- queue: `renew-channel`"),
			]);
		});

		it("does not keep the process alive for the summary timer", () => {
			const unref = vi.fn();
			const setTimer = vi.fn(() => ({ unref }));
			const notifier = createNotifier({ url: URL, logger: logger as unknown as Logger, post, setTimer });

			notifier?.notifyFinalFailure(failure());

			expect(unref).toHaveBeenCalledTimes(1);
		});
	});

	describe("sendTest", () => {
		it("posts a test message", async () => {
			await notifierWith().sendTest();

			expect(post).toHaveBeenCalledWith(URL, { username: "paperfeed", text: formatTest() });
		});

		it("rejects with the status and without the webhook url", async () => {
			post.mockRejectedValue(Object.assign(new Error(`Request failed for ${URL}`), { response: { status: 404 } }));

			const error = await notifierWith()
				.sendTest()
				.catch((reason: Error) => reason);

			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toContain("HTTP 404");
			expect((error as Error).message).not.toContain("secret-path");
		});

		it("rejects with the error code of a network failure", async () => {
			post.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:8008"), { code: "ECONNREFUSED" }));

			await expect(notifierWith().sendTest()).rejects.toThrow("ECONNREFUSED");
		});
	});

	describe("with a durable queue (enqueue)", () => {
		let enqueue: Mock<(body: WebhookBody) => Promise<unknown>>;

		const queuedNotifier = () => {
			const notifier = createNotifier({ url: URL, logger: logger as unknown as Logger, post, enqueue });
			if (!notifier) {
				throw new Error("expected a notifier");
			}
			return notifier;
		};

		beforeEach(() => {
			enqueue = vi.fn<(body: WebhookBody) => Promise<unknown>>(async () => undefined);
		});

		it("hands the message to the queue instead of posting it", async () => {
			queuedNotifier().notifyFinalFailure(failure());
			await vi.advanceTimersByTimeAsync(0);

			expect(enqueue).toHaveBeenCalledTimes(1);
			expect(enqueue).toHaveBeenCalledWith({ username: "paperfeed", text: formatFailure(failure()) });
			expect(post).not.toHaveBeenCalled();
		});

		it("never puts the webhook url into the queued message", async () => {
			queuedNotifier().notifyFinalFailure(failure());
			await vi.advanceTimersByTimeAsync(0);

			expect(JSON.stringify(enqueue.mock.calls)).not.toContain("secret-path");
		});

		it("keeps the flood control: one message per window and a summary of the rest", async () => {
			const notifier = queuedNotifier();
			for (let i = 0; i < 4; i += 1) {
				notifier.notifyFinalFailure(failure({ label: `file-${i}.pdf processing` }));
			}

			await vi.advanceTimersByTimeAsync(59_999);
			expect(enqueue).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(1);
			expect(enqueue).toHaveBeenCalledTimes(2);
			expect(enqueue.mock.calls[1][0].text).toContain("3 more jobs failed permanently");
		});

		it("logs a warning and does not throw when the queue is not reachable", async () => {
			enqueue.mockRejectedValue(new Error("Connection is closed."));

			expect(() => queuedNotifier().notifyFinalFailure(failure())).not.toThrow();
			await vi.advanceTimersByTimeAsync(0);

			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Failed to queue notification: Connection is closed."),
				expect.anything(),
			);
		});

		it("still sends the test message directly so that notify-test can report the result", async () => {
			await queuedNotifier().sendTest();

			expect(post).toHaveBeenCalledTimes(1);
			expect(enqueue).not.toHaveBeenCalled();
		});
	});

	describe("flush", () => {
		it("queues a summary that is still held back right away and cancels its timer", async () => {
			const enqueue = vi.fn<(body: WebhookBody) => Promise<unknown>>(async () => undefined);
			const notifier = createNotifier({ url: URL, logger: logger as unknown as Logger, post, enqueue });
			notifier?.notifyFinalFailure(failure());
			notifier?.notifyFinalFailure(failure({ label: "b.pdf processing" }));
			notifier?.notifyFinalFailure(failure({ label: "c.pdf processing" }));
			await vi.advanceTimersByTimeAsync(0);
			expect(enqueue).toHaveBeenCalledTimes(1);

			await notifier?.flush();

			expect(enqueue).toHaveBeenCalledTimes(2);
			expect(enqueue.mock.calls[1][0].text).toContain("2 more jobs failed permanently");

			await vi.advanceTimersByTimeAsync(5 * 60_000);
			expect(enqueue).toHaveBeenCalledTimes(2);
		});

		it("queues one summary per queue with held back failures", async () => {
			const enqueue = vi.fn<(body: WebhookBody) => Promise<unknown>>(async () => undefined);
			const notifier = createNotifier({ url: URL, logger: logger as unknown as Logger, post, enqueue });
			for (const queue of ["process-changes", "renew-channel"]) {
				notifier?.notifyFinalFailure(failure({ queue }));
				notifier?.notifyFinalFailure(failure({ queue }));
			}
			await vi.advanceTimersByTimeAsync(0);
			enqueue.mockClear();

			await notifier?.flush();

			expect(enqueue).toHaveBeenCalledTimes(2);
		});

		it("does nothing when no summary is held back", async () => {
			const enqueue = vi.fn<(body: WebhookBody) => Promise<unknown>>(async () => undefined);
			const notifier = createNotifier({ url: URL, logger: logger as unknown as Logger, post, enqueue });
			notifier?.notifyFinalFailure(failure());
			await vi.advanceTimersByTimeAsync(0);
			enqueue.mockClear();

			await notifier?.flush();

			expect(enqueue).not.toHaveBeenCalled();
		});

		it("does nothing when nothing happened at all", async () => {
			await expect(notifierWith().flush()).resolves.toBeUndefined();

			expect(post).not.toHaveBeenCalled();
		});

		it("does not let the timer of the flushed window end the next window of the same queue too early", async () => {
			const enqueue = vi.fn<(body: WebhookBody) => Promise<unknown>>(async () => undefined);
			const notifier = createNotifier({ url: URL, logger: logger as unknown as Logger, post, enqueue });
			notifier?.notifyFinalFailure(failure());
			await notifier?.flush();

			await vi.advanceTimersByTimeAsync(1_000);
			notifier?.notifyFinalFailure(failure({ label: "b.pdf processing" }));
			notifier?.notifyFinalFailure(failure({ label: "c.pdf processing" }));
			// the first window would have ended here
			await vi.advanceTimersByTimeAsync(59_000);
			expect(enqueue).toHaveBeenCalledTimes(2);

			await vi.advanceTimersByTimeAsync(1_000);
			expect(enqueue).toHaveBeenCalledTimes(3);
			expect(enqueue.mock.calls[2][0].text).toContain("1 more job failed permanently");
		});

		it("starts a fresh window after the flush", async () => {
			const enqueue = vi.fn<(body: WebhookBody) => Promise<unknown>>(async () => undefined);
			const notifier = createNotifier({ url: URL, logger: logger as unknown as Logger, post, enqueue });
			notifier?.notifyFinalFailure(failure());
			await notifier?.flush();
			enqueue.mockClear();

			notifier?.notifyFinalFailure(failure({ label: "after.pdf processing" }));
			await vi.advanceTimersByTimeAsync(0);

			expect(enqueue).toHaveBeenCalledTimes(1);
			expect(enqueue.mock.calls[0][0].text).toContain("after.pdf processing");
		});
	});

	describe("notification processor (worker of the queue)", () => {
		const body: WebhookBody = { username: "paperfeed", text: "job failed permanently" };

		it("posts the stored message to the webhook", async () => {
			await makeNotificationProcessor({ url: URL, post })({ data: body });

			expect(post).toHaveBeenCalledWith(URL, body);
		});

		it("throws so that BullMQ retries, with status and without the webhook url", async () => {
			post.mockRejectedValue(Object.assign(new Error(`Request to ${URL} failed`), { response: { status: 502 } }));

			const error = await makeNotificationProcessor({ url: URL, post })({ data: body }).catch(
				(reason: Error) => reason,
			);

			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toContain("HTTP 502");
			expect((error as Error).message).not.toContain("secret-path");
		});

		it("reports the code of a network error", async () => {
			post.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:8008"), { code: "ECONNREFUSED" }));

			await expect(makeNotificationProcessor({ url: URL, post })({ data: body })).rejects.toThrow("ECONNREFUSED");
		});
	});

	describe("delivery logging", () => {
		const setup = () => {
			let handler: (job: unknown, error: Error) => void = () => undefined;
			const worker = {
				on: (_event: string, callback: typeof handler) => {
					handler = callback;
				},
			};
			const log = { warn: vi.fn(), error: vi.fn() };
			attachNotificationLogging(log as unknown as Logger, worker as never);
			return { fail: (job: unknown, message = "HTTP 502: bad gateway") => handler(job, new Error(message)), log };
		};

		const job = (attemptsMade: number) => ({ attemptsMade, opts: { attempts: 6 } });

		it.each([1, 2, 5])("warns about attempt %i of 6 because it will be retried", (attemptsMade) => {
			const { fail, log } = setup();

			fail(job(attemptsMade));

			expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(`attempt ${attemptsMade}/6`));
			expect(log.error).not.toHaveBeenCalled();
		});

		it("logs an error once all attempts are used up", () => {
			const { fail, log } = setup();

			fail(job(6));

			expect(log.error).toHaveBeenCalledWith(expect.stringContaining("could not be delivered after 6 attempts"));
			expect(log.warn).not.toHaveBeenCalled();
		});

		it("treats a failure without a job as final", () => {
			const { fail, log } = setup();

			fail(undefined);

			expect(log.error).toHaveBeenCalledTimes(1);
		});
	});
});
