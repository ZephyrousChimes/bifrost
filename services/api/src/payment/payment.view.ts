import { PaymentRow } from "./payment.repository";

export function toPaymentView(payment: PaymentRow) {
  return {
    id: payment.public_id,
    object: "payment",
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    payment_method: payment.payment_method,
    acquirer_reference: payment.acquirer_reference,
    description: payment.description,
    metadata: payment.metadata,
    created_at: payment.created_at,
    updated_at: payment.updated_at,
  };
}
