import { Pool } from "pg";
import { env } from "../config/env";
import { createMerchantRepository } from "../merchant/merchant.repository";
import { createOutboxRepository } from "../outbox/outbox.repository";
import { createOutboxRelay } from "./outboxRelay";
import { startJob } from "./runner";

export function startJobs(pool: Pool): () => void {
  const stop = startJob("outbox-relay", env.JOB_POLL_MS, createOutboxRelay(createOutboxRepository(pool), createMerchantRepository(pool)));
  return stop;
}
