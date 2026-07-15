import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "@logtape/logtape";
import { JWT } from "google-auth-library";
import { type drive_v3, google } from "googleapis";
import type { ChangeTokenRepository } from "./change-token-repository";
import type { FileProcessor } from "./file-processor";
import type { Account, Config, DriveAccount } from "./types";

export const listFilesRecursive = async (
	account: Account,
	drive: drive_v3.Drive,
) => {
	const fn = async (
		pageToken?: string,
	): Promise<Array<drive_v3.Schema$File>> => {
		const res = await drive.files.list({
			q: `'${account.props.drive_src_folder_id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
			fields:
				"nextPageToken, files(id, name, size, properties, mimeType, createdTime, modifiedTime)",
			orderBy: "modifiedTime desc",
			pageSize: 100,
			...(pageToken && { pageToken }),
		});

		const files = res.data.files || [];
		const next = res.data.nextPageToken;

		if (!next) return files;

		return files.concat(await fn(next));
	};

	return await fn();
};

export const listChangesRecursive = async (
	config: Config,
	changeTokenRepository: ChangeTokenRepository,
	account: Account,
	drive: drive_v3.Drive,
) => {
	const folderId = account.props.drive_src_folder_id;
	const token = await getChangeToken(config, changeTokenRepository, account, folderId, drive);

	const fn = async (pageToken?: string): Promise<drive_v3.Schema$Change[]> => {
		const res = await drive.changes.list({
			spaces: "drive",
			includeRemoved: true,
			pageSize: 100,
			...(pageToken && { pageToken }),
		});

		const changes = res.data.changes || [];
		const next = res.data.nextPageToken;

		if (next) {
			return changes.concat(await fn(next));
		}

		if (res.data.newStartPageToken) {
			changeTokenRepository.set(account.id, folderId, res.data.newStartPageToken);
		}

		return changes;
	};

	return await fn(token);
};

const getChangeToken = async (
	config: Config,
	changeTokenRepository: ChangeTokenRepository,
	account: Account,
	folderId: string,
	drive: drive_v3.Drive,
): Promise<string> => {
	const stored = changeTokenRepository.get(account.id, folderId);

	if (stored) {
		return stored;
	}

	const legacy = await readLegacyChangeToken(config, account);

	if (legacy) {
		changeTokenRepository.set(account.id, folderId, legacy);
		return legacy;
	}

	const res = await drive.changes.getStartPageToken({});

	if (!res.data.startPageToken) {
		throw new Error(`Failed to get start page token for ${account.name}`);
	}

	changeTokenRepository.set(account.id, folderId, res.data.startPageToken);
	return res.data.startPageToken;
};

// One-time migration path from the pre-SQLite file-based token store. Can be
// removed once all deployments have run once with the SQLite-backed store.
const readLegacyChangeToken = async (config: Config, account: Account): Promise<string | undefined> => {
	const filepath = path.join(
		config.server.data_path,
		"tokens",
		`${account.id}.${account.props.drive_src_folder_id}.change-token.txt`,
	);

	const raw = await fs.readFile(filepath, "utf-8").catch(() => undefined);
	return raw?.trim() || undefined;
};

export const stopChannels = async (
	channelIds: string[],
	drive: drive_v3.Drive,
) => {
	for (const channelId of channelIds) {
		await drive.channels
			.stop({
				requestBody: {
					id: channelId,
				},
			})
			.catch((err) => {
				console.error(
					`Failed to stop channel with id ${channelId}: ${err.message}`,
					{ error: err },
				);
			});
	}
};

export const getDriveClient = (drive: DriveAccount) => {
	return google.drive({
		version: "v3",
		auth: new JWT({
			email: drive.props.credentials.client_email,
			key: drive.props.credentials.private_key,
			scopes: ["https://www.googleapis.com/auth/drive"],
		}),
	});
};

export const createNotificationTask =
	(logger: Logger, processor: FileProcessor) => async () => {
		logger.info(`Getting unprocessed files...`);
		return await processor.getUnprocessedFiles("changes");
	};
