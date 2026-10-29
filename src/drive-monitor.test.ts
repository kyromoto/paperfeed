import type { Logger } from "@logtape/logtape";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelRepository } from "./channel-repository";
import { migrate } from "./db";
import { DriveMonitor, describeApiError } from "./drive-monitor";
import type { Account, Config } from "./types";

const drive = vi.hoisted(() => ({
	channels: { stop: vi.fn() },
	files: { watch: vi.fn() },
}));

vi.mock("./lib", () => ({ getDriveClient: () => drive }));

const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const DRIVE_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

const config = {
	server: { drive_monitor: { webhook_url: "https://paperfeed.example.com" } },
	drive_accounts: [{ id: DRIVE_ACCOUNT_ID, name: "drive", props: { channel_expiration_sec: 300 } }],
} as unknown as Config;

const account = {
	id: ACCOUNT_ID,
	name: "acc",
	props: { drive_account_id: DRIVE_ACCOUNT_ID, drive_src_folder_id: "src" },
} as unknown as Account;

// shaped like the errors thrown by the Google API client: they carry the whole request and response
const apiError = (status: number, reason: string, message: string) =>
	Object.assign(new Error(message), {
		status,
		code: status,
		config: { url: "https://www.googleapis.com/drive/v3/channels/stop", data: { id: "secret-request-body" } },
		response: { data: { error: { errors: [{ reason }], code: status, message } } },
	});

const networkError = () => Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

const logger = () => {
	const methods = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	return { methods, instance: methods as unknown as Logger };
};

const watchResponse = (id = "new-channel") => ({
	data: { id, resourceId: "new-resource", expiration: String(Date.now() + 300_000) },
});

describe("DriveMonitor", () => {
	let channels: ChannelRepository;
	let log: ReturnType<typeof logger>;
	let monitor: DriveMonitor;

	beforeEach(() => {
		drive.channels.stop.mockReset();
		drive.files.watch.mockReset();
		drive.files.watch.mockResolvedValue(watchResponse());
		drive.channels.stop.mockResolvedValue({});

		const db = new Database(":memory:");
		migrate(db);
		channels = new ChannelRepository(db);
		log = logger();
		monitor = new DriveMonitor(log.instance, config, account, channels);
	});

	describe("start", () => {
		it("creates a channel and persists it when no previous channel exists", async () => {
			await monitor.start();

			expect(drive.channels.stop).not.toHaveBeenCalled();
			expect(channels.get(ACCOUNT_ID)).toMatchObject({ channelId: "new-channel", resourceId: "new-resource" });
			expect(monitor.getChannelId()).toBe("new-channel");
		});

		it("stops the previous channel before creating a new one", async () => {
			channels.upsert(ACCOUNT_ID, "old-channel", "old-resource", 1);

			await monitor.start();

			expect(drive.channels.stop).toHaveBeenCalledWith({
				requestBody: { id: "old-channel", resourceId: "old-resource" },
			});
			expect(channels.get(ACCOUNT_ID)?.channelId).toBe("new-channel");
			expect(log.methods.warn).not.toHaveBeenCalled();
		});

		it("treats a 404 for the previous channel as normal: info instead of warning, new channel is created", async () => {
			channels.upsert(ACCOUNT_ID, "old-channel", "old-resource", 1);
			drive.channels.stop.mockRejectedValue(apiError(404, "notFound", "Channel 'old-channel' not found"));

			await monitor.start();

			expect(log.methods.warn).not.toHaveBeenCalled();
			expect(log.methods.info).toHaveBeenCalledWith(
				expect.stringContaining("already stopped or expired"),
				expect.anything(),
			);
			expect(channels.get(ACCOUNT_ID)?.channelId).toBe("new-channel");
		});

		it("warns for other errors and still creates a new channel", async () => {
			channels.upsert(ACCOUNT_ID, "old-channel", "old-resource", 1);
			drive.channels.stop.mockRejectedValue(apiError(503, "backendError", "Service unavailable"));

			await monitor.start();

			expect(log.methods.warn).toHaveBeenCalledWith(
				expect.stringContaining("Failed to stop existing channel old-channel"),
				{ error: expect.objectContaining({ status: 503, reason: "backendError" }) },
			);
			expect(channels.get(ACCOUNT_ID)?.channelId).toBe("new-channel");
		});

		it("logs API errors compactly, without request configuration or response bodies", async () => {
			channels.upsert(ACCOUNT_ID, "old-channel", "old-resource", 1);
			drive.channels.stop.mockRejectedValue(apiError(503, "backendError", "Service unavailable"));

			await monitor.start();

			const logged = JSON.stringify(log.methods.warn.mock.calls);
			expect(logged).not.toContain("secret-request-body");
			expect(logged).not.toContain("googleapis.com");
		});
	});

	describe("stop", () => {
		beforeEach(async () => {
			await monitor.start();
			log.methods.info.mockClear();
		});

		it("stops the channel at Google and removes the persisted state", async () => {
			await monitor.stop();

			expect(drive.channels.stop).toHaveBeenCalledWith({
				requestBody: { id: "new-channel", resourceId: "new-resource" },
			});
			expect(channels.get(ACCOUNT_ID)).toBeUndefined();
			expect(monitor.getChannelId()).toBeNull();
		});

		it("removes the persisted state when Google no longer knows the channel (404)", async () => {
			drive.channels.stop.mockRejectedValue(apiError(404, "notFound", "Channel not found"));

			await monitor.stop();

			expect(channels.get(ACCOUNT_ID)).toBeUndefined();
			expect(log.methods.error).not.toHaveBeenCalled();
		});

		it("keeps the persisted state when stopping fails for another reason", async () => {
			drive.channels.stop.mockRejectedValue(networkError());

			await monitor.stop();

			expect(channels.get(ACCOUNT_ID)?.channelId).toBe("new-channel");
			expect(log.methods.error).toHaveBeenCalledWith(
				expect.stringContaining("Failed to stop channel with id new-channel"),
				{ error: expect.objectContaining({ code: "ECONNREFUSED" }) },
			);
		});

		it("does nothing without an active channel and does not touch the persisted state", async () => {
			const idle = new DriveMonitor(log.instance, config, account, channels);
			drive.channels.stop.mockClear();

			await idle.stop();

			expect(drive.channels.stop).not.toHaveBeenCalled();
			expect(channels.get(ACCOUNT_ID)?.channelId).toBe("new-channel");
			expect(log.methods.warn).toHaveBeenCalledWith("No active channel to stop");
		});

		it("lets the next start skip the stop call after a clean shutdown", async () => {
			await monitor.stop();
			drive.channels.stop.mockClear();

			await monitor.start();

			expect(drive.channels.stop).not.toHaveBeenCalled();
			expect(log.methods.warn).not.toHaveBeenCalled();
		});
	});
});

describe("describeApiError", () => {
	it("extracts status, reason and message", () => {
		expect(describeApiError(apiError(404, "notFound", "gone"))).toEqual({
			status: 404,
			code: undefined,
			reason: "notFound",
			message: "gone",
		});
	});

	it("reports string error codes of network errors", () => {
		expect(describeApiError(networkError())).toMatchObject({
			status: undefined,
			code: "ECONNREFUSED",
			message: "connect ECONNREFUSED",
		});
	});

	it("handles values that are not errors", () => {
		expect(describeApiError("boom")).toEqual({
			status: undefined,
			code: undefined,
			reason: undefined,
			message: "boom",
		});
		expect(describeApiError(undefined).message).toBe("undefined");
	});
});
