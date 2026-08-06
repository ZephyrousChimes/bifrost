import { randomUUID } from "node:crypto";
import { Queryable } from "../db/types";

export type Account = "acquirer_receivable" | "merchant_balance" | "platform_fee";

export interface Leg {
  account: Account;
  merchantId: number | null;
  direction: "debit" | "credit";
  amount: number;
  currency: string;
}

export async function postLedgerTransaction(executor: Queryable, paymentId: number, legs: Leg[]) {
  const txId = randomUUID();
  for (const leg of legs) {
    await executor.query(
      `INSERT INTO ledger_entries (tx_id, payment_id, account, merchant_id, direction, amount, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [txId, paymentId, leg.account, leg.merchantId, leg.direction, leg.amount, leg.currency],
    );
  }
}

export interface MoneyAmount {
  amount: number;
  currency: string;
}

export async function merchantBalance(executor: Queryable, merchantId: number): Promise<MoneyAmount[]> {
  const r = await executor.query<MoneyAmount>(
    `SELECT currency, SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END)::bigint AS amount
       FROM ledger_entries
      WHERE merchant_id = $1 AND account = 'merchant_balance'
      GROUP BY currency`,
    [merchantId],
  );
  return r.rows.length > 0 ? r.rows : [{ amount: 0, currency: "INR" }];
}
