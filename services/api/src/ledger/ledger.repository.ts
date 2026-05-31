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
  const byCurrency = new Map<string, number>();
  for (const leg of legs) {
    const signed = leg.direction === "debit" ? leg.amount : -leg.amount;
    byCurrency.set(leg.currency, (byCurrency.get(leg.currency) ?? 0) + signed);
  }
  for (const [currency, diff] of byCurrency) {
    if (diff !== 0) {
      throw new Error(`[LEDGER] transaction is unbalanced in ${currency} (debits - credits = ${diff})`);
    }
  }

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
  const r = await executor.query<{ currency: string; amount: string }>(
    `SELECT currency, SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END) AS amount
       FROM ledger_entries
      WHERE merchant_id = $1 AND account = 'merchant_balance'
      GROUP BY currency`,
    [merchantId],
  );
  const rows = r.rows.map((row) => ({ currency: row.currency, amount: Number(row.amount) }));
  return rows.length > 0 ? rows : [{ amount: 0, currency: "INR" }];
}
