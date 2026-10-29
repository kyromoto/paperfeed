import type { Logger } from "@logtape/logtape";
import type { Job } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import type { DriveMonitor } from "./drive-monitor";
import type { DriveFile, FileProcessor, ProcessChangesJobPayload, ProcessStep } from "./file-processor";
import {
	makeCollectChangesQueueProcessor,
	makeProcessChangesQueueProcessor,
	makeRenewChannelQueueProcessor,
} from "./queue-processor";
import type { Config } from "./types";

const file: DriveFile = { id: "file-1", name: "invoice.pdf", mimeType: "application/pdf" };

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as unknown as Logger;

// a Job whose updateData persists the data like BullMQ does, so a retry sees the stored step
const fakeJob = <T extends object>(data: T) => {
	const job = {
		data,
		log: vi.fn(async () => 0),
		updateData: vi.fn(async (next: T) => {
			job.data = next;
		}),
	};
	return job as typeof job & Job<T>;
};

const fakeFileProcessor = (calls: string[] = []) => {
	const processor = {
		downloadFileFromDrive: vi.fn(async () => void calls.push("download")),
		uploadFileToPaperless: vi.fn(async () => void calls.push("upload")),
		moveFile: vi.fn(async () => void calls.push("move")),
		getUnprocessedFiles: vi.fn(async () => [file]),
	};
	return processor;
};

const asProcessors = (processor: ReturnType<typeof fakeFileProcessor>, accountId = "acc") =>
	new Map([[accountId, processor as unknown as FileProcessor]]);

const payload = (step?: ProcessStep | string): ProcessChangesJobPayload => ({
	accountId: "acc",
	file,
	...(step ? { step: step as ProcessStep } : {}),
});

describe("process-changes processor (step machine)", () => {
	it("runs download, upload and move in order for a new job", async () => {
		const calls: string[] = [];
		const processor = fakeFileProcessor(calls);

		await makeProcessChangesQueueProcessor(asProcessors(processor))(fakeJob(payload()));

		expect(calls).toEqual(["download", "upload", "move"]);
		expect(processor.downloadFileFromDrive).toHaveBeenCalledWith(file);
		expect(processor.uploadFileToPaperless).toHaveBeenCalledWith(file);
		expect(processor.moveFile).toHaveBeenCalledWith(file);
	});

	it("persists the step after every stage, ending with done", async () => {
		const job = fakeJob(payload());

		await makeProcessChangesQueueProcessor(asProcessors(fakeFileProcessor()))(job);

		expect(job.updateData.mock.calls.map(([data]) => data.step)).toEqual(["downloaded", "uploaded", "moved", "done"]);
		expect(job.data.step).toBe("done");
		expect(job.data.file).toEqual(file);
	});

	it.each([
		["downloaded", ["upload", "move"]],
		["uploaded", ["move"]],
		["moved", []],
		["done", []],
	])("resumes at the stored step %s", async (step, expected) => {
		const calls: string[] = [];

		await makeProcessChangesQueueProcessor(asProcessors(fakeFileProcessor(calls)))(fakeJob(payload(step)));

		expect(calls).toEqual(expected);
	});

	it("does not touch the job data when the job is already done", async () => {
		const job = fakeJob(payload("done"));

		await makeProcessChangesQueueProcessor(asProcessors(fakeFileProcessor()))(job);

		expect(job.updateData).not.toHaveBeenCalled();
	});

	it("keeps the last completed step when a stage fails and the retry continues there", async () => {
		const calls: string[] = [];
		const processor = fakeFileProcessor(calls);
		processor.uploadFileToPaperless.mockRejectedValueOnce(new Error("Paperless is down"));
		const handler = makeProcessChangesQueueProcessor(asProcessors(processor));
		const job = fakeJob(payload());

		await expect(handler(job)).rejects.toThrow("Paperless is down");

		expect(calls).toEqual(["download"]);
		expect(job.data.step).toBe("downloaded");
		expect(processor.moveFile).not.toHaveBeenCalled();

		await handler(job);

		expect(calls).toEqual(["download", "upload", "move"]);
		expect(job.data.step).toBe("done");
	});

	it("never moves the file when the upload fails", async () => {
		const processor = fakeFileProcessor();
		processor.uploadFileToPaperless.mockRejectedValue(new Error("rejected"));

		await expect(makeProcessChangesQueueProcessor(asProcessors(processor))(fakeJob(payload()))).rejects.toThrow();

		expect(processor.moveFile).not.toHaveBeenCalled();
	});

	it("fails for an account without a processor", async () => {
		const handler = makeProcessChangesQueueProcessor(new Map());

		await expect(handler(fakeJob(payload()))).rejects.toThrow("Failed to find processor for account acc");
	});

	it("rejects an unknown step instead of looping", async () => {
		const handler = makeProcessChangesQueueProcessor(asProcessors(fakeFileProcessor()));

		await expect(handler(fakeJob(payload("teleported")))).rejects.toThrow("Invalid step teleported");
	});
});

describe("collect-changes processor", () => {
	const config = { accounts: [{ id: "acc", name: "Alice" }] } as unknown as Config;

	it("returns the changed files of the account's processor", async () => {
		const processor = fakeFileProcessor();

		const files = await makeCollectChangesQueueProcessor(
			logger(),
			config,
			asProcessors(processor),
		)(fakeJob({ accountId: "acc" }));

		expect(files).toEqual([file]);
		expect(processor.getUnprocessedFiles).toHaveBeenCalledWith("changes");
	});

	it("fails for an unknown account", async () => {
		const handler = makeCollectChangesQueueProcessor(logger(), config, new Map());

		await expect(handler(fakeJob({ accountId: "other" }))).rejects.toThrow("Failed to find account");
	});

	it("fails when the account has no processor", async () => {
		const handler = makeCollectChangesQueueProcessor(logger(), config, new Map());

		await expect(handler(fakeJob({ accountId: "acc" }))).rejects.toThrow("Failed to find processor for account Alice");
	});
});

describe("renew-channel processor", () => {
	it("starts the monitor of the account", async () => {
		const monitor = { start: vi.fn(async () => undefined) };

		await makeRenewChannelQueueProcessor(new Map([["acc", monitor as unknown as DriveMonitor]]))(
			fakeJob({ accountId: "acc" }),
		);

		expect(monitor.start).toHaveBeenCalledTimes(1);
	});

	it("fails for an account without a monitor so that BullMQ retries", async () => {
		await expect(makeRenewChannelQueueProcessor(new Map())(fakeJob({ accountId: "acc" }))).rejects.toThrow(
			"No monitor found for accountId acc",
		);
	});

	it("propagates a failing start so that BullMQ retries", async () => {
		const monitor = { start: vi.fn(async () => Promise.reject(new Error("Drive is down"))) };

		await expect(
			makeRenewChannelQueueProcessor(new Map([["acc", monitor as unknown as DriveMonitor]]))(
				fakeJob({ accountId: "acc" }),
			),
		).rejects.toThrow("Drive is down");
	});
});
