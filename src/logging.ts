import logtape from "@logtape/logtape";
import { DEFAULT_REDACT_FIELDS, JWT_PATTERN, redactByField, redactByPattern } from "@logtape/redaction";
import * as env from "./env";

export const ROOT_LOGGER_KEY = "app";

// JSON lines in production (one record per line for log shippers), human readable otherwise
const consoleFormatter: logtape.ConsoleFormatter =
	env.NODE_ENV === "production"
		? (record) => [logtape.jsonLinesFormatter(record).trimEnd()]
		: logtape.defaultConsoleFormatter;

export const configureLogging = async () => {
	await logtape.configure({
		sinks: {
			console: redactByField(
				logtape.getConsoleSink({
					formatter: redactByPattern(consoleFormatter, [JWT_PATTERN]),
				}),
				[...DEFAULT_REDACT_FIELDS, "private_key"],
			),
		},
		loggers: [
			{
				category: [ROOT_LOGGER_KEY],
				sinks: ["console"],
				lowestLevel: env.LOG_LEVEL,
			},
			{
				// LogTape logs an info line on every configure(); only surface problems of the logging itself
				category: ["logtape", "meta"],
				sinks: ["console"],
				lowestLevel: "warning",
			},
		],
	});

	return logtape.getLogger(ROOT_LOGGER_KEY);
};
