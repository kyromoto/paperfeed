import { describe, expect, it } from "vitest";
import { ConfigError, composeConfig, parseYaml, SERVER_VARIABLES } from "./config-env";

const ACCOUNTS = {
	drive_accounts: [
		{
			id: "11111111-1111-4111-8111-111111111111",
			name: "drive",
			props: {
				credentials: {
					type: "service_account",
					project_id: "p",
					private_key_id: "kid",
					private_key: "TOP-SECRET-KEY",
					client_email: "x@p.iam.gserviceaccount.com",
					client_id: "1",
					auth_uri: "https://a",
					token_uri: "https://t",
					auth_provider_x509_cert_url: "https://c",
					universe_domain: "googleapis.com",
				},
			},
		},
	],
	paperless_endpoints: [
		{
			id: "22222222-2222-4222-8222-222222222222",
			name: "paperless",
			props: { server_url: "http://paperless:8000", credentials: { username: "u", password: "TOP-SECRET-PW" } },
		},
	],
	accounts: [
		{
			id: "33333333-3333-4333-8333-333333333333",
			name: "acc",
			props: {
				paperless_endpoint_id: "22222222-2222-4222-8222-222222222222",
				drive_account_id: "11111111-1111-4111-8111-111111111111",
				drive_src_folder_id: "src",
				drive_dst_folder_id: "dst",
			},
		},
	],
};

const REQUIRED_ENV = {
	SERVER_DATA_PATH: "/data",
	SERVER_QUEUE_REDIS_URL: "redis://user:REDIS-SECRET@redis:6379",
	SERVER_DRIVE_MONITOR_WEBHOOK_URL: "https://paperfeed.example.com",
};

const issuesOf = (fn: () => unknown): string[] => {
	try {
		fn();
	} catch (error) {
		if (error instanceof ConfigError) {
			return error.issues;
		}
		throw error;
	}
	throw new Error("expected a ConfigError");
};

