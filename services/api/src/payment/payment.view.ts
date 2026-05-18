import { ChargeRow } from "./charge.repository";
import { PaymentRow } from "./payment.repository";

export function toChargeView(charge: ChargeRow, paymentPublicId: string) {
  return {
    id: charge.public_id,
    object: "charge",
    payment: paymentPublicId,
    amount: charge.amount,
    currency: charge.currency,
    status: charge.status,
    acquirer_reference: charge.acquirer_reference,
    failure_code: charge.failure_code,
    failure_message: charge.failure_message,
    created_at: charge.created_at,
  };
}

export function toPaymentView(payment: PaymentRow, charges: ChargeRow[]) {
  const latest = charges.find((c) => c.id === payment.latest_charge_id);
  return {
    id: payment.public_id,
    object: "payment",
    amount: payment.amount,
    amount_captured: payment.amount_captured,
    amount_refunded: payment.amount_refunded,
    currency: payment.currency,
    status: payment.status,
    capture_method: payment.capture_method,
    latest_charge: latest?.public_id ?? null,
    charges: charges.map((c) => toChargeView(c, payment.public_id)),
    description: payment.description,
    metadata: payment.metadata,
    cancellation_reason: payment.cancellation_reason,
    created_at: payment.created_at,
    updated_at: payment.updated_at,
  };
}
