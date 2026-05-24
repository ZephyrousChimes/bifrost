import { RequestHandler, Router } from "express";
import { CreateRefundSchema } from "./refund.schema";
import { createRefundService } from "./refund.service";

export function createRefundRoutes(refundService: ReturnType<typeof createRefundService>, idempotent: RequestHandler): Router {
  const router = Router();

  router.post("/refunds", idempotent, async (req, res) => {
    const input = CreateRefundSchema.parse(req.body);
    res.status(201).json(await refundService.create(req.merchantId!, input));
  });

  return router;
}
