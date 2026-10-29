import path from "node:path";
import { parseArgs } from "node:util";
import type { Logger } from "@logtape/logtape";
import axios from "axios";
import IORedis from "ioredis";
import * as yml from "yaml";
import type { Account, Config } from "./types";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;
const ONLINE_CHECK_TIMEOUT_MS = 10_000;
const HEALTHCHECK_TIMEOUT_MS = 4_000;

type Context = {
	logger: Logger;
	args: { positionals: string[]; online: boolean };
	onClose: (fn: () => Promise<unknown> | unknown) => void;
};

type Command = {
	usage: string;
	description: string;
	needsAccount: boolean;
	run: (ctx: Context) => Promise<number>;
};

class UsageError extends Error {}

const out = (line = "") => process.stdout.write(`${line}\n`);

const commands: Record<string, Command> = {
	"validate-config": {
		usage: "validate-config [--online]",
		description: "Validate config file; --online also checks Redis, Drive folders and Paperless login",
		needsAccount: false,
		run: validateConfig,
	},
	healthcheck: {
		usage: "healthcheck",
		description: "Check GET /health of the local app on the port from the config (used by the Docker HEALTHCHECK)",
		needsAccount: false,
		run: healthcheck,
	},
	migrate: {
		usage: "migrate",
		description: "Run SQLite migrations in {data_path}/db without starting the app",
		needsAccount: false,
		run: migrateCommand,
	},
	"reset-token": {
		usage: "reset-token <account>",
		description: "Delete the stored Drive change token of an account (next collect starts from a fresh token)",
		needsAccount: true,
		run: resetToken,
	},
	"reset-channel": {
		usage: "reset-channel <account>",
		description: "Stop the persisted Drive webhook channel of an account and delete its state",
		needsAccount: true,
		run: resetChannel,
	},
	requeue: {
		usage: "requeue <account>",
		description: "Queue all files currently in the source folder of an account for processing",
		needsAccount: true,
		run: requeue,
	},
};

const printHelp = () => {
	out("Usage: node build/cli.js <command> [options]");
	out();
	out("Commands:");
	for (const command of Object.values(commands)) {
		out(`  ${command.usage.padEnd(34)}${command.description}`);
	}
	out();
	out("<account> is the id or name of an account in the config. Config is read from CONFIG_PATH.");
};

const readConfig = async (logger: Logger) => {
	const env = await import("./env");
	const { ConfigFileRepository } = await import("./config-repository");
	return new ConfigFileRepository(logger.getChild("config-repository"), env.CONFIG_PATH).read();
};

const resolveAccount = (config: Config, identifier: string): Account => {
	const matches = config.accounts.filter((account) => account.id === identifier || account.name === identifier);

	if (matches.length === 1) {
		return matches[0];
	}

	const available = config.accounts.map((account) => `  ${account.name} (${account.id})`).join("\n");
	throw new Error(
		`${matches.length === 0 ? "Unknown" : "Ambiguous"} account "${identifier}". Available accounts:\n${available}`,
	);
};

const getDriveAccount = (config: Config, account: Account) => {
	const driveAccount = config.drive_accounts.find((drive) => drive.id === account.props.drive_account_id);

	if (!driveAccount) {
		throw new Error(`Drive account ${account.props.drive_account_id} of account ${account.name} not found`);
	}

	return driveAccount;
};

const openDb = async (ctx: Context, config: Config) => {
	const { openDatabase } = await import("./db");
	const db = openDatabase(config.server.data_path);
	ctx.onClose(() => db.close());
	return db;
};

async function healthcheck(ctx: Context) {
	const config = await readConfig(ctx.logger);
	const url = `http://127.0.0.1:${config.server.http.port}/health`;

	try {
		await axios.get(url, { timeout: HEALTHCHECK_TIMEOUT_MS });
		out(`OK ${url}`);
		return EXIT_OK;
	} catch (error) {
		out(`FAILED ${url}: ${error instanceof Error ? error.message : String(error)}`);
		return EXIT_ERROR;
	}
}

async function migrateCommand(ctx: Context) {
	const config = await readConfig(ctx.logger);
	await openDb(ctx, config);
	out(`Migrations applied: ${path.join(config.server.data_path, "db", "paperfeed.db")}`);
	return EXIT_OK;
}

