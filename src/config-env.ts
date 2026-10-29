import * as yml from "yaml";
import { Config } from "./types";

type ServerVariable = {
	name: string;
	path: string[];
	type: "string" | "number";
	required?: boolean;
};

// Explicit table instead of deriving names from keys: keys contain underscores (drive_monitor, webhook_url) and camelCase
export const SERVER_VARIABLES: ServerVariable[] = [
	{ name: "SERVER_DATA_PATH", path: ["data_path"], type: "string", required: true },
	{ name: "SERVER_HTTP_PORT", path: ["http", "port"], type: "number" },
	{ name: "SERVER_QUEUE_REDIS_URL", path: ["queue", "redis", "url"], type: "string", required: true },
	{ name: "SERVER_QUEUE_REDIS_PREFIX", path: ["queue", "redis", "prefix"], type: "string" },
	{ name: "SERVER_QUEUE_CONCURRENCY_COLLECT", path: ["queue", "concurrency", "collect"], type: "number" },
	{ name: "SERVER_QUEUE_CONCURRENCY_PROCESS", path: ["queue", "concurrency", "process"], type: "number" },
	{ name: "SERVER_QUEUE_CONCURRENCY_RENEW", path: ["queue", "concurrency", "renew"], type: "number" },
	{
		name: "SERVER_QUEUE_DEBOUNCE_COLLECT_CHANGES_SEC",
		path: ["queue", "debounce", "collectChangesSec"],
		type: "number",
	},
	{ name: "SERVER_QUEUE_RENEW_POLL_INTERVAL_SEC", path: ["queue", "renewPollIntervalSec"], type: "number" },
	{ name: "SERVER_DRIVE_MONITOR_WEBHOOK_URL", path: ["drive_monitor", "webhook_url"], type: "string", required: true },
	{ name: "SERVER_NOTIFICATIONS_WEBHOOK_URL", path: ["notifications", "webhook_url"], type: "string" },
];

/** Problems with the composed configuration. Messages name variables and key paths, never values. */
export class ConfigError extends Error {
	constructor(public readonly issues: string[]) {
		super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
	}
}

const variableByPath = (path: string[]) =>
	SERVER_VARIABLES.find((variable) => variable.path.join(".") === path.join("."));

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const leafPaths = (value: unknown, prefix: string[] = []): string[][] => {
	if (!isRecord(value) || Object.keys(value).length === 0) {
		return [prefix];
	}

	return Object.entries(value).flatMap(([key, child]) => leafPaths(child, [...prefix, key]));
};

const setPath = (target: Record<string, unknown>, path: string[], value: unknown) => {
	let node = target;

	for (const key of path.slice(0, -1)) {
		const next = node[key];

		if (isRecord(next)) {
			node = next;
		} else {
			const created: Record<string, unknown> = {};
			node[key] = created;
			node = created;
		}
	}

	node[path[path.length - 1]] = value;
};

const rejectLegacyServerBlock = (server: unknown): string[] =>
	leafPaths(server).map((path) => {
		const yamlPath = ["server", ...path].join(".");
		const variable = path.length > 0 ? variableByPath(path) : undefined;

		return variable
			? `${yamlPath} in the YAML is no longer supported, set ${variable.name} instead`
			: `${yamlPath} in the YAML is no longer supported, the server section is configured through SERVER_* environment variables only`;
	});

const buildServer = (env: NodeJS.ProcessEnv, issues: string[]) => {
	const server: Record<string, unknown> = {};

	for (const variable of SERVER_VARIABLES) {
		const raw = env[variable.name];

		if (raw === undefined || raw.trim() === "") {
			if (variable.required) {
				issues.push(`${variable.name} is required (server.${variable.path.join(".")})`);
			}
			continue;
		}

		if (variable.type === "number") {
			const value = Number(raw);

			if (!Number.isFinite(value)) {
				issues.push(`${variable.name} must be a number (server.${variable.path.join(".")})`);
				continue;
			}

			setPath(server, variable.path, value);
		} else {
			setPath(server, variable.path, raw);
		}
	}

	return server;
};

/** Describes a Zod issue by key path (plus the variable behind it), never by value. */
const describeIssue = (path: (string | number)[], message: string) => {
	const variable = path[0] === "server" ? variableByPath(path.slice(1).map(String)) : undefined;
	const where = path.length > 0 ? path.join(".") : "(root)";

	return variable ? `${where} (${variable.name}): ${message}` : `${where}: ${message}`;
};

/**
 * Composes the configuration: accounts from the YAML object, the `server` section from the environment.
 * Pure function, throws a ConfigError listing every problem found.
 */
export const composeConfig = (yamlObject: unknown, env: NodeJS.ProcessEnv): Config => {
	const issues: string[] = [];
	const yaml = isRecord(yamlObject) ? { ...yamlObject } : {};

	if ("server" in yaml) {
		issues.push(...rejectLegacyServerBlock(yaml.server));
		delete yaml.server;
	}

	const server = buildServer(env, issues);
	const parsed = Config.safeParse({ ...yaml, server });

	if (!parsed.success) {
		const hasMissingVariables = issues.some((issue) => issue.includes(" is required "));

		for (const issue of parsed.error.issues) {
			const isServerIssue = issue.path[0] === "server";
			const variable = isServerIssue ? variableByPath(issue.path.slice(1).map(String)) : undefined;

			// missing and non-numeric server values are already reported by variable name
			if (variable && issues.some((existing) => existing.startsWith(`${variable.name} `))) {
				continue;
			}
			if (isServerIssue && hasMissingVariables && issue.message === "Required") {
				continue;
			}

			issues.push(describeIssue(issue.path, issue.message));
		}
	}

	if (issues.length > 0 || !parsed.success) {
		throw new ConfigError(issues);
	}

	return parsed.data;
};

/** Parses the YAML text. Parse errors quote the offending source line (possibly a secret), so only code and position are reported. */
export const parseYaml = (text: string): unknown => {
	try {
		return yml.parse(text);
	} catch (error) {
		if (error instanceof yml.YAMLParseError) {
			throw new ConfigError([
				`Cannot parse the YAML configuration: ${error.code} at line ${error.linePos?.[0].line ?? "?"}`,
			]);
		}
		throw new ConfigError(["Cannot parse the YAML configuration"]);
	}
};
