import fs from "node:fs/promises";
import type { Logger } from "@logtape/logtape";
import { composeConfig, parseYaml } from "./config-env";
import type { ConfigRepository } from "./repositories";

export class ConfigFileRepository implements ConfigRepository {
	constructor(
		private readonly logger: Logger,
		private readonly path: string,
	) {}

	public async read() {
		this.logger.debug(`Reading config from ${this.path}`);

		const raw = await fs.readFile(this.path, "utf-8");
		return composeConfig(parseYaml(raw), process.env);
	}
}