async function resetToken(ctx: Context) {
	const config = await readConfig(ctx.logger);
	const account = resolveAccount(config, ctx.args.positionals[1]);
	const folderId = account.props.drive_src_folder_id;
	const db = await openDb(ctx, config);
	const { ChangeTokenRepository } = await import("./change-token-repository");

	ctx.logger.warn(
		"If the app is running, a collect-changes job in progress may write a new token again. Changes made before the next collect are not tracked; run `requeue` to pick up files already in the source folder.",
	);

	if (new ChangeTokenRepository(db).delete(account.id, folderId)) {
		out(`${account.name}: change token for folder ${folderId} deleted`);
	} else {
		out(`${account.name}: no change token stored, nothing to do`);
	}

	return EXIT_OK;
}

async function resetChannel(ctx: Context) {
	const config = await readConfig(ctx.logger);
	const account = resolveAccount(config, ctx.args.positionals[1]);
	const db = await openDb(ctx, config);
	const { ChannelRepository } = await import("./channel-repository");
	const channelRepository = new ChannelRepository(db);
	const channel = channelRepository.get(account.id);

	if (!channel) {
		out(`${account.name}: no channel stored, nothing to do`);
		return EXIT_OK;
	}

	ctx.logger.warn(
		"If the app is running, a renew-channel job in progress may briefly create a second channel; the old one is stopped on the next start.",
	);

	const { getDriveClient } = await import("./lib");
	const drive = getDriveClient(getDriveAccount(config, account));

	await drive.channels
		.stop({ requestBody: { id: channel.channelId, resourceId: channel.resourceId } })
		.then(() => out(`${account.name}: channel ${channel.channelId} stopped`))
		.catch((error: Error) =>
			ctx.logger.warn(`Failed to stop channel ${channel.channelId}: ${error.message}`, { error }),
		);

	channelRepository.delete(account.id);
	out(`${account.name}: channel state deleted; the renewal poller of a running app creates a new channel`);
	return EXIT_OK;
}

async function requeue(ctx: Context) {
	const config = await readConfig(ctx.logger);
	const account = resolveAccount(config, ctx.args.positionals[1]);
	const db = await openDb(ctx, config);

	const { ChangeTokenRepository } = await import("./change-token-repository");
	const { FileProcessor } = await import("./file-processor");
	const { FileStore } = await import("./file-store");
	const { getDriveClient } = await import("./lib");
	const { collectOutstandingJobs } = await import("./queue-utils");
	const { connectRedis, createQueues, PROCESS_CHANGES_QUEUE } = await import("./queues");

	const processor = new FileProcessor(
		ctx.logger.getChild(["file-processor", account.name]),
		config,
		new FileStore(path.join(config.server.data_path, "files")),
		new ChangeTokenRepository(db),
		account,
		getDriveClient(getDriveAccount(config, account)),
	);

	const redisConnection = await connectRedis(config.server.queue.redis.url);
	const { collectChangesQueue, processChangesQueue, renewChannelQueue } = createQueues(
		redisConnection,
		config.server.queue.redis.prefix,
	);
	ctx.onClose(() =>
		Promise.allSettled([collectChangesQueue, processChangesQueue, renewChannelQueue].map((q) => q.close())),
	);
	ctx.onClose(() => redisConnection.quit());

	const jobs = await collectOutstandingJobs(new Map([[account.id, processor]]), PROCESS_CHANGES_QUEUE);

	if (jobs.length > 0) {
		await processChangesQueue.addBulk(jobs);
	}

	out(`${account.name}: ${jobs.length} file(s) queued for processing`);
	return EXIT_OK;
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
	let timer: NodeJS.Timeout;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

async function validateConfig(ctx: Context) {
	const env = await import("./env");
	const { Config } = await import("./types");
	let failed = false;

	const fail = (message: string) => {
		failed = true;
		out(`✖ ${message}`);
	};

	let raw: unknown;
	try {
		const fs = await import("node:fs/promises");
		raw = yml.parse(await fs.readFile(env.CONFIG_PATH, "utf-8"));
	} catch (error) {
		// YAML parse errors quote the offending source line, so only the error code and position are reported
		const code = error instanceof yml.YAMLParseError ? error.code : (error as NodeJS.ErrnoException).code;
		const line = error instanceof yml.YAMLParseError ? ` at line ${error.linePos?.[0].line}` : "";
		fail(`Cannot read ${env.CONFIG_PATH}: ${code ?? "unknown error"}${line}`);
		return EXIT_ERROR;
	}

	const parsed = Config.safeParse(raw);

	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			fail(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
		}
		return EXIT_ERROR;
	}

	const config = parsed.data;
	out(`✔ Schema valid (${env.CONFIG_PATH})`);

	const lists = {
		accounts: config.accounts,
		drive_accounts: config.drive_accounts,
		paperless_endpoints: config.paperless_endpoints,
	};

	for (const [name, list] of Object.entries(lists)) {
		const seen = new Set<string>();
		for (const item of list) {
			if (seen.has(item.id)) {
				fail(`${name}: duplicate id ${item.id}`);
			}
			seen.add(item.id);
		}
	}

	for (const account of config.accounts) {
		if (!config.drive_accounts.some((drive) => drive.id === account.props.drive_account_id)) {
			fail(`account ${account.name}: drive_account_id ${account.props.drive_account_id} not found`);
		}
		if (!config.paperless_endpoints.some((endpoint) => endpoint.id === account.props.paperless_endpoint_id)) {
			fail(`account ${account.name}: paperless_endpoint_id ${account.props.paperless_endpoint_id} not found`);
		}
	}

	if (!failed) {
		out(`✔ References valid (${config.accounts.length} account(s))`);
	}

	if (ctx.args.online) {
		const check = async (label: string, fn: () => Promise<unknown>) => {
			try {
				await withTimeout(fn(), ONLINE_CHECK_TIMEOUT_MS);
				out(`✔ ${label}`);
			} catch (error) {
				fail(`${label}: ${error instanceof Error ? error.message : String(error)}`);
			}
		};

		await check(`Redis ${config.server.queue.redis.url}`, async () => {
			const redis = new IORedis(config.server.queue.redis.url, { maxRetriesPerRequest: 1, lazyConnect: true });
			redis.on("error", () => {});
			try {
				await redis.connect();
				await redis.ping();
			} finally {
				redis.disconnect();
			}
		});

		const { getDriveClient } = await import("./lib");

		for (const account of config.accounts) {
			const driveAccount = config.drive_accounts.find((drive) => drive.id === account.props.drive_account_id);
			const endpoint = config.paperless_endpoints.find((e) => e.id === account.props.paperless_endpoint_id);

			if (driveAccount) {
				const drive = getDriveClient(driveAccount);
				for (const [label, fileId] of [
					["source", account.props.drive_src_folder_id],
					["destination", account.props.drive_dst_folder_id],
				] as const) {
					await check(`${account.name}: Drive ${label} folder ${fileId}`, async () => {
						const res = await drive.files.get({ fileId, fields: "id,mimeType" });
						if (res.data.mimeType !== "application/vnd.google-apps.folder") {
							throw new Error("not a folder");
						}
					});
				}
			}

			if (endpoint) {
				await check(`${account.name}: Paperless ${endpoint.props.server_url}`, async () => {
					await axios.get(`${endpoint.props.server_url}/api/documents/?page_size=1`, {
						auth: endpoint.props.credentials,
						timeout: ONLINE_CHECK_TIMEOUT_MS,
					});
				});
			}
		}
	}

	return failed ? EXIT_ERROR : EXIT_OK;
}

