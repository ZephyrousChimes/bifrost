import { Pool } from "pg";
import { Queryable } from "../db/types";
import { generatePublicId } from "../lib/publicId";

export type EventType =
  | "payment.created"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.canceled";

export interface OutboxRow {
  id: number;
  public_id: string;
  merchant_id: number;
  type: string;
  payload: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  next_attempt_at: Date;
  last_error: string | null;
  created_at: Date;
  delivered_at: Date | null;
}

export interface OutboxRepository {
  append(merchantId: number, type: EventType, dataObject: unknown, executor: Queryable): Promise<void>;
  claimDue(limit: number, leaseSeconds: number): Promise<OutboxRow[]>;
  markDelivered(id: number, note?: string): Promise<void>;
  markRetry(id: number, error: string, delaySeconds: number): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
}

export function createOutboxRepository(pool: Pool): OutboxRepository {
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
      await executor.query(
        `INSERT INTO outbox_events (public_id, merchant_id, type, payload) VALUES ($1, $2, $3, $4)`,
        [publicId, merchantId, type, JSON.stringify(event)],
      );
    },

    async claimDue(limit, leaseSeconds) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const due = await client.query<{ id: number }>(
          `SELECT id FROM outbox_events
            WHERE status = 'pending' AND next_attempt_at <= now()
            ORDER BY id
            LIMIT $1
            FOR UPDATE SKIP LOCKED`,
          [limit],
        );

        if (due.rows.length === 0) {
          await client.query("COMMIT");
          return [];
        }

        const ids = due.rows.map((r) => r.id);
        const nextAttemptAt = new Date(Date.now() + leaseSeconds * 1000);
        const idPlaceholders = ids.map((_, i) => `$${i + 2}`).join(", ");

        const claimed = await client.query<OutboxRow>(
          `UPDATE outbox_events SET attempts = attempts + 1, next_attempt_at = $1
            WHERE id IN (${idPlaceholders})
          RETURNING *`,
          [nextAttemptAt, ...ids],
        );

        await client.query("COMMIT");
        return claimed.rows;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async markDelivered(id, note) {
      await pool.query(
        `UPDATE outbox_events SET status = 'delivered', delivered_at = now(), last_error = $2 WHERE id = $1`,
        [id, note ?? null],
      );
    },

    async markRetry(id, error, delaySeconds) {
      const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000);
      await pool.query(`UPDATE outbox_events SET last_error = $2, next_attempt_at = $3 WHERE id = $1`, [
        id,
        error,
        nextAttemptAt,
      ]);
    },

    async markFailed(id, error) {
      await pool.query(`UPDATE outbox_events SET status = 'failed', last_error = $2 WHERE id = $1`, [id, error]);
    },
  };
}
