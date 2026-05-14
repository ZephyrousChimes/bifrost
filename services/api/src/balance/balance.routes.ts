import { Router } from "express";
import { Pool } from "pg";
import { merchantBalance } from "../ledger/ledger.repository";

export function createBalanceRoutes(pool: Pool): Router {
  const router = Router();

  router.get("/balance", async (req, res) => {
    res.json({ object: "balance", balance: await merchantBalance(pool, req.merchantId!) });
  });

  return router;
}
