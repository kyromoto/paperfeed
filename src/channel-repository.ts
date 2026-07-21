import type { Db } from "./db";

export type ChannelState = {
	channelId: string;
	resourceId: string;
	expiration: number;
};

export class ChannelRepository {
	constructor(private readonly db: Db) {}

	public get(accountId: string): ChannelState | undefined {
		return this.db
			.prepare(
				"SELECT channel_id as channelId, resource_id as resourceId, expiration FROM drive_channels WHERE account_id = ?",
			)
			.get(accountId) as ChannelState | undefined;
	}

	public upsert(accountId: string, channelId: string, resourceId: string, expiration: number): void {
		this.db
			.prepare(`
				INSERT INTO drive_channels (account_id, channel_id, resource_id, expiration, updated_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT (account_id) DO UPDATE SET channel_id = excluded.channel_id, resource_id = excluded.resource_id, expiration = excluded.expiration, updated_at = excluded.updated_at
			`)
			.run(accountId, channelId, resourceId, expiration, Date.now());
	}
}
