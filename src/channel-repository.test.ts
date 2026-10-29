import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { ChannelRepository } from "./channel-repository";
import { migrate } from "./db";

describe("ChannelRepository", () => {
	let repository: ChannelRepository;

	beforeEach(() => {
		const db = new Database(":memory:");
		migrate(db);
		repository = new ChannelRepository(db);
	});

	it("returns undefined when no channel is stored", () => {
		expect(repository.get("acc")).toBeUndefined();
	});

	it("stores and reads the channel state including the resource id", () => {
		repository.upsert("acc", "channel-1", "resource-1", 1000);

		expect(repository.get("acc")).toEqual({ channelId: "channel-1", resourceId: "resource-1", expiration: 1000 });
	});

	it("replaces the state of an account on upsert", () => {
		repository.upsert("acc", "channel-1", "resource-1", 1000);
		repository.upsert("acc", "channel-2", "resource-2", 2000);

		expect(repository.get("acc")).toEqual({ channelId: "channel-2", resourceId: "resource-2", expiration: 2000 });
	});

	it("keeps accounts apart", () => {
		repository.upsert("acc-1", "channel-1", "resource-1", 1000);
		repository.upsert("acc-2", "channel-2", "resource-2", 2000);

		expect(repository.get("acc-1")?.channelId).toBe("channel-1");
		expect(repository.get("acc-2")?.channelId).toBe("channel-2");
	});

	describe("delete", () => {
		it("removes only the addressed account and reports it", () => {
			repository.upsert("acc-1", "channel-1", "resource-1", 1000);
			repository.upsert("acc-2", "channel-2", "resource-2", 2000);

			expect(repository.delete("acc-1")).toBe(true);

			expect(repository.get("acc-1")).toBeUndefined();
			expect(repository.get("acc-2")).toBeDefined();
		});

		it("returns false when nothing was stored", () => {
			expect(repository.delete("acc")).toBe(false);
		});
	});
});
