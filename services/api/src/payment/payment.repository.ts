import { Queryable } from "../db/types";

export interface PaymentRow {
  id: number;
  public_id: string;
  merchant_id: number;
  amount: number;
  currency: string;
  status: string;
  capture_method: string;
  description: string | null;
  metadata: Record<string, string>;
  payment_method: string | null;
  attempt_reference: string | null;
  acquirer_reference: string | null;
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

  applyProcessing(id: number, paymentMethod: string, attemptReference: string, executor: Queryable): Promise<PaymentRow | null>;
  applyOutcome(
    id: number,
    legalFrom: string[],
    input: { status: string; acquirerReference?: string | null },
    executor: Queryable,
  ): Promise<PaymentRow | null>;
  applyCancel(id: number, legalFrom: string[], executor: Queryable): Promise<PaymentRow | null>;
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

    async applyProcessing(id, paymentMethod, attemptReference, executor) {
      const r = await executor.query<PaymentRow>(
        `UPDATE payments
            SET status = 'processing', payment_method = $2, attempt_reference = $3, acquirer_reference = NULL,
                updated_at = now()
          WHERE id = $1 AND status = 'requires_confirmation'
          RETURNING *`,
        [id, paymentMethod, attemptReference],
      );
      return r.rows[0] ?? null;
    },

    async applyOutcome(id, legalFrom, input, executor) {
      const r = await executor.query<PaymentRow>(
        `UPDATE payments
            SET status = $3, acquirer_reference = $4, updated_at = now()
          WHERE id = $1 AND status = ANY($2::text[])
          RETURNING *`,
        [id, legalFrom, input.status, input.acquirerReference ?? null],
      );
      return r.rows[0] ?? null;
    },

    async applyCancel(id, legalFrom, executor) {
      const r = await executor.query<PaymentRow>(
        `UPDATE payments SET status = 'canceled', updated_at = now() WHERE id = $1 AND status = ANY($2::text[]) RETURNING *`,
        [id, legalFrom],
      );
      return r.rows[0] ?? null;
    },
  };
}
