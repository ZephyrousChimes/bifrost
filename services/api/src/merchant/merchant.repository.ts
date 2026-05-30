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
  insert(publicId: string, name: string, email: string, webhookUrl: string | null, executor?: Queryable): Promise<MerchantRow>;
  findById(id: number): Promise<MerchantRow | null>;
}

export function createMerchantRepository(pool: Queryable): MerchantRepository {
  return {
    async insert(publicId, name, email, webhookUrl, executor = pool) {
      const result = await executor.query<MerchantRow>(
        `INSERT INTO merchants (public_id, name, email, webhook_url) VALUES ($1, $2, $3, $4) RETURNING *`,
        [publicId, name, email, webhookUrl],
      );
      return result.rows[0];
    },

    async findById(id) {
      const result = await pool.query<MerchantRow>(`SELECT * FROM merchants WHERE id = $1`, [id]);
      return result.rows[0] ?? null;
    },
  };
}
