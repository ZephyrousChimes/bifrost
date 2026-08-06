import { env } from "../config/env";
import { Queryable } from "../db/types";
import { Leg, postLedgerTransaction } from "./ledger.repository";

export function feeSplit(amount: number): { merchantAmount: number; feeAmount: number } {
  const feeAmount = Math.floor((amount * env.PLATFORM_FEE_BPS) / 10000);
  return { merchantAmount: amount - feeAmount, feeAmount };
}

interface CapturedPayment {
  id: number;
  merchant_id: number;
  currency: string;
}

export async function recordCapture(client: Queryable, payment: CapturedPayment, amount: number) {
  const { merchantAmount, feeAmount } = feeSplit(amount);
  const currency = payment.currency;

  const legs: Leg[] = [{ account: "acquirer_receivable", merchantId: null, direction: "debit", amount, currency }];
  if (merchantAmount > 0) {
    legs.push({ account: "merchant_balance", merchantId: payment.merchant_id, direction: "credit", amount: merchantAmount, currency });
  }
  if (feeAmount > 0) {
    legs.push({ account: "platform_fee", merchantId: null, direction: "credit", amount: feeAmount, currency });
  }

  await postLedgerTransaction(client, payment.id, legs);
}
