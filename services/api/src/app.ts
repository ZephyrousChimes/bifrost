import express from "express";
import { Pool } from "pg";
import { apiKeyAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import { createBalanceRoutes } from "./balance/balance.routes";
import { createEventRoutes } from "./event/event.routes";
import { idempotency } from "./idempotency/idempotency.middleware";
import { createIdempotencyKeyRepository } from "./idempotency/idempotency.repository";
import { createApiKeyRepository } from "./merchant/api-key.repository";
import { createMerchantRepository } from "./merchant/merchant.repository";
import { createMerchantRoutes } from "./merchant/merchant.routes";
import { createMerchantService } from "./merchant/merchant.service";
import { createOutboxRepository } from "./outbox/outbox.repository";
import { createChargeRepository } from "./payment/charge.repository";
import { createPaymentRepository } from "./payment/payment.repository";
import { createPaymentRoutes } from "./payment/payment.routes";
import { createPaymentService } from "./payment/payment.service";
import { createRefundRepository } from "./refund/refund.repository";
import { createRefundRoutes } from "./refund/refund.routes";
import { createRefundService } from "./refund/refund.service";
import type { redisClient } from "./db/redis";

export function createApp(pool: Pool, redis: typeof redisClient) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  const merchantRepository = createMerchantRepository(pool);
  const apiKeyRepository = createApiKeyRepository(pool);
  
  const merchantService = createMerchantService(pool, merchantRepository, apiKeyRepository);

  const outboxRepository = createOutboxRepository(pool);

  const chargeRepository = createChargeRepository(pool);

  const paymentRepository = createPaymentRepository(pool);
  const paymentService = createPaymentService(pool, paymentRepository, chargeRepository, outboxRepository);

  const refundService = createRefundService(pool, paymentRepository, createRefundRepository(), outboxRepository);

  const idempotent = idempotency(redis, createIdempotencyKeyRepository(pool));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use(apiKeyAuth(apiKeyRepository));

  app.use("/v1", createMerchantRoutes(merchantService, idempotent));
  app.use("/v1", createPaymentRoutes(paymentService, idempotent));
  app.use("/v1", createRefundRoutes(refundService, idempotent));
  app.use("/v1", createBalanceRoutes(pool));
  app.use("/v1", createEventRoutes(outboxRepository));

  app.use(errorHandler);

  return app;
}
