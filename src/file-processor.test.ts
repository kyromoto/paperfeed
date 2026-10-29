import { Readable } from "node:stream";
import type { Logger } from "@logtape/logtape";
import type { drive_v3 } from "googleapis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeTokenRepository } from "./change-token-repository";
import { type DriveFile, FileProcessor } from "./file-processor";
import type { FileStore } from "./file-store";
import type { Account, Config } from "./types";

const file: DriveFile = { id: "file-1", name: "invoice.pdf", mimeType: "application/pdf" };

// shaped like an error of the Google client: it carries the status and the whole request
const apiError = (status: number, message: string) =>
	Object.assign(new Error(message), {
		status,
		code: status,
		config: { url: "https://www.googleapis.com/drive/v3/files" },
	});

// what the client throws for an error response when a stream was requested
const unreadableError = () =>
	new TypeError("Cannot read properties of undefined (reading 'Symbol(Symbol.asyncIterator)')");

describe("FileProcessor.downloadFileFromDrive", () => {
	let get: ReturnType<typeof vi.fn>;
	let upload: ReturnType<typeof vi.fn>;
	let streamCall: () => unknown;
	let diagnosisCall: () => unknown;
	let processor: FileProcessor;

	const isStreamRequest = (options?: { responseType?: string }) => options?.responseType === "stream";

	beforeEach(() => {
		streamCall = () => ({ data: Readable.from(["content"]) });
		diagnosisCall = () => ({ data: { id: file.id } });
		get = vi.fn(async (_params: unknown, options?: { responseType?: string }) =>
			isStreamRequest(options) ? streamCall() : diagnosisCall(),
		);
		upload = vi.fn(async () => undefined);
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

		processor = new FileProcessor(
			logger,
			{} as Config,
			{ upload } as unknown as FileStore,
			{} as ChangeTokenRepository,
			{ id: "acc" } as Account,
			{ files: { get } } as unknown as drive_v3.Drive,
		);
	});

	const rejected = async () =>
		processor.downloadFileFromDrive(file).then(
			() => undefined,
			(error: unknown) => error,
		);

	it("streams the file into the file store with a single Drive call", async () => {
		await processor.downloadFileFromDrive(file);

		expect(get).toHaveBeenCalledTimes(1);
		expect(get).toHaveBeenCalledWith({ fileId: "file-1", alt: "media" }, { responseType: "stream" });
		expect(upload).toHaveBeenCalledWith("acc_file-1", expect.anything());
	});

	it("passes an error that already carries a status on unchanged, without asking again", async () => {
		const original = apiError(503, "Service unavailable");
		streamCall = () => Promise.reject(original);

		const error = await rejected();

		expect(error).toBe(original);
		expect(get).toHaveBeenCalledTimes(1);
		expect(upload).not.toHaveBeenCalled();
	});

	it("reports a missing file with the reason from Drive instead of the unreadable stream error", async () => {
		const notFound = apiError(404, "File not found: file-1.");
		streamCall = () => Promise.reject(unreadableError());
		diagnosisCall = () => Promise.reject(notFound);

		const error = await rejected();

		expect(error).toBe(notFound);
		expect((error as Error).message).toBe("File not found: file-1.");
		expect(upload).not.toHaveBeenCalled();
	});

	it("asks for the reason with a plain metadata request of the same file", async () => {
		streamCall = () => Promise.reject(unreadableError());
		diagnosisCall = () => Promise.reject(apiError(404, "File not found: file-1."));

		await rejected();

		expect(get).toHaveBeenCalledTimes(2);
		expect(get).toHaveBeenLastCalledWith({ fileId: "file-1", fields: "id" });
	});

	it("reports missing permissions with the reason from Drive", async () => {
		streamCall = () => Promise.reject(unreadableError());
		diagnosisCall = () => Promise.reject(apiError(403, "The user does not have sufficient permissions for this file."));

		const error = await rejected();

		expect((error as Error).message).toContain("sufficient permissions");
	});

	it("names file and id when the reason cannot be determined", async () => {
		streamCall = () => Promise.reject(unreadableError());

		const error = await rejected();

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("invoice.pdf");
		expect((error as Error).message).toContain("file-1");
		expect((error as Error).message).toContain("could not be read");
		expect((error as Error).message).not.toContain("asyncIterator");
	});

	it("reports the network error of the follow-up request", async () => {
		const network = Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" });
		streamCall = () => Promise.reject(unreadableError());
		diagnosisCall = () => Promise.reject(network);

		expect(await rejected()).toBe(network);
	});

	it("also asks for the reason after a network error without a status", async () => {
		streamCall = () => Promise.reject(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));

		const error = await rejected();

		expect(get).toHaveBeenCalledTimes(2);
		expect((error as Error).message).toContain("invoice.pdf");
	});

	it("does not touch errors of the file store", async () => {
		const diskFull = Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
		upload.mockRejectedValue(diskFull);

		expect(await rejected()).toBe(diskFull);
		expect(get).toHaveBeenCalledTimes(1);
	});
});
