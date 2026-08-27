import { MerchantRepository } from "../merchant/merchant.repository";
import { OutboxRepository } from "../outbox/outbox.repository";

const MAX_ATTEMPTS = 8;

export function createOutboxRelay(outbox: OutboxRepository, merchants: MerchantRepository) {
  return async function relayOnce() {
    const due = await outbox.claimDue(20, 30);

    for (const row of due) {
      const merchant = await merchants.findById(row.merchant_id);
      if (!merchant?.webhook_url) {
        await outbox.markDelivered(row.id, "no webhook endpoint set");
        continue;
      }

      const body = JSON.stringify(row.payload);

      try {
        const res = await fetch(merchant.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) throw new Error(`endpoint answered ${res.status}`);
        await outbox.markDelivered(row.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (row.attempts >= MAX_ATTEMPTS) {
          await outbox.markFailed(row.id, message);
        } else {
          await outbox.markRetry(row.id, message, Math.min(2 ** row.attempts, 60));
        }
      }
    }
  };
}
