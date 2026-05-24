import { Pool } from "pg";
import { withTransaction } from "../db/transaction";
import { generatePublicId } from "../lib/publicId";
import { IllegalTransitionError, InvalidRequestError, ResourceNotFoundError } from "../lib/errors";
import { postLedgerTransaction } from "../ledger/ledger.repository";
import { OutboxRepository } from "../outbox/outbox.repository";
import { PaymentRepository } from "../payment/payment.repository";
import { RefundRepository } from "./refund.repository";
import { CreateRefundInput } from "./refund.schema";
import { toRefundView } from "./refund.view";

export function createRefundService(
  pool: Pool,
  paymentRepository: PaymentRepository,
  refundRepository: RefundRepository,
  outboxRepository: OutboxRepository,
) {
  return {
    async create(merchantId: number, input: CreateRefundInput) {
      return withTransaction(pool, async (client) => {
        const payment = await paymentRepository.lockByPublicIdAndMerchantId(input.payment, merchantId, client);
        if (!payment) throw new ResourceNotFoundError(`No such payment: ${input.payment}`);
        if (payment.amount_captured === 0) throw new IllegalTransitionError("[REFUND] nothing captured on this payment");

        const left = payment.amount_captured - payment.amount_refunded;
        const amount = input.amount ?? left;
        if (amount <= 0 || amount > left) throw new InvalidRequestError("[REFUND] more than what's left to refund", "amount");

        await postLedgerTransaction(client, payment.id, [
          { account: "merchant_balance", merchantId, direction: "debit", amount, currency: payment.currency },
          { account: "acquirer_receivable", merchantId: null, direction: "credit", amount, currency: payment.currency },
        ]);

        const refund = await refundRepository.insert(
          { publicId: generatePublicId("re_"), paymentId: payment.id, merchantId, amount, currency: payment.currency },
          client,
        );
        await paymentRepository.applyRefund(payment.id, amount, client);
        const view = toRefundView(refund, payment.public_id);
        await outboxRepository.append(merchantId, "refund.succeeded", view, client);
        return view;
      });
    },
  };
}