describe("composeConfig", () => {
	it("builds the server section from the environment and keeps the accounts from the YAML", () => {
		const config = composeConfig(ACCOUNTS, {
			...REQUIRED_ENV,
			SERVER_HTTP_PORT: "8080",
			SERVER_QUEUE_REDIS_PREFIX: "custom",
			SERVER_QUEUE_CONCURRENCY_PROCESS: "2",
			SERVER_QUEUE_DEBOUNCE_COLLECT_CHANGES_SEC: "30",
			SERVER_QUEUE_RENEW_POLL_INTERVAL_SEC: "10",
		});

		expect(config.server).toMatchObject({
			data_path: "/data",
			http: { port: 8080 },
			queue: {
				redis: { url: REQUIRED_ENV.SERVER_QUEUE_REDIS_URL, prefix: "custom" },
				concurrency: { collect: 5, process: 2, renew: 1 },
				debounce: { collectChangesSec: 30 },
				renewPollIntervalSec: 10,
			},
			drive_monitor: { webhook_url: "https://paperfeed.example.com" },
		});
		expect(config.drive_accounts[0].props.credentials.private_key).toBe("TOP-SECRET-KEY");
		expect(config.paperless_endpoints[0].props.credentials.password).toBe("TOP-SECRET-PW");
		expect(config.accounts).toHaveLength(1);
	});

	it("uses the defaults when only the required variables are set", () => {
		const config = composeConfig(ACCOUNTS, REQUIRED_ENV);

		expect(config.server.http.port).toBe(3000);
		expect(config.server.queue.redis.prefix).toBe("paperless-gdrive-link");
		expect(config.server.queue.concurrency).toEqual({ collect: 5, process: 1, renew: 1 });
		expect(config.server.queue.debounce.collectChangesSec).toBe(5);
		expect(config.server.queue.renewPollIntervalSec).toBe(15);
	});

	it("leaves notifications off when the webhook variable is not set", () => {
		expect(composeConfig(ACCOUNTS, REQUIRED_ENV).server.notifications).toBeUndefined();
	});

	it("reads the optional notification webhook url from the environment", () => {
		const config = composeConfig(ACCOUNTS, {
			...REQUIRED_ENV,
			SERVER_NOTIFICATIONS_WEBHOOK_URL: "https://hookshot.example.com/webhook/abc",
		});

		expect(config.server.notifications).toEqual({ webhook_url: "https://hookshot.example.com/webhook/abc" });
	});

	it("treats an empty notification webhook variable as not set", () => {
		const config = composeConfig(ACCOUNTS, { ...REQUIRED_ENV, SERVER_NOTIFICATIONS_WEBHOOK_URL: " " });

		expect(config.server.notifications).toBeUndefined();
	});

	it("rejects an invalid notification url without echoing the value", () => {
		const issues = issuesOf(() =>
			composeConfig(ACCOUNTS, { ...REQUIRED_ENV, SERVER_NOTIFICATIONS_WEBHOOK_URL: "secret-token-not-a-url" }),
		);

		expect(issues).toEqual([expect.stringContaining("SERVER_NOTIFICATIONS_WEBHOOK_URL")]);
		expect(issues.join("\n")).not.toContain("secret-token");
	});

	it("names every missing required variable", () => {
		const issues = issuesOf(() => composeConfig(ACCOUNTS, {}));

		expect(issues).toEqual(
			expect.arrayContaining([
				expect.stringContaining("SERVER_DATA_PATH is required"),
				expect.stringContaining("SERVER_QUEUE_REDIS_URL is required"),
				expect.stringContaining("SERVER_DRIVE_MONITOR_WEBHOOK_URL is required"),
			]),
		);
		expect(issues.filter((issue) => issue.includes("Required"))).toEqual([]);
	});

	it("treats empty and whitespace-only variables as not set", () => {
		const issues = issuesOf(() =>
			composeConfig(ACCOUNTS, { ...REQUIRED_ENV, SERVER_DATA_PATH: "", SERVER_HTTP_PORT: "  " }),
		);

		expect(issues).toEqual([expect.stringContaining("SERVER_DATA_PATH is required")]);
	});

	it("rejects a non-numeric port without echoing the value", () => {
		const issues = issuesOf(() => composeConfig(ACCOUNTS, { ...REQUIRED_ENV, SERVER_HTTP_PORT: "abc" }));

		expect(issues).toEqual(["SERVER_HTTP_PORT must be a number (server.http.port)"]);
	});

	it("reports schema violations with key path and variable name", () => {
		const issues = issuesOf(() => composeConfig(ACCOUNTS, { ...REQUIRED_ENV, SERVER_HTTP_PORT: "80" }));

		expect(issues).toEqual([expect.stringMatching(/^server\.http\.port \(SERVER_HTTP_PORT\): /)]);
	});

	it("does not leak the Redis URL (which may contain credentials) for an invalid URL", () => {
		const issues = issuesOf(() =>
			composeConfig(ACCOUNTS, { ...REQUIRED_ENV, SERVER_QUEUE_REDIS_URL: "REDIS-SECRET not a url" }),
		);

		expect(issues).toEqual([expect.stringContaining("SERVER_QUEUE_REDIS_URL")]);
		expect(issues.join("\n")).not.toContain("REDIS-SECRET");
	});

	it("does not leak secrets of the accounts when they violate the schema", () => {
		const broken = structuredClone(ACCOUNTS) as typeof ACCOUNTS;
		(broken.paperless_endpoints[0].props.credentials as { username: unknown }).username = 42;
		(broken.drive_accounts[0].props.credentials as { type: unknown }).type = "TOP-SECRET-TYPE";

		const issues = issuesOf(() => composeConfig(broken, REQUIRED_ENV));

		expect(issues.length).toBeGreaterThan(0);
		expect(issues.join("\n")).not.toMatch(/TOP-SECRET/);
	});

	describe("legacy server block", () => {
		it("rejects it and names the replacing variable for every known key", () => {
			const issues = issuesOf(() =>
				composeConfig(
					{ ...ACCOUNTS, server: { data_path: "/data", http: { port: 3000 }, queue: { redis: { url: "redis://x" } } } },
					REQUIRED_ENV,
				),
			);

			expect(issues).toEqual([
				"server.data_path in the YAML is no longer supported, set SERVER_DATA_PATH instead",
				"server.http.port in the YAML is no longer supported, set SERVER_HTTP_PORT instead",
				"server.queue.redis.url in the YAML is no longer supported, set SERVER_QUEUE_REDIS_URL instead",
			]);
		});

		it("rejects unknown keys with a generic hint and never echoes values", () => {
			const issues = issuesOf(() => composeConfig({ ...ACCOUNTS, server: { surprise: "SECRET-VALUE" } }, REQUIRED_ENV));

			expect(issues).toEqual([expect.stringContaining("server.surprise in the YAML is no longer supported")]);
			expect(issues.join("\n")).not.toContain("SECRET-VALUE");
		});

		it("rejects an empty server section too", () => {
			const issues = issuesOf(() => composeConfig({ ...ACCOUNTS, server: {} }, REQUIRED_ENV));

			expect(issues).toEqual([expect.stringContaining("server in the YAML is no longer supported")]);
		});
	});

	it("does not mutate the parsed YAML object", () => {
		const yaml = { ...ACCOUNTS, server: { data_path: "/x" } };

		issuesOf(() => composeConfig(yaml, REQUIRED_ENV));

		expect(yaml.server).toEqual({ data_path: "/x" });
	});

	it("covers every variable of the server schema with a unique name", () => {
		const names = SERVER_VARIABLES.map((variable) => variable.name);

		expect(new Set(names).size).toBe(names.length);
		expect(names.every((name) => name.startsWith("SERVER_"))).toBe(true);
	});
});

describe("parseYaml", () => {
	it("parses valid YAML", () => {
		expect(parseYaml("a: 1")).toEqual({ a: 1 });
	});

	it("reports only code and line for invalid YAML, not the source text", () => {
		const issues = issuesOf(() => parseYaml("private_key: [unclosed\n  secret: TOP-SECRET-LINE"));

		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatch(/^Cannot parse the YAML configuration: [A-Z_]+ at line \d+$/);
		expect(issues[0]).not.toContain("TOP-SECRET");
	});
});
