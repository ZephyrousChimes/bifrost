import { z } from "zod";

export const CreatePaymentSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  metadata: z.record(z.string(), z.string()).optional(),
  description: z.string().max(1000).optional(),
});
export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;

export const PAYMENT_METHOD_TOKENS = [
  "pm_card_visa",
  "pm_card_mastercard",
  "pm_card_declined",
  "pm_card_insufficient_funds",
  "pm_card_expired",
  "pm_card_incorrect_cvc",
  "pm_card_processing_error",
  "pm_card_acquirer_timeout",
] as const;

export const ConfirmPaymentSchema = z.object({ payment_method: z.enum(PAYMENT_METHOD_TOKENS) }).strict();
export type ConfirmPaymentInput = z.infer<typeof ConfirmPaymentSchema>;

export const CancelPaymentSchema = z.object({
  cancellation_reason: z.enum(["duplicate", "fraudulent", "requested_by_customer", "abandoned"]).optional(),
});
export type CancelPaymentInput = z.infer<typeof CancelPaymentSchema>;
