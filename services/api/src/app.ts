import express from "express";
import { Pool } from "pg";
import { apiKeyAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import { createBalanceRoutes } from "./balance/balance.routes";
import { idempotency } from "./idempotency/idempotency.middleware";
import { createIdempotencyKeyRepository } from "./idempotency/idempotency.repository";
import { createApiKeyRepository } from "./merchant/api-key.repository";
import { createMerchantRepository } from "./merchant/merchant.repository";
import { createMerchantRoutes } from "./merchant/merchant.routes";
import { createMerchantService } from "./merchant/merchant.service";
import { createOutboxRepository } from "./outbox/outbox.repository";
import { createPaymentRepository } from "./payment/payment.repository";
import { createPaymentRoutes } from "./payment/payment.routes";
import { createPaymentService } from "./payment/payment.service";
import type { redisClient } from "./db/redis";

export function createApp(pool: Pool, redis: typeof redisClient) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  const merchantRepository = createMerchantRepository(pool);
  const apiKeyRepository = createApiKeyRepository(pool);
  const merchantService = createMerchantService(pool, merchantRepository, apiKeyRepository);

  const outboxRepository = createOutboxRepository(pool);
  const paymentRepository = createPaymentRepository(pool);
  const paymentService = createPaymentService(pool, paymentRepository, outboxRepository);

  const idempotent = idempotency(redis, createIdempotencyKeyRepository(pool));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use(apiKeyAuth(apiKeyRepository));

  app.use("/v1", createMerchantRoutes(merchantService, idempotent));
  app.use("/v1", createPaymentRoutes(paymentService, idempotent));
  app.use("/v1", createBalanceRoutes(pool));

  app.use(errorHandler);

  return app;
}
