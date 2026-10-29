import type http from "node:http";
import type { Logger } from "@logtape/logtape";
import type * as bullmq from "bullmq";
import type { Redis } from "ioredis";
import type { Db } from "./db";
import type { DriveMonitor } from "./drive-monitor";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export type ShutdownResources = {
	server: http.Server;
	renewalSchedulerInterval: NodeJS.Timeout;
	workers: bullmq.Worker[];
	monitors: Map<string, DriveMonitor>;
	/** Hands over notification summaries that are still held back, optional because notifications can be off. */
	notifier?: { flush: () => Promise<void> };
	queues: bullmq.Queue[];
	redisConnection: Redis;
	db: Db;
};

/**
 * Registers signal handlers that shut the app down in order: stop accepting new work (http, scheduler),
 * let running jobs finish (workers), stop the drive channels, then close queues, redis and the database.
 * Must be called after all resources exist. Forces exit with code 1 after `timeoutMs`.
 */
export const setupShutdownHandler = (logger: Logger, resources: ShutdownResources, timeoutMs = 30_000) => {
	let shuttingDown = false;

	const step = async (name: string, fn: () => Promise<unknown> | unknown) => {
		logger.info(`${name} ...`);
		try {
			await fn();
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`Failed: ${name}: ${message}`, { error });
		}
	};

	const shutdown = async (reason: string, exitCode: number) => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;

		logger.info(`Shutting down... | Reason: ${reason}`, { reason });

		const forceExit = setTimeout(() => {
			logger.error(`Shutdown did not finish within ${timeoutMs}ms, forcing exit`);
			process.exit(1);
		}, timeoutMs);
		forceExit.unref();

		await step(
			"Stopping http server",
			() =>
				new Promise<void>((resolve, reject) => {
					resources.server.close((err) => (err ? reject(err) : resolve()));
					resources.server.closeIdleConnections();
				}),
		);
		await step("Stopping channel renewal scheduler", () => clearInterval(resources.renewalSchedulerInterval));
		await step("Closing workers (waiting for active jobs)", () =>
			Promise.allSettled(resources.workers.map((worker) => worker.close())),
		);
		await step("Stopping monitors", () =>
			Promise.allSettled(Array.from(resources.monitors.values()).map((monitor) => monitor.stop())),
		);
		await step("Flushing pending notifications", () => resources.notifier?.flush());
		await step("Closing queues", () => Promise.allSettled(resources.queues.map((queue) => queue.close())));
		await step("Quitting redis connection", () => resources.redisConnection.quit());
		await step("Closing database", () => resources.db.close());

		logger.info("Goodbye!");
		process.exit(exitCode);
	};

	for (const signal of SHUTDOWN_SIGNALS) {
		process.on(signal, () => void shutdown(signal, 0));
	}

	process.on("uncaughtException", (error) => {
		logger.fatal(`Uncaught exception: ${error.message}`, { error });
		void shutdown("uncaughtException", 1);
	});
};
