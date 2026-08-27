import { RefundRow } from "./refund.repository";

export function toRefundView(refund: RefundRow, paymentPublicId: string) {
  return {
    id: refund.public_id,
    object: "refund",
    payment: paymentPublicId,
    amount: refund.amount,
    currency: refund.currency,
    status: "succeeded",
    created_at: refund.created_at,
  };
}
