import type { Logger } from "@logtape/logtape";
import type { Queue } from "bullmq";
import type { ChannelRepository } from "./channel-repository";
import type { RenewChannelJobPayload } from "./drive-monitor";
import type { Account } from "./types";

export const RENEW_OFFSET_MS = 30 * 1000;

export const startChannelRenewalScheduler = (
	logger: Logger,
	accounts: Account[],
	channelRepository: ChannelRepository,
	renewChannelQueue: Queue<RenewChannelJobPayload>,
	pollIntervalMs: number,
): NodeJS.Timeout => {
	const tick = async () => {
		for (const account of accounts) {
			try {
				const channel = channelRepository.get(account.id);
				const due = !channel || channel.expiration - Date.now() <= RENEW_OFFSET_MS;

				if (!due) {
					continue;
				}

				const jobId = `renew-channel-${account.id}-${new Date().toISOString()}`;
				await renewChannelQueue.add(
					"renew-channel",
					{ accountId: account.id },
					{ jobId, deduplication: { id: `renew-channel-${account.id}` } },
				);
				logger.info(`Channel renewal due for ${account.name}, enqueued ${jobId}`);
			} catch (err) {
				logger
					.getChild(account.name)
					.error(`Failed to check/enqueue channel renewal: ${(err as Error).message}`, { error: err });
			}
		}
	};

	return setInterval(tick, pollIntervalMs);
};
