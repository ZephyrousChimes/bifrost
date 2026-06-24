import { Queryable } from "../db/types";

export interface MerchantRow {
  id: number;
  public_id: string;
  name: string;
  email: string;
  webhook_url: string | null;
  created_at: Date;
}

export interface MerchantRepository {
  insert(publicId: string, name: string, email: string, executor?: Queryable): Promise<MerchantRow>;
  findById(id: number): Promise<MerchantRow | null>;
  setWebhook(id: number, url: string | null): Promise<MerchantRow>;
}

export function createMerchantRepository(pool: Queryable): MerchantRepository {
  return {
    async insert(publicId, name, email, executor = pool) {
      const result = await executor.query<MerchantRow>(
        `INSERT INTO merchants (public_id, name, email) VALUES ($1, $2, $3) RETURNING *`,
        [publicId, name, email],
      );
      return result.rows[0];
    },

    async findById(id) {
      const result = await pool.query<MerchantRow>(`SELECT * FROM merchants WHERE id = $1`, [id]);
      return result.rows[0] ?? null;
    },

    async setWebhook(id, url) {
      const result = await pool.query<MerchantRow>(
        `UPDATE merchants SET webhook_url = $2 WHERE id = $1 RETURNING *`,
        [id, url],
      );
      return result.rows[0];
    },
  };
}
