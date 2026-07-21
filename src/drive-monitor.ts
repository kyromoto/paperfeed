import crypto from "node:crypto";
import type { Logger } from "@logtape/logtape";
import type { drive_v3 } from "googleapis";
import type { ChannelRepository } from "./channel-repository";
import { getDriveClient } from "./lib";
import type { Account, Config, DriveAccount } from "./types";

export type RenewChannelJobPayload = { accountId: string };

export class DriveMonitor {
	private driveAccount: DriveAccount;
	private driveClient: drive_v3.Drive;

	private channelId: string | null | undefined = null;
	private resourceId: string | null | undefined = null;
	private channelExpiration: number | null | undefined = null;
	private isStarting = false;

	constructor(
		private readonly logger: Logger,
		private readonly config: Config,
		private readonly account: Account,
		private readonly channelRepository: ChannelRepository,
	) {
		const driveAccount = this.config.drive_accounts.find((drive) => drive.id === this.account.props.drive_account_id);

		if (!driveAccount) {
			throw new Error(`Failed to find drive account for ${this.account.name}`);
		}

		this.driveAccount = driveAccount;
		this.driveClient = getDriveClient(driveAccount);
	}

	public async start() {
		if (this.isStarting) {
			this.logger.warn("start() already in progress, skipping duplicate call");
			return;
		}
		this.isStarting = true;

		this.logger.info(`Starting ...`);

		const existing = this.channelRepository.get(this.account.id);
		if (existing) {
			this.logger.info(`Stopping existing channel ${existing.channelId} before creating a new one`);
			await this.driveClient.channels
				.stop({
					requestBody: {
						id: existing.channelId,
						resourceId: existing.resourceId,
					},
				})
				.then(() => {
					this.logger.info(`Stopped existing channel ${existing.channelId}`);
				})
				.catch((err) => {
					this.logger.warn(`Failed to stop existing channel ${existing.channelId}: ${err.message}`, { error: err });
				});
		}

		const channelId = crypto.randomUUID();
		const channelAddress = new URL("/webhook", this.config.server.drive_monitor.webhook_url).href;
		const channelExpiration = Date.now() + this.driveAccount.props.channel_expiration_sec * 1000;

		this.logger.debug({
			channelId,
			channelAddress,
			channelExpiration,
		});

		try {
			const channel = await this.driveClient.files.watch({
				fileId: this.account.props.drive_src_folder_id,
				requestBody: {
					id: channelId,
					type: "webhook",
					address: channelAddress,
					expiration: channelExpiration.toString(),
					payload: true,
				},
			});

			if (!channel.data.id) {
				throw new Error("Channel start failed: id not set");
			}

			if (!channel.data.expiration) {
				throw new Error("Channel start failed: expiration not set");
			}

			if (!channel.data.resourceId) {
				throw new Error("Channel start failed: resourceId not set");
			}

			this.logger.info(`Channel started`, { channel });

			this.channelId = channel.data.id;
			this.resourceId = channel.data.resourceId;
			this.channelExpiration = Number.parseInt(channel.data.expiration, 10);

			this.channelRepository.upsert(this.account.id, this.channelId, this.resourceId, this.channelExpiration);
		} finally {
			this.isStarting = false;
		}
	}

	public async stop() {
		this.logger.info(`Stopping ...`);

		if (!this.channelId || !this.resourceId) {
			throw new Error("Channel id or resource id not set");
		}

		const cid = this.channelId;
		const rid = this.resourceId;
		this.channelId = null;
		this.resourceId = null;

		await this.driveClient.channels
			.stop({
				requestBody: {
					id: cid,
					resourceId: rid,
				},
			})
			.catch((err) => {
				this.logger.error(`Failed to stop channel with id ${cid}: ${err.message}`, { error: err });
			});
	}

	public getChannelId() {
		return this.channelId;
	}
}
