import type { Logger } from "@logtape/logtape";
import axios from "axios";
import type { Job, Worker } from "bullmq";

const SEND_TIMEOUT_MS = 5_000;
const WINDOW_MS = 60_000;
const MAX_ERROR_LENGTH = 500;
const USERNAME = "paperfeed";

export type FinalFailure = {
	queue: string;
	label: string;
	error: string;
	attemptsMade?: number;
	attempts?: number;
};

export type WebhookBody = { username: string; text: string };

export type Notifier = {
	/** Fire and forget: failures to deliver are logged, never thrown. */
	notifyFinalFailure: (failure: FinalFailure) => void;
	/** Sends a test message directly and rejects with a message that does not contain the webhook URL. */
	sendTest: () => Promise<void>;
	/** Hands over summaries that are still held back by the flood control, for a graceful shutdown. */
	flush: () => Promise<void>;
};

export type NotifierOptions = {
	url: string | undefined;
	logger: Logger;
	post?: (url: string, body: WebhookBody) => Promise<unknown>;
	/** Hands the message to a durable queue instead of sending it right away. Without it the message is posted directly. */
	enqueue?: (body: WebhookBody) => Promise<unknown>;
	setTimer?: (callback: () => void, ms: number) => { unref?: () => void };
	clearTimer?: (timer: unknown) => void;
	windowMs?: number;
};

const defaultPost = (url: string, body: WebhookBody) => axios.post(url, body, { timeout: SEND_TIMEOUT_MS });

/** Compact description of a failed delivery. Never contains the webhook URL, which is a secret. */
const describeSendError = (error: unknown, url: string) => {
	const details = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
	const response = details.response as { status?: unknown } | undefined;
	const status = [response?.status, details.status].find((value): value is number => typeof value === "number");
	const message = (error instanceof Error ? error.message : String(error)).split(url).join("<webhook url>");

	return { status, code: typeof details.code === "string" ? details.code : undefined, message };
};

/** Error for a failed delivery: status or code plus a message, never the webhook URL. */
const deliveryError = (error: unknown, url: string) => {
	const description = describeSendError(error, url);

	return new Error(
		[description.status ? `HTTP ${description.status}` : description.code, description.message]
			.filter(Boolean)
			.join(": "),
	);
};

const truncate = (text: string) =>
	text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}… (truncated)` : text;

// Hookshot renders `text` as Markdown and prefixes the username in bold. A bullet list keeps one line per fact in the
// rendered message and stays readable in the plain text body. Values go into code spans so that file names or error
// messages (underscores, asterisks, ...) are not interpreted as Markdown.
const inline = (value: string) => `\`${value.replace(/\s*\r?\n\s*/g, " ").replace(/`/g, "'")}\``;

const message = (title: string, items: [key: string, value: string][], note?: string) =>
	[title, ...items.map(([key, value]) => `- ${key}: ${inline(value)}`), ...(note ? [`- ${note}`] : [])].join("\n");

export const formatFailure = (failure: FinalFailure) =>
	message("job failed permanently", [
		["queue", failure.queue],
		["job", failure.label],
		["error", truncate(failure.error)],
		["attempts", `${failure.attemptsMade ?? "?"}/${failure.attempts ?? "?"}`],
	]);

export const formatSummary = (queue: string, count: number) =>
	message(
		`${count} more ${count === 1 ? "job" : "jobs"} failed permanently`,
		[["queue", queue]],
		"see the logs or Bull Board for details",
	);

export const formatTest = () =>
	message("test notification", [
		["queue", "notify-test"],
		["job", "sample job"],
		["error", "this is only a test, nothing failed"],
		["attempts", "1/1"],
	]);

/**
 * Returns undefined when no webhook is configured, so callers can skip the whole feature.
 *
 * Flood control per queue: the first permanent failure is sent right away and opens a window. Further failures in the
 * window are only counted and reported in one summary when the window ends. A window stays open while failures keep
 * arriving, so a queue never sends more than one message per window.
 */
export const createNotifier = (options: NotifierOptions): Notifier | undefined => {
	const { url, logger } = options;

	if (!url) {
		return undefined;
	}

	const post = options.post ?? defaultPost;
	const setTimer = options.setTimer ?? setTimeout;
	const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as NodeJS.Timeout));
	const windowMs = options.windowMs ?? WINDOW_MS;
	const windows = new Map<string, { suppressed: number; timer: unknown }>();
	const { enqueue } = options;

	const sendBestEffort = async (text: string) => {
		const body = { username: USERNAME, text };

		try {
			await (enqueue ? enqueue(body) : post(url, body));
		} catch (error) {
			const description = describeSendError(error, url);
			logger.warn(`Failed to ${enqueue ? "queue" : "send"} notification: ${description.message}`, {
				error: description,
			});
		}
	};

	const openWindow = (queue: string) => {
		const timer = setTimer(() => {
			const window = windows.get(queue);

			if (!window || window.suppressed === 0) {
				windows.delete(queue);
				return;
			}

			void sendBestEffort(formatSummary(queue, window.suppressed));
			openWindow(queue);
		}, windowMs);
		timer.unref?.();
		windows.set(queue, { suppressed: 0, timer });
	};

	return {
		notifyFinalFailure: (failure) => {
			const window = windows.get(failure.queue);

			if (window) {
				window.suppressed += 1;
				return;
			}

			openWindow(failure.queue);
			void sendBestEffort(formatFailure(failure));
		},
		sendTest: async () => {
			try {
				await post(url, { username: USERNAME, text: formatTest() });
			} catch (error) {
				throw deliveryError(error, url);
			}
		},
		flush: async () => {
			const pending = Array.from(windows.entries());
			windows.clear();

			await Promise.all(
				pending.map(([queue, window]) => {
					clearTimer(window.timer);
					return window.suppressed > 0 ? sendBestEffort(formatSummary(queue, window.suppressed)) : undefined;
				}),
			);
		},
	};
};

/** Processor of the `notifications` queue: posts the stored message. A failure throws, so BullMQ retries it. */
export const makeNotificationProcessor = (options: {
	url: string;
	post?: (url: string, body: WebhookBody) => Promise<unknown>;
}) => {
	const post = options.post ?? defaultPost;

	return async (job: Pick<Job<WebhookBody>, "data">) => {
		try {
			await post(options.url, job.data);
		} catch (error) {
			throw deliveryError(error, options.url);
		}
	};
};

/**
 * Logs the delivery attempts: a warning while BullMQ will retry, an error once all attempts are used up.
 * Deliberately no notification about a failed delivery, that would loop for a webhook that stays down.
 */
export const attachNotificationLogging = (logger: Logger, worker: Pick<Worker<WebhookBody>, "on">) => {
	worker.on("failed", (job, error) => {
		const attempts = Math.max(job?.opts.attempts ?? 1, 1);
		const final = !job || job.attemptsMade >= attempts;

		if (final) {
			logger.error(`Notification could not be delivered after ${job?.attemptsMade ?? "?"} attempts: ${error.message}`);
		} else {
			logger.warn(
				`Notification delivery failed (attempt ${job.attemptsMade}/${attempts}), will retry: ${error.message}`,
			);
		}
	});
};
