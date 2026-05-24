import { Queryable } from "../db/types";

export interface RefundRow {
  id: number;
  public_id: string;
  payment_id: number;
  merchant_id: number;
  amount: number;
  currency: string;
  created_at: Date;
}

export interface RefundRepository {
  insert(
    input: { publicId: string; paymentId: number; merchantId: number; amount: number; currency: string },
    executor: Queryable,
  ): Promise<RefundRow>;
}

export function createRefundRepository(): RefundRepository {
  return {
    async insert(input, executor) {
      const r = await executor.query<RefundRow>(
        `INSERT INTO refunds (public_id, payment_id, merchant_id, amount, currency)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [input.publicId, input.paymentId, input.merchantId, input.amount, input.currency],
      );
      return r.rows[0];
    },
  };
}
