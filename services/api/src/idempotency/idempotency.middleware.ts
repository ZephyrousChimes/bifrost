import { RequestHandler } from "express";
import { sha256Hex } from "../lib/hash";
import { errorEnvelope } from "../lib/errorEnvelope";
import { IdempotencyKeyRepository } from "./idempotency.repository";
import type { redisClient } from "../db/redis";

const LOCK_TTL_SECONDS = 30;

export function idempotency(redis: typeof redisClient, repo: IdempotencyKeyRepository): RequestHandler {
  return async (req, res, next) => {
    const key = req.header("idempotency-key");
    if (!key) {
      res.status(400).json(errorEnvelope("invalid_request_error", "idempotency_key_missing", "[IDEMPOTENCY] no key header sent"));
      return;
    }

    const merchantId = req.merchantId!;
    const fingerprint = sha256Hex(JSON.stringify(req.body ?? {}));
    const lockKey = `idempotency:${merchantId}:${key}`;

    async function answerIfStored() {
      const stored = await repo.find(merchantId, key!);
      if (!stored) return false;
      if (stored.fingerprint !== fingerprint) {
        res.status(422).json(errorEnvelope("invalid_request_error", "idempotency_key_reused", "[IDEMPOTENCY] key reused with a different body", "Idempotency-Key"));
      } else {
        res.setHeader("Idempotent-Replay", "true");
        res.status(stored.response_status).json(stored.response_body);
      }
      return true;
    }

    if (await answerIfStored()) return;

    const locked = await redis.set(lockKey, "1", { NX: true, EX: LOCK_TTL_SECONDS });
    if (!locked) {
      res.status(409).json(errorEnvelope("invalid_request_error", "idempotency_key_in_progress", "[IDEMPOTENCY] still running, retry"));
      return;
    }

    if (await answerIfStored()) {
      await redis.del(lockKey);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const saved = res.statusCode >= 500 ? Promise.resolve() : repo.save(merchantId, key, fingerprint, res.statusCode, body);
      saved
        .catch((err) => console.error("[IDEMPOTENCY] failed to save response", err))
        .then(() => redis.del(lockKey))
        .catch((err) => console.error("[IDEMPOTENCY] failed to unlock", err));
      return originalJson(body);
    };

    next();
  };
}
