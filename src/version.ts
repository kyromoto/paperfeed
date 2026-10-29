import fs from "node:fs";
import path from "node:path";

// package.json sits next to build/ (and next to src/ in development); npm_package_version is only set when started via npm
const readVersion = () => {
	try {
		const raw = fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8");
		return (JSON.parse(raw) as { version?: string }).version ?? "unknown";
	} catch {
		return "unknown";
	}
};

export const APP_VERSION = readVersion();
