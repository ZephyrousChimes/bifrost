import { env } from "../config/env";
import { AcquirerTimeoutError } from "../lib/errors";

const STRIPE_TEST_METHODS: Record<string, string> = {
  pm_card_visa: "pm_card_visa",
  pm_card_mastercard: "pm_card_mastercard",
  pm_card_declined: "pm_card_chargeDeclined",
  pm_card_insufficient_funds: "pm_card_chargeDeclinedInsufficientFunds",
  pm_card_expired: "pm_card_chargeDeclinedExpiredCard",
  pm_card_incorrect_cvc: "pm_card_chargeDeclinedIncorrectCvc",
  pm_card_processing_error: "pm_card_chargeDeclinedProcessingError",
  pm_card_acquirer_timeout: "pm_card_visa",
};

export type AcquirerResult =
  | { outcome: "approved"; acquirerReference: string }
  | { outcome: "declined"; acquirerReference?: string; failureCode: string; failureMessage: string };

const KNOWN_FAILURE_CODES = ["card_declined", "expired_card", "incorrect_cvc", "processing_error"];

export async function authorize(input: {
  reference: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  forceTimeout?: boolean;
}): Promise<AcquirerResult> {
  const body = new URLSearchParams({
    amount: String(input.amount),
    currency: input.currency.toLowerCase(),
    payment_method: STRIPE_TEST_METHODS[input.paymentMethod] ?? "pm_card_visa",
    confirm: "true",
    "payment_method_types[]": "card",
    "metadata[reference]": input.reference,
  });

  let res: Response;
  try {
    res = await fetch(`${env.STRIPE_API_BASE}/v1/payment_intents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": input.reference,
      },
      body,
      signal: AbortSignal.timeout(input.forceTimeout ? 1 : env.ACQUIRER_TIMEOUT_MS),
    });
  } catch {
    throw new AcquirerTimeoutError("[ACQUIRER] no answer from stripe, outcome unknown");
  }

  const json: any = await res.json().catch(() => ({}));

  if (res.ok) {
    if (json.status === "succeeded") return { outcome: "approved", acquirerReference: json.id };
    return {
      outcome: "declined",
      acquirerReference: json.id,
      failureCode: "processing_error",
      failureMessage: `[ACQUIRER] payment ended as '${json.status}'`,
    };
  }

  if (res.status === 402 && json.error) {
    const e = json.error;
    const failureCode =
      e.decline_code === "insufficient_funds"
        ? "insufficient_funds"
        : KNOWN_FAILURE_CODES.includes(e.code)
          ? e.code
          : "card_declined";
    return {
      outcome: "declined",
      acquirerReference: e.payment_intent?.id,
      failureCode,
      failureMessage: e.message ?? "declined",
    };
  }

  throw new AcquirerTimeoutError(`[ACQUIRER] stripe answered ${res.status}, outcome unknown`);
}
