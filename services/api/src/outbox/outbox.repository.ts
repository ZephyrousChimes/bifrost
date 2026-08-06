import { Queryable } from "../db/types";
import { generatePublicId } from "../lib/publicId";

export type EventType =
  | "payment.created"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.canceled"
  | "refund.succeeded";

export interface OutboxRow {
  id: number;
  public_id: string;
  merchant_id: number;
  type: string;
  payload: unknown;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  next_attempt_at: Date;
  last_error: string | null;
  created_at: Date;
  delivered_at: Date | null;
}

export interface OutboxRepository {
  append(merchantId: number, type: EventType, dataObject: unknown, executor: Queryable): Promise<OutboxRow>;
  list(merchantId: number, limit: number, type?: string): Promise<OutboxRow[]>;
  findByPublicIdAndMerchantId(publicId: string, merchantId: number): Promise<OutboxRow | null>;

  claimDue(limit: number, leaseSeconds: number): Promise<OutboxRow[]>;
  markDelivered(id: number, note?: string): Promise<void>;
  markRetry(id: number, error: string, delaySeconds: number): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
}

export function createOutboxRepository(pool: Queryable): OutboxRepository {
  return {
    async append(merchantId, type, dataObject, executor) {
      const publicId = generatePublicId("evt_");
      const event = {
        id: publicId,
        object: "event",
        type,
        created_at: new Date().toISOString(),
        data: { object: dataObject },
      };
      const r = await executor.query<OutboxRow>(
        `INSERT INTO outbox_events (public_id, merchant_id, type, payload) VALUES ($1, $2, $3, $4) RETURNING *`,
        [publicId, merchantId, type, JSON.stringify(event)],
      );
      return r.rows[0];
    },

    async list(merchantId, limit, type) {
      const r = await pool.query<OutboxRow>(
        type
          ? `SELECT * FROM outbox_events WHERE merchant_id = $1 AND type = $2 ORDER BY id DESC LIMIT $3`
          : `SELECT * FROM outbox_events WHERE merchant_id = $1 ORDER BY id DESC LIMIT $2`,
        type ? [merchantId, type, limit] : [merchantId, limit],
      );
      return r.rows;
    },

    async findByPublicIdAndMerchantId(publicId, merchantId) {
      const r = await pool.query<OutboxRow>(`SELECT * FROM outbox_events WHERE public_id = $1 AND merchant_id = $2`, [
        publicId,
        merchantId,
      ]);
      return r.rows[0] ?? null;
    },

    async claimDue(limit, leaseSeconds) {
      const r = await pool.query<OutboxRow>(
        `WITH due AS (
           SELECT id FROM outbox_events
            WHERE status = 'pending' AND next_attempt_at <= now()
            ORDER BY id
            LIMIT $1
            FOR UPDATE SKIP LOCKED
         )
         UPDATE outbox_events o
            SET attempts = o.attempts + 1,
                next_attempt_at = now() + make_interval(secs => $2)
           FROM due
          WHERE o.id = due.id
         RETURNING o.*`,
        [limit, leaseSeconds],
      );
      return r.rows;
    },

    async markDelivered(id, note) {
      await pool.query(
        `UPDATE outbox_events SET status = 'delivered', delivered_at = now(), last_error = $2 WHERE id = $1`,
        [id, note ?? null],
      );
    },

    async markRetry(id, error, delaySeconds) {
      await pool.query(
        `UPDATE outbox_events SET last_error = $2, next_attempt_at = now() + make_interval(secs => $3) WHERE id = $1`,
        [id, error, delaySeconds],
      );
    },

    async markFailed(id, error) {
      await pool.query(`UPDATE outbox_events SET status = 'failed', last_error = $2 WHERE id = $1`, [id, error]);
    },
  };
}
