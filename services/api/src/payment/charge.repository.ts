import { Queryable } from "../db/types";

export interface ChargeRow {
  id: number;
  public_id: string;
  payment_id: number;
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed";
  payment_method: string;
  acquirer_reference: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: Date;
}

export interface ChargeRepository {
  insertPending(
    input: { publicId: string; paymentId: number; amount: number; currency: string; paymentMethod: string },
    executor: Queryable,
  ): Promise<ChargeRow>;
  findPendingByPaymentId(paymentId: number, executor: Queryable): Promise<ChargeRow | null>;
  settle(
    id: number,
    outcome: { status: "succeeded" | "failed"; acquirerReference?: string; failureCode?: string; failureMessage?: string },
    executor: Queryable,
  ): Promise<void>;
  listByPaymentId(paymentId: number, executor?: Queryable): Promise<ChargeRow[]>;
}

export function createChargeRepository(pool: Queryable): ChargeRepository {
  return {
    async insertPending(input, executor) {
      const r = await executor.query<ChargeRow>(
        `INSERT INTO charges (public_id, payment_id, amount, currency, status, payment_method)
         VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING *`,
        [input.publicId, input.paymentId, input.amount, input.currency, input.paymentMethod],
      );
      return r.rows[0];
    },

    async findPendingByPaymentId(paymentId, executor) {
      const r = await executor.query<ChargeRow>(
        `SELECT * FROM charges WHERE payment_id = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1`,
        [paymentId],
      );
      return r.rows[0] ?? null;
    },

    async settle(id, outcome, executor) {
      await executor.query(
        `UPDATE charges
            SET status = $2, acquirer_reference = $3, failure_code = $4, failure_message = $5
          WHERE id = $1 AND status = 'pending'`,
        [id, outcome.status, outcome.acquirerReference ?? null, outcome.failureCode ?? null, outcome.failureMessage ?? null],
      );
    },

    async listByPaymentId(paymentId, executor = pool) {
      const r = await executor.query<ChargeRow>(`SELECT * FROM charges WHERE payment_id = $1 ORDER BY id ASC`, [paymentId]);
      return r.rows;
    },
  };
}
