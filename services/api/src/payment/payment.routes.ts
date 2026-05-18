import { RequestHandler, Router } from "express";
import { PaymentService } from "./payment.service";
import { CancelPaymentSchema, ConfirmPaymentSchema, CreatePaymentSchema } from "./payment.schema";
import { toPaymentView } from "./payment.view";

export function createPaymentRoutes(paymentService: PaymentService, idempotent: RequestHandler): Router {
  const router = Router();

  router.post("/payments", idempotent, async (req, res) => {
    const input = CreatePaymentSchema.parse(req.body);
    const { payment, charges } = await paymentService.create(req.merchantId!, input);
    res.status(201).json(toPaymentView(payment, charges));
  });

  router.get("/payments/:id", async (req, res) => {
    const { payment, charges } = await paymentService.get(req.merchantId!, req.params.id);
    res.json(toPaymentView(payment, charges));
  });

  router.post("/payments/:id/confirm", idempotent, async (req, res) => {
    const input = ConfirmPaymentSchema.parse(req.body);
    const { payment, charges } = await paymentService.confirm(req.merchantId!, req.params.id as string, input);
    res.json(toPaymentView(payment, charges));
  });

  router.post("/payments/:id/cancel", idempotent, async (req, res) => {
    const input = CancelPaymentSchema.parse(req.body ?? {});
    const { payment, charges } = await paymentService.cancel(req.merchantId!, req.params.id as string, input);
    res.json(toPaymentView(payment, charges));
  });

  return router;
}
