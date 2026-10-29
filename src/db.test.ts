import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "./db";

const tables = (db: Database.Database) =>
	(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
		(row) => row.name,
	);

const columns = (db: Database.Database, table: string) =>
	(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name);

describe("migrate", () => {
	it("creates both tables on an empty database", () => {
		const db = new Database(":memory:");

		migrate(db);

		expect(tables(db)).toEqual(expect.arrayContaining(["change_tokens", "drive_channels"]));
		expect(columns(db, "drive_channels")).toEqual(
			expect.arrayContaining(["account_id", "channel_id", "resource_id", "expiration", "updated_at"]),
		);
	});

	it("is idempotent and keeps existing rows", () => {
		const db = new Database(":memory:");
		migrate(db);
		db.prepare("INSERT INTO change_tokens VALUES (?, ?, ?, ?)").run("acc", "folder", "token", 1);

		migrate(db);

		expect(db.prepare("SELECT token FROM change_tokens").all()).toEqual([{ token: "token" }]);
	});

	it("adds the resource_id column to a drive_channels table that predates it", () => {
		const db = new Database(":memory:");
		db.exec(`
			CREATE TABLE drive_channels (
				account_id TEXT PRIMARY KEY,
				channel_id TEXT NOT NULL,
				expiration INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			INSERT INTO drive_channels VALUES ('acc', 'channel', 100, 1);
		`);

		migrate(db);

		expect(columns(db, "drive_channels")).toContain("resource_id");
		expect(db.prepare("SELECT channel_id, resource_id FROM drive_channels").get()).toEqual({
			channel_id: "channel",
			resource_id: "",
		});
	});
});
