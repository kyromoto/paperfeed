import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveFile, FileProcessor } from "./file-processor";
import { collectOutstandingJobs, enqueueJobs, type ProcessFileBulkJob } from "./queue-utils";

const file = (id: string): DriveFile => ({ id, name: `${id}.pdf`, mimeType: "application/pdf" });

const job = (fileId: string, timestamp = "t1"): ProcessFileBulkJob => ({
	name: "process-changes",
	data: { accountId: "acc", file: file(fileId) },
	opts: { jobId: `process-changes-acc-${fileId}-${timestamp}`, deduplication: { id: `process-changes-acc-${fileId}` } },
});

describe("enqueueJobs", () => {
	// mimics BullMQ: an entry whose deduplication id is already taken comes back as the existing job
	const queueWith = (existing: Record<string, string> = {}) => {
		const seen = { ...existing };
		return {
			addBulk: vi.fn(async (jobs: ProcessFileBulkJob[]) =>
				jobs.map((added) => {
					const dedupId = added.opts.deduplication?.id ?? "";
					if (seen[dedupId]) {
						return { id: seen[dedupId] };
					}
					seen[dedupId] = added.opts.jobId as string;
					return { id: added.opts.jobId };
				}),
			),
		};
	};

	it("counts every job as created when none exists yet", async () => {
		const queue = queueWith();

		const result = await enqueueJobs(queue, [job("a"), job("b")]);

		expect(result).toEqual({ created: 2, alreadyQueued: 0 });
		expect(queue.addBulk).toHaveBeenCalledTimes(1);
	});

	it("counts every job as already queued when all of them exist", async () => {
		const queue = queueWith({
			"process-changes-acc-a": "process-changes-acc-a-old",
			"process-changes-acc-b": "process-changes-acc-b-old",
		});

		const result = await enqueueJobs(queue, [job("a", "t2"), job("b", "t2")]);

		expect(result).toEqual({ created: 0, alreadyQueued: 2 });
	});

	it("tells new and existing jobs apart in a mixed batch", async () => {
		const queue = queueWith({ "process-changes-acc-b": "process-changes-acc-b-old" });

		const result = await enqueueJobs(queue, [job("a"), job("b", "t2"), job("c")]);

		expect(result).toEqual({ created: 2, alreadyQueued: 1 });
	});

	it("matches returned and requested jobs by position", async () => {
		const queue = queueWith({ "process-changes-acc-c": "process-changes-acc-c-old" });

		const result = await enqueueJobs(queue, [job("c", "t2"), job("a"), job("b")]);

		expect(result).toEqual({ created: 2, alreadyQueued: 1 });
	});

	it("does not touch the queue for an empty list", async () => {
		const queue = queueWith();

		const result = await enqueueJobs(queue, []);

		expect(result).toEqual({ created: 0, alreadyQueued: 0 });
		expect(queue.addBulk).not.toHaveBeenCalled();
	});

	it("passes the jobs on unchanged", async () => {
		const queue = queueWith();
		const jobs = [job("a"), job("b")];

		await enqueueJobs(queue, jobs);

		expect(queue.addBulk).toHaveBeenCalledWith(jobs);
	});

	it("propagates a failing queue", async () => {
		const queue = { addBulk: vi.fn(async () => Promise.reject(new Error("redis down"))) };

		await expect(enqueueJobs(queue, [job("a")])).rejects.toThrow("redis down");
	});
});

describe("collectOutstandingJobs", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-29T12:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const processorWith = (files: DriveFile[]) => {
		const processor = { getUnprocessedFiles: vi.fn(async () => files) };
		return processor as unknown as FileProcessor & typeof processor;
	};

	it("builds one job per file with the jobId and deduplication id schemes the app relies on", async () => {
		const processor = processorWith([file("f1"), file("f2")]);

		const jobs = await collectOutstandingJobs(new Map([["acc", processor]]), "process-changes");

		expect(processor.getUnprocessedFiles).toHaveBeenCalledWith("all");
		expect(jobs).toEqual([
			{
				name: "process-changes",
				data: { accountId: "acc", file: file("f1") },
				opts: {
					jobId: "process-changes-acc-f1-2026-10-29T12:00:00.000Z",
					deduplication: { id: "process-changes-acc-f1" },
				},
			},
			{
				name: "process-changes",
				data: { accountId: "acc", file: file("f2") },
				opts: {
					jobId: "process-changes-acc-f2-2026-10-29T12:00:00.000Z",
					deduplication: { id: "process-changes-acc-f2" },
				},
			},
		]);
	});

	it("keeps the deduplication id independent of the timestamp so a repeated run is recognized as the same file", async () => {
		const processor = processorWith([file("f1")]);
		const first = await collectOutstandingJobs(new Map([["acc", processor]]), "process-changes");

		vi.setSystemTime(new Date("2026-10-29T12:05:00.000Z"));
		const second = await collectOutstandingJobs(new Map([["acc", processor]]), "process-changes");

		expect(second[0].opts.jobId).not.toBe(first[0].opts.jobId);
		expect(second[0].opts.deduplication).toEqual(first[0].opts.deduplication);
	});

	it("collects the jobs of all accounts and keeps them apart", async () => {
		const jobs = await collectOutstandingJobs(
			new Map([
				["acc-1", processorWith([file("f1")])],
				["acc-2", processorWith([file("f1")])],
			]),
			"process-changes",
		);

		expect(jobs.map((entry) => entry.opts.deduplication?.id)).toEqual([
			"process-changes-acc-1-f1",
			"process-changes-acc-2-f1",
		]);
	});

	it("returns no jobs when the source folder is empty", async () => {
		const jobs = await collectOutstandingJobs(new Map([["acc", processorWith([])]]), "process-changes");

		expect(jobs).toEqual([]);
	});
});
