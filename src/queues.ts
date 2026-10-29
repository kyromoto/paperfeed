import * as bullmq from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";
import type { RenewChannelJobPayload } from "./drive-monitor";
import type {
	CollectChangesJobPayload,
	CollectChangesJobResult,
	ProcessChangesJobPayload,
	ProcessChangesJobResult,
} from "./file-processor";

export const COLLECT_CHANGES_QUEUE = "collect-changes";
export const PROCESS_CHANGES_QUEUE = "process-changes";
export const RENEW_CHANNEL_QUEUE = "renew-channel";

export const connectRedis = async (url: string) => {
	const redisOptions: RedisOptions = { maxRetriesPerRequest: null };
	const redisConnection = new IORedis(url, redisOptions);

	try {
		await new Promise<void>((resolve, reject) => {
			redisConnection.once("ready", resolve);
			redisConnection.once("error", reject);
		});
	} catch (error) {
		// stop ioredis from retrying forever, otherwise the process (e.g. the CLI) never exits
		redisConnection.disconnect();
		throw error;
	}

	return redisConnection;
};

export const createQueues = (connection: IORedis, prefix: string) => {
	const queueOptions: bullmq.QueueOptions = { connection, prefix };

	const collectChangesQueue = new bullmq.Queue<CollectChangesJobPayload, CollectChangesJobResult>(
		COLLECT_CHANGES_QUEUE,
		{
			...queueOptions,
			defaultJobOptions: {
				removeOnComplete: { age: 60 * 60 * 24 * 7 }, // 1 Week
			},
		},
	);

	const processChangesQueue = new bullmq.Queue<ProcessChangesJobPayload, ProcessChangesJobResult>(
		PROCESS_CHANGES_QUEUE,
		{
			...queueOptions,
			defaultJobOptions: {
				removeOnComplete: { age: 60 * 60 * 24 * 7 }, // 1 Week
			},
		},
	);

	const renewChannelQueue = new bullmq.Queue<RenewChannelJobPayload>(RENEW_CHANNEL_QUEUE, {
		...queueOptions,
		defaultJobOptions: {
			removeOnComplete: { age: 60 * 60 * 24 }, // 1 Day
			attempts: 3,
			backoff: { type: "exponential", delay: 5_000 },
		},
	});

	return { collectChangesQueue, processChangesQueue, renewChannelQueue };
};
