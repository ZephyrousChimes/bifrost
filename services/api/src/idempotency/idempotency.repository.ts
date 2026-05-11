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

export function createIdempotencyKeyRepository(pool: Queryable): IdempotencyKeyRepository {
  return {
    async find(merchantId, key) {
      const r = await pool.query<IdempotencyKeyRow>(
        `SELECT * FROM idempotency_keys WHERE merchant_id = $1 AND key = $2`,
        [merchantId, key],
      );
      return r.rows[0] ?? null;
    },

    async save(merchantId, key, fingerprint, status, body) {
      await pool.query(
        `INSERT INTO idempotency_keys (merchant_id, key, fingerprint, response_status, response_body)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (merchant_id, key) DO NOTHING`,
        [merchantId, key, fingerprint, status, JSON.stringify(body)],
      );
    },
  };
}
