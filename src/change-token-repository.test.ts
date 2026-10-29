import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { ChangeTokenRepository } from "./change-token-repository";
import { migrate } from "./db";

describe("ChangeTokenRepository", () => {
	let repository: ChangeTokenRepository;

	beforeEach(() => {
		const db = new Database(":memory:");
		migrate(db);
		repository = new ChangeTokenRepository(db);
	});

	it("returns undefined when no token is stored", () => {
		expect(repository.get("acc", "folder")).toBeUndefined();
	});

	it("stores and reads a token", () => {
		repository.set("acc", "folder", "token-1");

		expect(repository.get("acc", "folder")).toBe("token-1");
	});

	it("overwrites an existing token", () => {
		repository.set("acc", "folder", "token-1");
		repository.set("acc", "folder", "token-2");

		expect(repository.get("acc", "folder")).toBe("token-2");
	});

	it("keeps tokens of different accounts and folders apart", () => {
		repository.set("acc-1", "folder-1", "a");
		repository.set("acc-1", "folder-2", "b");
		repository.set("acc-2", "folder-1", "c");

		expect(repository.get("acc-1", "folder-1")).toBe("a");
		expect(repository.get("acc-1", "folder-2")).toBe("b");
		expect(repository.get("acc-2", "folder-1")).toBe("c");
	});

	describe("delete", () => {
		it("removes only the addressed token and reports it", () => {
			repository.set("acc", "folder-1", "a");
			repository.set("acc", "folder-2", "b");

			expect(repository.delete("acc", "folder-1")).toBe(true);

			expect(repository.get("acc", "folder-1")).toBeUndefined();
			expect(repository.get("acc", "folder-2")).toBe("b");
		});

		it("returns false when nothing was stored", () => {
			expect(repository.delete("acc", "folder")).toBe(false);
		});
	});
});