const parseCommandLine = (argv: string[]) => {
	try {
		const { values, positionals } = parseArgs({
			args: argv,
			allowPositionals: true,
			options: { online: { type: "boolean", default: false }, help: { type: "boolean", short: "h", default: false } },
		});

		const command = commands[positionals[0] ?? ""];

		if (values.help || !command) {
			throw new UsageError(values.help ? "" : `Unknown or missing command: ${positionals[0] ?? "(none)"}`);
		}

		if (command.needsAccount && !positionals[1]) {
			throw new UsageError(`Missing account. Usage: ${command.usage}`);
		}

		return { command, args: { positionals, online: values.online } };
	} catch (error) {
		throw error instanceof UsageError ? error : new UsageError((error as Error).message);
	}
};

async function main() {
	let parsed: ReturnType<typeof parseCommandLine>;

	try {
		parsed = parseCommandLine(process.argv.slice(2));
	} catch (error) {
		if (error instanceof UsageError && error.message) {
			process.stderr.write(`${error.message}\n\n`);
		}
		printHelp();
		return EXIT_USAGE;
	}

	const closers: Array<() => Promise<unknown> | unknown> = [];
	let exitCode = EXIT_ERROR;
	let logger: Logger | undefined;

	try {
		const { configureLogging } = await import("./logging");
		logger = (await configureLogging()).getChild("cli");
		exitCode = await parsed.command.run({ logger, args: parsed.args, onClose: (fn) => closers.push(fn) });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (logger) {
			logger.error(message, { error });
		} else {
			process.stderr.write(`${message}\n`);
		}
	} finally {
		await Promise.allSettled(closers.reverse().map((close) => close()));
	}

	return exitCode;
}

main().then((code) => {
	process.exitCode = code;
});
