import fs from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import logtape from "@logtape/logtape";
import * as bullmq from "bullmq";
import express from "express";
import helmet from "helmet";
import { err, ok, Result } from "neverthrow";
import { ChangeTokenRepository } from "./change-token-repository";
import { startChannelRenewalScheduler } from "./channel-renewal-scheduler";
import { ChannelRepository } from "./channel-repository";
import { ConfigFileRepository } from "./config-repository";
import { handleHealthCheck, handleWebhook } from "./controllers";
import { openDatabase } from "./db";
import { DriveMonitor } from "./drive-monitor";
import * as env from "./env";
import { type CollectChangesJobPayload, type CollectChangesJobResult, FileProcessor } from "./file-processor";
import { FileStore } from "./file-store";
import { getDriveClient } from "./lib";
import { configureLogging, ROOT_LOGGER_KEY } from "./logging";
import {
	makeCollectChangesQueueProcessor,
	makeProcessChangesQueueProcessor,
	makeRenewChannelQueueProcessor,
} from "./queue-processor";
import { attachWorkerLogging, collectOutstandingJobs } from "./queue-utils";
import { connectRedis, createQueues } from "./queues";
import { setupShutdownHandler } from "./shutdown";

async function main() {
	const startTime = Date.now();

	const logger = await configureLogging();

	logger.info(`App version: ${process.env.npm_package_version}`);
	logger.info(`Environment: ${env.NODE_ENV} | Log level: ${env.LOG_LEVEL}`);

	logger.info(`Loading config from ${env.CONFIG_PATH} ...`);
	const config = await new ConfigFileRepository(logger.getChild("config-repository"), env.CONFIG_PATH).read();

	logger.info("Check data path exists ...");
	await fs.access(config.server.data_path).catch(async () => {
		logger.warn(`Data path ${config.server.data_path} does not exist, creating...`);
		await fs.mkdir(config.server.data_path, { recursive: true });
	});

	logger.info("Initializing file store ...");
	const fileStore = new FileStore(path.join(config.server.data_path, "files"));
	await fileStore.init();

	logger.info("Opening database ...");
	const db = openDatabase(config.server.data_path);
	const changeTokenRepository = new ChangeTokenRepository(db);
	const channelRepository = new ChannelRepository(db);

	const monitors = new Map<string, DriveMonitor>();
	const processors = new Map<string, FileProcessor>();

	logger.info(`Connecting to redis at ${config.server.queue.redis.url} ...`);
	const redisConnection = await connectRedis(config.server.queue.redis.url);

	logger.info("Initializing queues ...");
	const { collectChangesQueue, processChangesQueue, renewChannelQueue } = createQueues(
		redisConnection,
		config.server.queue.redis.prefix,
	);

	const workerOptions: bullmq.WorkerOptions = {
		connection: redisConnection,
		prefix: config.server.queue.redis.prefix,
		removeOnComplete: { count: 100 },
		removeOnFail: { count: 10 },
	};

	const collectChangesWorker = new bullmq.Worker(
		collectChangesQueue.name,
		makeCollectChangesQueueProcessor(logger.getChild(collectChangesQueue.name), config, processors),
		{ ...workerOptions, concurrency: config.server.queue.concurrency.collect },
	);

	const processChangesWorker = new bullmq.Worker(
		processChangesQueue.name,
		makeProcessChangesQueueProcessor(processors),
		{ ...workerOptions, concurrency: config.server.queue.concurrency.process },
	);

	const renewChannelWorker = new bullmq.Worker(renewChannelQueue.name, makeRenewChannelQueueProcessor(monitors), {
		...workerOptions,
		concurrency: config.server.queue.concurrency.renew,
	});

	attachWorkerLogging<CollectChangesJobPayload, CollectChangesJobResult>(
		logger,
		collectChangesWorker,
		collectChangesQueue,
		(d) => `${d?.accountId ?? "unknown-account"} collecting changes`,
		async (job, files) => {
			logger
				.getChild([collectChangesQueue.name, job.id ?? "unknown-id"])
				.info(`${files.length} files collected`, { job, files });
			const dateStr = new Date().toISOString();
			await processChangesQueue.addBulk(
				files.map((file) => ({
					name: "process-changes",
					data: { accountId: job.data.accountId, file },
					opts: {
						jobId: `process-changes-${job.data.accountId}-${file.id}-${dateStr}`,
						deduplication: { id: `process-changes-${job.data.accountId}-${file.id}` },
					},
				})),
			);
		},
	);

	attachWorkerLogging(
		logger,
		processChangesWorker,
		processChangesQueue,
		(d) => `${d?.file.name ?? "unknown-file"} processing`,
	);

	attachWorkerLogging(
		logger,
		renewChannelWorker,
		renewChannelQueue,
		(d) => `${d?.accountId ?? "unknown-account"} channel renewal`,
	);

	logger.info("Initializing file processors ...");

	const initProcessorsResult = Result.combineWithAllErrors(
		config.accounts.map((account) => {
			const driveAccount = config.drive_accounts.find((drive) => drive.id === account.props.drive_account_id);

			if (!driveAccount) {
				return err({
					accountId: account.id,
					message: `Failed to find drive account for ${account.name}`,
				});
			}

			processors.set(
				account.id,
				new FileProcessor(
					logger.getChild(["file-processor", account.name]),
					config,
					fileStore,
					changeTokenRepository,
					account,
					getDriveClient(driveAccount),
				),
			);

			return ok();
		}),
	);

	if (initProcessorsResult.isErr()) {
		initProcessorsResult.error.forEach((error) => {
			logger.error(error.message, { error });
		});
		throw new Error("Failed to initialize drive clients");
	}

	logger.info("Initializing drive monitors ...");
	for (const account of config.accounts) {
		monitors.set(
			account.id,
			new DriveMonitor(logger.getChild(["drive-monitor", account.name]), config, account, channelRepository),
		);
	}

	logger.info("Collect outstanding files from watchfolders ...");
	const processingJobs = await collectOutstandingJobs(processors, processChangesQueue.name);

	logger.info(`Queue ${processingJobs.length} outstanding files for processing ...`, { processingJobs });
	await processChangesQueue.addBulk(processingJobs);

	logger.info(`Starting http server at port ${config.server.http.port}...`);
	const app = express();

	app.use(helmet());
	app.use(express.json());
	app.get("/health", handleHealthCheck());
	app.post("/webhook", handleWebhook(logger.getChild("webhook-controller"), config, collectChangesQueue, monitors));

	const server = await new Promise<http.Server>((resolve, reject) => {
		const server = app.listen(config.server.http.port, (err) => {
			err ? reject(err) : resolve(server);
		});
	});

	logger.info("Starting drive monitors ...");
	await Promise.all(Array.from(monitors.values()).map((monitor) => monitor.start()));

	logger.info("Starting channel renewal scheduler ...");
	const renewalSchedulerInterval = startChannelRenewalScheduler(
		logger.getChild("channel-renewal-scheduler"),
		config.accounts,
		channelRepository,
		renewChannelQueue,
		config.server.queue.renewPollIntervalSec * 1000,
	);

	setupShutdownHandler(logger.getChild("shutdown"), {
		server,
		renewalSchedulerInterval,
		workers: [collectChangesWorker, processChangesWorker, renewChannelWorker],
		monitors,
		queues: [collectChangesQueue, processChangesQueue, renewChannelQueue],
		redisConnection,
		db,
	});

	const elapsedMs = (Date.now() - startTime) / 1000;
	logger.info(`Application started in ${elapsedMs} seconds`);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	logtape.getLogger(ROOT_LOGGER_KEY).fatal(`Failed to start: ${message}`, { error });
	process.exit(1);
});
