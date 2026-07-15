import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

export const openDatabase = (dataPath: string): Db => {
	const db = new Database(path.join(dataPath, "paperfeed.db"));
	db.pragma("journal_mode = WAL");
	migrate(db);
	return db;
};

const migrate = (db: Db) => {
	db.exec(`
		CREATE TABLE IF NOT EXISTS change_tokens (
			account_id TEXT NOT NULL,
			folder_id TEXT NOT NULL,
			token TEXT NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (account_id, folder_id)
		);

		CREATE TABLE IF NOT EXISTS drive_channels (
			account_id TEXT PRIMARY KEY,
			channel_id TEXT NOT NULL,
			expiration INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
	`);
};
