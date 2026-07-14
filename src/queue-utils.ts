import type { Logger } from "@logtape/logtape";
import type * as bullmq from "bullmq";
import type { FileProcessor, ProcessChangesJobPayload } from "./file-processor";
import { QueueEvents } from "bullmq";

export type ProcessFileBulkJob = {
	name: string;
	data: ProcessChangesJobPayload;
	opts: bullmq.BulkJobOptions;
};

export async function collectOutstandingJobs(
	processors: Map<string, FileProcessor>,
	queueName: string,
): Promise<ProcessFileBulkJob[]> {
	const dateStr = new Date().toISOString();
	return (
		await Promise.all(
			Array.from(processors.entries()).map(async ([accountId, processor]) => {
				const files = await processor.getUnprocessedFiles("all");
				return files.map<ProcessFileBulkJob>((file) => ({
					name: queueName,
					data: { accountId, file },
					opts: {
						jobId: `process-changes-${accountId}-${file.id}-${dateStr}`,
						deduplication: { id: `process-changes-${accountId}-${file.id}` }
					}
				}));
			}),
		)
	).flat();
}

export function attachWorkerLogging<T, R = unknown>(
	logger: Logger,
	worker: bullmq.Worker<T, R>,
	queue: bullmq.Queue<T>,
	getLabel: (data: T | undefined) => string,
	onCompleted?: (job: bullmq.Job<T, R>, result: R) => void | Promise<void>,
): void {
	const queueEvents = new QueueEvents(queue.name);
	worker.on("active", (job) => {
		logger.getChild([queue.name, job.id ?? "unknown-id"]).info(`${getLabel(job.data)} started`, { job });
	});
	worker.on("completed", (job, result) => {
		if (onCompleted) {
			onCompleted(job, result);
		} else {
			logger.getChild([queue.name, job.id ?? "unknown-id"]).info(`${getLabel(job.data)} completed`, { job, result });
		}
	});
	worker.on("failed", (job, error) => {
		logger
			.getChild([queue.name, job?.id ?? "unknown-id"])
			.error(`${getLabel(job?.data)} failed: ${error.message}`, { job, error });
	});
	queueEvents.on("deduplicated", ({ jobId, deduplicationId, deduplicatedJobId }, id) => {
		logger.getChild([queue.name, jobId ?? "unknown-id"])
			.warn(`Job ${deduplicatedJobId} was deduplicated due to existing job ${jobId} with deduplication id ${deduplicationId}`, {
				id,
				jobId,
				deduplicationId,
				deduplicatedJobId
			});
	});
	queue.on("error", (error) => {
		logger.getChild(queue.name).error(`queue error: ${error.message}`, { error });
	});
}
