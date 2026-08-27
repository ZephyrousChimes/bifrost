import { Router } from "express";
import { z } from "zod";
import { OutboxRepository } from "../outbox/outbox.repository";
import { ResourceNotFoundError } from "../lib/errors";

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.string().optional(),
});

export function createEventRoutes(outboxRepository: OutboxRepository): Router {
  const router = Router();

  router.get("/events", async (req, res) => {
    const query = ListQuery.parse(req.query);
    const rows = await outboxRepository.list(req.merchantId!, query.limit + 1, query.type);
    res.json({
      object: "list",
      data: rows.slice(0, query.limit).map((r) => r.payload),
      has_more: rows.length > query.limit,
    });
  });

  router.get("/events/:id", async (req, res) => {
    const row = await outboxRepository.findByPublicIdAndMerchantId(req.params.id, req.merchantId!);
    if (!row) throw new ResourceNotFoundError(`No such event: ${req.params.id}`);
    res.json(row.payload);
  });

  return router;
}
