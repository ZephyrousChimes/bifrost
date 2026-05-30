import { RequestHandler, Router } from "express";
import { PaymentService } from "./payment.service";
import { ConfirmPaymentSchema, CreatePaymentSchema } from "./payment.schema";
import { toPaymentView } from "./payment.view";

export function createPaymentRoutes(paymentService: PaymentService, idempotent: RequestHandler): Router {
  const router = Router();

  router.post("/payments", idempotent, async (req, res) => {
    const input = CreatePaymentSchema.parse(req.body);
    res.status(201).json(toPaymentView(await paymentService.create(req.merchantId!, input)));
  });

  router.get("/payments/:id", async (req, res) => {
    res.json(toPaymentView(await paymentService.get(req.merchantId!, req.params.id)));
  });

  router.post("/payments/:id/confirm", idempotent, async (req, res) => {
    const input = ConfirmPaymentSchema.parse(req.body);
    res.json(toPaymentView(await paymentService.confirm(req.merchantId!, req.params.id as string, input)));
  });

  router.post("/payments/:id/cancel", idempotent, async (req, res) => {
    res.json(toPaymentView(await paymentService.cancel(req.merchantId!, req.params.id as string)));
  });

  return router;
}
