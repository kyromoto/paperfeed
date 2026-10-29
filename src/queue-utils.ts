import type { Logger } from "@logtape/logtape";
import type * as bullmq from "bullmq";
import type { FileProcessor, ProcessChangesJobPayload } from "./file-processor";

export type ProcessFileBulkJob = {
	name: string;
	data: ProcessChangesJobPayload;
	opts: bullmq.BulkJobOptions;
};

export type EnqueueResult = { created: number; alreadyQueued: number };

/**
 * Adds the jobs in bulk and reports how many were really created.
 *
 * With a deduplication id BullMQ does not create a job while one with the same id exists, `addBulk` then returns the
 * existing job (with its id) in the position of the requested one. So a returned id that differs from the requested
 * `jobId` means "already queued". Verified against BullMQ 5.78, repeat that check when upgrading BullMQ.
 */
export async function enqueueJobs(
	queue: { addBulk: (jobs: ProcessFileBulkJob[]) => Promise<{ id?: string }[]> },
	jobs: ProcessFileBulkJob[],
): Promise<EnqueueResult> {
	if (jobs.length === 0) {
		return { created: 0, alreadyQueued: 0 };
	}

	const added = await queue.addBulk(jobs);
	const alreadyQueued = added.filter((job, index) => job.id !== jobs[index].opts.jobId).length;

	return { created: jobs.length - alreadyQueued, alreadyQueued };
}

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
						deduplication: { id: `process-changes-${accountId}-${file.id}` },
					},
				}));
			}),
		)
	).flat();
}

export type FinalFailureInfo = {
	queue: string;
	label: string;
	error: string;
	attemptsMade?: number;
	attempts: number;
};

export function attachWorkerLogging<T, R = unknown>(
	logger: Logger,
	worker: bullmq.Worker<T, R>,
	queue: bullmq.Queue<T>,
	getLabel: (data: T | undefined) => string,
	onCompleted?: (job: bullmq.Job<T, R>, result: R) => void | Promise<void>,
	onFinalFailure?: (info: FinalFailureInfo) => void,
): void {
	// const queueEvents = new QueueEvents(queue.name);
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

		if (!onFinalFailure) {
			return;
		}

		// without a job (e.g. stalled limit exceeded) there is nothing that could be retried
		// BullMQ stores `attempts: 0` for jobs added without the option, which still means one attempt
		const attempts = Math.max(job?.opts.attempts ?? 1, 1);

		if (job && job.attemptsMade < attempts) {
			return;
		}

		try {
			onFinalFailure({
				queue: queue.name,
				label: getLabel(job?.data),
				error: error.message,
				attemptsMade: job?.attemptsMade,
				attempts,
			});
		} catch (callbackError) {
			logger.getChild(queue.name).warn("Failed to report a permanently failed job", { error: callbackError });
		}
	});
	// queueEvents.on("deduplicated", ({ jobId, deduplicationId, deduplicatedJobId }, id) => {
	// 	logger.getChild([queue.name, jobId ?? "unknown-id"])
	// 		.warn(`Job ${deduplicatedJobId} was deduplicated due to existing job ${jobId} with deduplication id ${deduplicationId}`, {
	// 			id,
	// 			jobId,
	// 			deduplicationId,
	// 			deduplicatedJobId
	// 		});
	// });
	queue.on("error", (error) => {
		logger.getChild(queue.name).error(`queue error: ${error.message}`, { error });
	});
}
