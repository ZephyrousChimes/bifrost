import { Pool } from "pg";
import { env } from "../config/env";
import { createMerchantRepository } from "../merchant/merchant.repository";
import { createOutboxRepository } from "../outbox/outbox.repository";
import { createChargeRepository } from "../payment/charge.repository";
import { createPaymentRepository } from "../payment/payment.repository";
import { createPaymentService } from "../payment/payment.service";
import { createOutboxRelay } from "./outboxRelay";
import { createStalePaymentSweeper } from "./stalePayments";
import { startJob } from "./runner";

export function startJobs(pool: Pool): () => void {
  const stop = startJob("outbox-relay", env.JOB_POLL_MS, createOutboxRelay(createOutboxRepository(pool), createMerchantRepository(pool)));
  const paymentRepository = createPaymentRepository(pool);
  const paymentService = createPaymentService(pool, paymentRepository, createChargeRepository(pool), createOutboxRepository(pool));
  const stopSweeper = startJob("stale-payments", env.JOB_POLL_MS * 5, createStalePaymentSweeper(paymentRepository, paymentService));
  return () => {
    stop();
    stopSweeper();
  };
}
