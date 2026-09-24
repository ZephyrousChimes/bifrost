import { Queryable } from "../db/types";

export interface PaymentRow {
  id: number;
  public_id: string;
  merchant_id: number;
  amount: number;
  currency: string;
  status: string;
  capture_method: string;
  amount_captured: number;
  amount_refunded: number;
  description: string | null;
  metadata: Record<string, string>;
  latest_charge_id: number | null;
  cancellation_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertPaymentInput {
  publicId: string;
  merchantId: number;
  amount: number;
  currency: string;
  captureMethod: string;
  description?: string;
  metadata: Record<string, string>;
}

export interface PaymentRepository {
  insert(input: InsertPaymentInput, executor?: Queryable): Promise<PaymentRow>;
  findByPublicIdAndMerchantId(publicId: string, merchantId: number, executor?: Queryable): Promise<PaymentRow | null>;
  lockByPublicIdAndMerchantId(publicId: string, merchantId: number, executor: Queryable): Promise<PaymentRow | null>;
  isCurrencyEnabled(code: string): Promise<boolean>;

  applyProcessing(id: number, chargeId: number, executor: Queryable): Promise<PaymentRow | null>;
  applyOutcome(
    id: number,
    legalFrom: string[],
    input: { status: string; amountCaptured?: number },
    executor: Queryable,
  ): Promise<PaymentRow | null>;
  applyCancel(id: number, legalFrom: string[], reason: string | null, executor: Queryable): Promise<PaymentRow | null>;
  applyRefund(id: number, amountRefunded: number, executor: Queryable): Promise<PaymentRow | null>;
  findStaleProcessing(olderThanMs: number, limit: number): Promise<{ public_id: string; merchant_id: number }[]>;
}

export function createPaymentRepository(pool: Queryable): PaymentRepository {
  return {
    async insert(input, executor = pool) {
      const result = await executor.query<PaymentRow>(
        `INSERT INTO payments (public_id, merchant_id, amount, currency, status, capture_method, description, metadata)
         VALUES ($1, $2, $3, $4, 'requires_confirmation', $5, $6, $7)
         RETURNING *`,
        [
          input.publicId,
          input.merchantId,
          input.amount,
          input.currency,
          input.captureMethod,
          input.description ?? null,
          JSON.stringify(input.metadata),
        ],
      );
      return result.rows[0];
    },

    async findByPublicIdAndMerchantId(publicId, merchantId, executor = pool) {
      const result = await executor.query<PaymentRow>(
        `SELECT * FROM payments WHERE public_id = $1 AND merchant_id = $2`,
        [publicId, merchantId],
      );
      return result.rows[0] ?? null;
    },

    async lockByPublicIdAndMerchantId(publicId, merchantId, executor) {
      const result = await executor.query<PaymentRow>(
        `SELECT * FROM payments WHERE public_id = $1 AND merchant_id = $2 FOR UPDATE`,
        [publicId, merchantId],
      );
      return result.rows[0] ?? null;
    },

    async isCurrencyEnabled(code) {
      const r = await pool.query<{ enabled: boolean }>(`SELECT enabled FROM currencies WHERE code = $1`, [code]);
      return r.rows[0]?.enabled === true;
    },

    async applyProcessing(id, chargeId, executor) {
      const r = await executor.query<PaymentRow>(
        `UPDATE payments SET status = 'processing', latest_charge_id = $2, updated_at = now()
          WHERE id = $1 AND status = 'requires_confirmation' RETURNING *`,
        [id, chargeId],
      );
      return r.rows[0] ?? null;
    },

    async applyOutcome(id, legalFrom, input, executor) {
      const r = await executor.query<PaymentRow>(
        `UPDATE payments
            SET status = $3,
                amount_captured = COALESCE($4, amount_captured),
                updated_at = now()
          WHERE id = $1 AND status = ANY($2::text[])
          RETURNING *`,
        [id, legalFrom, input.status, input.amountCaptured ?? null],
      );
      return r.rows[0] ?? null;
    },

    async applyCancel(id, legalFrom, reason, executor) {
      const r = await executor.query<PaymentRow>(
        `UPDATE payments
            SET status = 'canceled', cancellation_reason = $3, updated_at = now()
          WHERE id = $1 AND status = ANY($2::text[])
          RETURNING *`,
        [id, legalFrom, reason],
      );
      return r.rows[0] ?? null;
    },

    async findStaleProcessing(olderThanMs, limit) {
      const r = await pool.query<{ public_id: string; merchant_id: number }>(
        `SELECT public_id, merchant_id FROM payments
          WHERE status = 'processing' AND updated_at < now() - ($1::int * interval '1 millisecond')
          ORDER BY updated_at LIMIT $2`,
        [olderThanMs, limit],
      );
      return r.rows;
    },

    async applyRefund(id, amountRefunded, executor) {
      const r = await executor.query<PaymentRow>(
        `UPDATE payments SET amount_refunded = amount_refunded + $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, amountRefunded],
      );
      return r.rows[0] ?? null;
    },

  };
}
