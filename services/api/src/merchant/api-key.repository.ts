import { Queryable } from "../db/types";

export interface ApiKeyRow {
  id: number;
  public_id: string;
  merchant_id: number;
  key_hash: string;
  prefix: string;
  livemode: boolean;
  created_at: Date;
  revoked_at: Date | null;
}

export interface ApiKeyRepository {
  insert(
    publicId: string,
    merchantId: number,
    keyHash: string,
    prefix: string,
    livemode: boolean,
    executor?: Queryable,
  ): Promise<ApiKeyRow>;
  findActiveByKeyHash(keyHash: string): Promise<ApiKeyRow | null>;
  findByPublicIdAndMerchantId(publicId: string, merchantId: number): Promise<ApiKeyRow | null>;
  revoke(id: number): Promise<ApiKeyRow>;
}

export function createApiKeyRepository(pool: Queryable): ApiKeyRepository {
  return {
    async insert(publicId, merchantId, keyHash, prefix, livemode, executor = pool) {
      const result = await executor.query<ApiKeyRow>(
        `INSERT INTO api_keys (public_id, merchant_id, key_hash, prefix, livemode)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [publicId, merchantId, keyHash, prefix, livemode],
      );
      return result.rows[0];
    },

    async findActiveByKeyHash(keyHash) {
      const result = await pool.query<ApiKeyRow>(
        `SELECT * FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
        [keyHash],
      );
      return result.rows[0] ?? null;
    },

    async findByPublicIdAndMerchantId(publicId, merchantId) {
      const result = await pool.query<ApiKeyRow>(
        `SELECT * FROM api_keys WHERE public_id = $1 AND merchant_id = $2`,
        [publicId, merchantId],
      );
      return result.rows[0] ?? null;
    },

    async revoke(id) {
      const result = await pool.query<ApiKeyRow>(
        `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 RETURNING *`,
        [id],
      );
      return result.rows[0];
    },
  };
}
