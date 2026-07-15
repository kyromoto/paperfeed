import type { Db } from "./db";

export type ChannelState = {
	channelId: string;
	expiration: number;
};

export class ChannelRepository {
	constructor(private readonly db: Db) {}

	public get(accountId: string): ChannelState | undefined {
		return this.db
			.prepare("SELECT channel_id as channelId, expiration FROM drive_channels WHERE account_id = ?")
			.get(accountId) as ChannelState | undefined;
	}

	public upsert(accountId: string, channelId: string, expiration: number): void {
		this.db
			.prepare(`
				INSERT INTO drive_channels (account_id, channel_id, expiration, updated_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT (account_id) DO UPDATE SET channel_id = excluded.channel_id, expiration = excluded.expiration, updated_at = excluded.updated_at
			`)
			.run(accountId, channelId, expiration, Date.now());
	}
}
