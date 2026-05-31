import { Queryable } from "../db/types";

export interface IdempotencyKeyRow {
  key: string;
  merchant_id: number;
  fingerprint: string;
  response_status: number;
  response_body: unknown;
  created_at: Date;
}

export interface IdempotencyKeyRepository {
  find(merchantId: number, key: string): Promise<IdempotencyKeyRow | null>;
  save(merchantId: number, key: string, fingerprint: string, status: number, body: unknown): Promise<void>;
}

interface PgError extends Error {
  code?: string;
}

export function createIdempotencyKeyRepository(pool: Queryable): IdempotencyKeyRepository {
  return {
    async find(merchantId, key) {
      const r = await pool.query<any>(
        `SELECT * FROM idempotency_keys WHERE merchant_id = $1 AND key = $2`,
        [merchantId, key],
      );
      if (!r.rows[0]) return null;
      return { ...r.rows[0], response_body: JSON.parse(r.rows[0].response_body) };
    },

    async save(merchantId, key, fingerprint, status, body) {
      try {
        await pool.query(
          `INSERT INTO idempotency_keys (merchant_id, key, fingerprint, response_status, response_body)
           VALUES ($1, $2, $3, $4, $5)`,
          [merchantId, key, fingerprint, status, JSON.stringify(body)],
        );
      } catch (err) {
        if ((err as PgError).code !== "23505") throw err;
      }
    },
  };
}
