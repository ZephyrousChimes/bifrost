import { Pool } from "pg";
import { withTransaction } from "../db/transaction";
import { Queryable } from "../db/types";
import { generatePublicId } from "../lib/publicId";
import { IllegalTransitionError, InvalidRequestError, ResourceNotFoundError } from "../lib/errors";
import { recordCapture } from "../ledger/ledger.service";
import { OutboxRepository } from "../outbox/outbox.repository";
import { authorize, AcquirerResult } from "./acquirer.client";
import { ChargeRepository, ChargeRow } from "./charge.repository";
import { PaymentRepository, PaymentRow } from "./payment.repository";
import { CancelPaymentInput, ConfirmPaymentInput, CreatePaymentInput } from "./payment.schema";
import { toPaymentView } from "./payment.view";

export interface PaymentWithCharges {
  payment: PaymentRow;
  charges: ChargeRow[];
}

export interface PaymentService {
  create(merchantId: number, input: CreatePaymentInput): Promise<PaymentWithCharges>;
  get(merchantId: number, publicId: string): Promise<PaymentWithCharges>;
  confirm(merchantId: number, publicId: string, input: ConfirmPaymentInput): Promise<PaymentWithCharges>;
  cancel(merchantId: number, publicId: string, input: CancelPaymentInput): Promise<PaymentWithCharges>;
}

export function createPaymentService(
  pool: Pool,
  paymentRepository: PaymentRepository,
  chargeRepository: ChargeRepository,
  outboxRepository: OutboxRepository,
): PaymentService {
  async function loadWithCharges(payment: PaymentRow, executor: Queryable): Promise<PaymentWithCharges> {
    return { payment, charges: await chargeRepository.listByPaymentId(payment.id, executor) };
  }

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
        await outboxRepository.append(merchantId, "payment.created", toPaymentView(payment, []), client);
        return { payment, charges: [] };
      });
    },

    async get(merchantId, publicId) {
      const payment = await paymentRepository.findByPublicIdAndMerchantId(publicId, merchantId);
      if (!payment) throw new ResourceNotFoundError(`No such payment: ${publicId}`);
      return loadWithCharges(payment, pool);
    },

    async confirm(merchantId, publicId, input) {
      const attempt = await withTransaction(pool, async (client) => {
        const payment = await lockOrThrow(merchantId, publicId, client);

        if (payment.status === "processing") {
          const pending = await chargeRepository.findPendingByPaymentId(payment.id, client);
          if (!pending) throw new IllegalTransitionError("[PAYMENT] processing but no pending charge, can't resume");
          return { payment, charge: pending, resumed: true };
        }
        if (payment.status !== "requires_confirmation") {
          throw new IllegalTransitionError(`[PAYMENT] is ${payment.status}, can't confirm`);
        }

        const charge = await chargeRepository.insertPending(
          {
            publicId: generatePublicId("ch_"),
            paymentId: payment.id,
            amount: payment.amount,
            currency: payment.currency,
            paymentMethod: input.payment_method,
          },
          client,
        );
        const processing = await paymentRepository.applyProcessing(payment.id, charge.id, client);
        if (!processing) throw new IllegalTransitionError(`[PAYMENT] is ${payment.status}, can't confirm`);
        return { payment: processing, charge, resumed: false };
      });

      const result: AcquirerResult = await authorize({
        reference: attempt.charge.public_id,
        amount: attempt.charge.amount,
        currency: attempt.charge.currency,
        paymentMethod: attempt.charge.payment_method,
        forceTimeout: attempt.charge.payment_method === "pm_card_acquirer_timeout" && !attempt.resumed,
      });

      const view = await withTransaction(pool, async (client) => {
        const payment = await lockOrThrow(merchantId, publicId, client);
        if (payment.status !== "processing") return loadWithCharges(payment, client);

        await chargeRepository.settle(
          attempt.charge.id,
          result.outcome === "approved"
            ? { status: "succeeded", acquirerReference: result.acquirerReference }
            : {
                status: "failed",
                acquirerReference: result.acquirerReference,
                failureCode: result.failureCode,
                failureMessage: result.failureMessage,
              },
          client,
        );

        let updated: PaymentRow | null;
        let eventType: "payment.failed" | "payment.succeeded";

        if (result.outcome === "declined") {
          updated = await paymentRepository.applyOutcome(payment.id, ["processing"], { status: "requires_confirmation" }, client);
          eventType = "payment.failed";
        } else {
          await recordCapture(client, payment, payment.amount);
          updated = await paymentRepository.applyOutcome(
            payment.id,
            ["processing"],
            { status: "succeeded", amountCaptured: payment.amount },
            client,
          );
          eventType = "payment.succeeded";
        }
        if (!updated) throw new IllegalTransitionError("[PAYMENT] lost the processing state mid-confirm");

        const loaded = await loadWithCharges(updated, client);
        await outboxRepository.append(merchantId, eventType, toPaymentView(loaded.payment, loaded.charges), client);
        return loaded;
      });

      return view;
    },

    async cancel(merchantId, publicId, input) {
      const view = await withTransaction(pool, async (client) => {
        const payment = await lockOrThrow(merchantId, publicId, client);
        const legalFrom = ["requires_confirmation"];
        if (!legalFrom.includes(payment.status)) {
          throw new IllegalTransitionError(`[PAYMENT] is ${payment.status}, can't cancel`);
        }

        const updated = await paymentRepository.applyCancel(payment.id, legalFrom, input.cancellation_reason ?? null, client);
        if (!updated) throw new IllegalTransitionError(`[PAYMENT] is ${payment.status}, can't cancel`);

        const loaded = await loadWithCharges(updated, client);
        await outboxRepository.append(merchantId, "payment.canceled", toPaymentView(loaded.payment, loaded.charges), client);
        return loaded;
      });
      return view;
    },
  };
}
