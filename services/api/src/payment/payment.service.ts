import { Pool } from "pg";
import { withTransaction } from "../db/transaction";
import { Queryable } from "../db/types";
import { generatePublicId } from "../lib/publicId";
import { IllegalTransitionError, InvalidRequestError, ResourceNotFoundError } from "../lib/errors";
import { recordCapture } from "../ledger/ledger.service";
import { OutboxRepository } from "../outbox/outbox.repository";
import { authorize, AcquirerResult } from "./acquirer.client";
import { PaymentRepository, PaymentRow } from "./payment.repository";
import { ConfirmPaymentInput, CreatePaymentInput } from "./payment.schema";
import { toPaymentView } from "./payment.view";

export interface PaymentService {
  create(merchantId: number, input: CreatePaymentInput): Promise<PaymentRow>;
  get(merchantId: number, publicId: string): Promise<PaymentRow>;
  confirm(merchantId: number, publicId: string, input: ConfirmPaymentInput): Promise<PaymentRow>;
  cancel(merchantId: number, publicId: string): Promise<PaymentRow>;
}

export function createPaymentService(pool: Pool, paymentRepository: PaymentRepository, outboxRepository: OutboxRepository): PaymentService {
  async function lockOrThrow(merchantId: number, publicId: string, client: Queryable): Promise<PaymentRow> {
    const payment = await paymentRepository.lockByPublicIdAndMerchantId(publicId, merchantId, client);
    if (!payment) throw new ResourceNotFoundError(`No such payment: ${publicId}`);
    return payment;
  }

  return {
    async create(merchantId, input) {
      if (!(await paymentRepository.isCurrencyEnabled(input.currency))) {
        throw new InvalidRequestError("[PAYMENT] currency not supported", "currency");
      }

      return withTransaction(pool, async (client) => {
        const payment = await paymentRepository.insert(
          {
            publicId: generatePublicId("pay_"),
            merchantId,
            amount: input.amount,
            currency: input.currency,
            captureMethod: "automatic",
            description: input.description,
            metadata: input.metadata ?? {},
          },
          client,
        );
        await outboxRepository.append(merchantId, "payment.created", toPaymentView(payment), client);
        return payment;
      });
    },

    async get(merchantId, publicId) {
      const payment = await paymentRepository.findByPublicIdAndMerchantId(publicId, merchantId);
      if (!payment) throw new ResourceNotFoundError(`No such payment: ${publicId}`);
      return payment;
    },

    async confirm(merchantId, publicId, input) {
      const { payment: attempt, resumed } = await withTransaction(pool, async (client) => {
        const payment = await lockOrThrow(merchantId, publicId, client);

        if (payment.status === "processing") {
          return { payment, resumed: true };
        }
        if (payment.status !== "requires_confirmation") {
          throw new IllegalTransitionError(`[PAYMENT] is ${payment.status}, can't confirm`);
        }

        const processing = await paymentRepository.applyProcessing(payment.id, input.payment_method, generatePublicId("att_"), client);
        if (!processing) throw new IllegalTransitionError(`[PAYMENT] is ${payment.status}, can't confirm`);
        return { payment: processing, resumed: false };
      });

      const result: AcquirerResult = await authorize({
        reference: attempt.attempt_reference!,
        amount: attempt.amount,
        currency: attempt.currency,
        paymentMethod: attempt.payment_method!,
        forceTimeout: attempt.payment_method === "pm_card_acquirer_timeout" && !resumed,
      });

      return withTransaction(pool, async (client) => {
        const payment = await lockOrThrow(merchantId, publicId, client);
        if (payment.status !== "processing") return payment;

        let updated: PaymentRow | null;
        let eventType: "payment.failed" | "payment.succeeded";

        if (result.outcome === "declined") {
          updated = await paymentRepository.applyOutcome(payment.id, "processing", { status: "requires_confirmation" }, client);
          eventType = "payment.failed";
        } else {
          await recordCapture(client, payment, payment.amount);
          updated = await paymentRepository.applyOutcome(
            payment.id,
            "processing",
            { status: "succeeded", acquirerReference: result.acquirerReference },
            client,
          );
          eventType = "payment.succeeded";
        }
        if (!updated) throw new IllegalTransitionError("[PAYMENT] lost the processing state mid-confirm");

        await outboxRepository.append(merchantId, eventType, toPaymentView(updated), client);
        return updated;
      });
    },

    async cancel(merchantId, publicId) {
      return withTransaction(pool, async (client) => {
        const payment = await lockOrThrow(merchantId, publicId, client);
        const legalFrom = "requires_confirmation";
        if (payment.status !== legalFrom) {
          throw new IllegalTransitionError(`[PAYMENT] is ${payment.status}, can't cancel`);
        }

        const updated = await paymentRepository.applyCancel(payment.id, legalFrom, client);
        if (!updated) throw new IllegalTransitionError(`[PAYMENT] is ${payment.status}, can't cancel`);

        await outboxRepository.append(merchantId, "payment.canceled", toPaymentView(updated), client);
        return updated;
      });
    },
  };
}
