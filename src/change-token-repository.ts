import type { Db } from "./db";

export class ChangeTokenRepository {
	constructor(private readonly db: Db) {}

	public get(accountId: string, folderId: string): string | undefined {
		const row = this.db
			.prepare("SELECT token FROM change_tokens WHERE account_id = ? AND folder_id = ?")
			.get(accountId, folderId) as { token: string } | undefined;

		return row?.token;
	}

	public set(accountId: string, folderId: string, token: string): void {
		this.db
			.prepare(`
				INSERT INTO change_tokens (account_id, folder_id, token, updated_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT (account_id, folder_id) DO UPDATE SET token = excluded.token, updated_at = excluded.updated_at
			`)
			.run(accountId, folderId, token, Date.now());
	}
}
