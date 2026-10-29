import type { Logger } from "@logtape/logtape";
import axios from "axios";

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
	/** Sends a test message and rejects with a message that does not contain the webhook URL. */
	sendTest: () => Promise<void>;
};

export type NotifierOptions = {
	url: string | undefined;
	logger: Logger;
	post?: (url: string, body: WebhookBody) => Promise<unknown>;
	setTimer?: (callback: () => void, ms: number) => { unref?: () => void };
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
	const windowMs = options.windowMs ?? WINDOW_MS;
	const windows = new Map<string, { suppressed: number }>();

	const sendBestEffort = async (text: string) => {
		try {
			await post(url, { username: USERNAME, text });
		} catch (error) {
			logger.warn(`Failed to send notification: ${describeSendError(error, url).message}`, {
				error: describeSendError(error, url),
			});
		}
	};

	const openWindow = (queue: string) => {
		windows.set(queue, { suppressed: 0 });
		const timer = setTimer(() => {
			const window = windows.get(queue);

			if (!window || window.suppressed === 0) {
				windows.delete(queue);
				return;
			}

			const count = window.suppressed;
			void sendBestEffort(formatSummary(queue, count));
			openWindow(queue);
		}, windowMs);
		timer.unref?.();
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
				const description = describeSendError(error, url);
				throw new Error(
					[description.status ? `HTTP ${description.status}` : description.code, description.message]
						.filter(Boolean)
						.join(": "),
				);
			}
		},
	};
};
