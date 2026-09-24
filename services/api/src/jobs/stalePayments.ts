import { env } from "../config/env";
import { PaymentRepository } from "../payment/payment.repository";
import { PaymentService } from "../payment/payment.service";

export function createStalePaymentSweeper(paymentRepository: PaymentRepository, paymentService: PaymentService) {
  return async function sweepStalePayments() {
    const stale = await paymentRepository.findStaleProcessing(env.STALE_PROCESSING_MS, 20);
    for (const p of stale) {
      try {
        await paymentService.resume(p.merchant_id, p.public_id);
        console.log(`[JOB:stale-payments] resolved ${p.public_id}`);
      } catch (err) {
        console.error(`[JOB:stale-payments] ${p.public_id} failed`, err);
      }
    }
  };
}
