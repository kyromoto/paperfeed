import type { Logger } from "@logtape/logtape";
import type bullmq from "bullmq";
import type { Request, Response } from "express";
import type { DriveMonitor } from "./drive-monitor";
import type { CollectChangesJobPayload } from "./file-processor";
import type { Config } from "./types";

export const handleWebhook = (
	logger: Logger,
	config: Config,
	queue: bullmq.Queue<CollectChangesJobPayload>,
	monitors: Map<string, DriveMonitor>,
) => {
	const debounceMS = config.server.queue.debounce.collectChangesSec * 1000;

	return async (req: Request, res: Response) => {
		try {
			logger.info("Handling request ...");

			const now = Date.now();
			const channelId = req.get("X-Goog-Channel-Id");
			const state = req.get("X-Goog-Resource-State");

			if (!channelId || !state) {
				const msg = `Received request without required headers ${JSON.stringify({ channelId, state })} ... ignoring`;
				throw new AcceptableWebhookError(msg, 200, "OK");
			}

			const [accountId, monitor] =
				Array.from(monitors.entries()).find(([_accountId, monitor]) => monitor.getChannelId() === channelId) ?? [];
			const account = config.accounts.find((account) => account.id === accountId);

			if (!account || !monitor) {
				const msg = `No account found for channel id = ${channelId} ... ignoring`;
				throw new AcceptableWebhookError(msg, 200, "OK");
			}

			if (!monitor.verifyChannelToken(req.get("X-Goog-Channel-Token"))) {
				const msg = `${account.name}: Invalid or missing channel token for channel id = ${channelId} ... ignoring`;
				throw new AcceptableWebhookError(msg, 200, "OK");
			}

			if (state.toLowerCase() === "sync") {
				const msg = `${account.name}: Received sync webhook`;
				throw new AcceptableWebhookError(msg, 200, "OK");
			}

			logger.info(`${account.name}: Received webhook for state ${state} ... adding job to queue`);
			const isoDate = new Date(now).toISOString();
			await queue.add(
				queue.name,
				{ accountId: account.id },
				{
					jobId: `collect-changes-${account.id}-${isoDate}`,
					deduplication: {
						id: `collect-changes-${account.id}`,
						ttl: debounceMS, // Debounce Mode
						extend: true, // Debounce Mode
						replace: true, // Debounce Mode
					},
					delay: debounceMS, // Debounce Mode
				},
			);

			res.status(200).send("OK");
		} catch (error: unknown) {
			if (error instanceof AcceptableWebhookError) {
				const { "x-goog-channel-token": _token, ...headers } = req.headers;
				logger.warn(error.message, { headers, ...error.props });
				res.status(error.status).send(error.body);
				return;
			}

			const message = error instanceof Error ? error.message : String(error);
			logger.error(`Failed to handle webhook: ${message}`, { error });
			res.status(200).send("OK");
			return;
		}
	};
};

export const handleHealthCheck = () => {
	return async (_req: Request, res: Response) => {
		res.status(200).json({ status: "OK" });
	};
};

class AcceptableWebhookError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly body: string,
		public readonly props: object = {},
	) {
		super(message);
	}
}
