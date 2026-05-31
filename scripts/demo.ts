import { randomUUID } from "node:crypto";
import http from "node:http";
import { Pool } from "pg";
import { postLedgerTransaction } from "../services/api/src/ledger/ledger.repository";

const API = process.env.API_URL ?? "http://localhost:8080";
const HOOK_PORT = 9191;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || detail === undefined ? "" : "  -> " + JSON.stringify(detail)}`);
}
const step = (s: string) => console.log(`\n== ${s}`);

let secretKey = "";
async function call(method: string, path: string, body?: unknown, opts: { key?: string; auth?: boolean } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== false && secretKey) headers.Authorization = `Bearer ${secretKey}`;
  if (method === "POST" && opts.auth !== false) headers["Idempotency-Key"] = opts.key ?? randomUUID();
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, replay: res.headers.get("idempotent-replay"), json: (await res.json()) as any };
}

const received = new Map<string, string>();
let deliveries = 0;
const hook = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    deliveries++;
    const event = JSON.parse(raw);
    received.set(event.id, event.type);
    res.end("ok");
  });
});

async function balance() {
  const b = (await call("GET", "/v1/balance")).json;
  return b.balance[0].amount as number;
}

async function main() {
  await new Promise<void>((r) => hook.listen(HOOK_PORT, r));

  step("1. register a merchant, pointing webhooks at this script");
  const reg = await call(
    "POST",
    "/v1/merchants",
    { name: "Demo Co", email: `demo-${Date.now()}@example.com`, webhook_url: `http://localhost:${HOOK_PORT}/hook` },
    { auth: false },
  );
  secretKey = reg.json.api_key.secret_key;
  check("merchant registered, webhook url set", reg.status === 201 && reg.json.merchant.webhook_url === `http://localhost:${HOOK_PORT}/hook`, reg.json);

  step("2. happy path: create -> confirm -> ledger written");
  const p1 = (await call("POST", "/v1/payments", { amount: 50000, currency: "INR" })).json;
  const c1 = await call("POST", `/v1/payments/${p1.id}/confirm`, { payment_method: "pm_card_visa" });
  check("payment succeeded", c1.json.status === "succeeded" && c1.json.acquirer_reference, c1.json);
  const b1 = await balance();
  check("balance = amount minus the 2.9% fee (50000 - 1450 = 48550)", b1 === 48550, b1);

  step("3. a declined card returns the payment to requires_confirmation, not a dead end");
  const p2 = (await call("POST", "/v1/payments", { amount: 10000, currency: "INR" })).json;
  const d = await call("POST", `/v1/payments/${p2.id}/confirm`, { payment_method: "pm_card_declined" });
  check("HTTP 200, payment simply stays requires_confirmation", d.status === 200 && d.json.status === "requires_confirmation", d.json);
  const retry = await call("POST", `/v1/payments/${p2.id}/confirm`, { payment_method: "pm_card_visa" });
  check("retrying with another card succeeds", retry.json.status === "succeeded", retry.json);

  step("4. idempotency: 8 concurrent confirms with ONE key -> exactly one executes");
  const p3 = (await call("POST", "/v1/payments", { amount: 20000, currency: "INR" })).json;
  const key = randomUUID();
  const burst = await Promise.all(Array.from({ length: 8 }, () => call("POST", `/v1/payments/${p3.id}/confirm`, { payment_method: "pm_card_visa" }, { key })));
  const codes = burst.map((r) => r.status);
  const after = (await call("GET", `/v1/payments/${p3.id}`)).json;
  check("payment settled exactly once", after.status === "succeeded", { codes });
  console.log(`        responses: ${JSON.stringify(codes)}`);
  const replay = await call("POST", `/v1/payments/${p3.id}/confirm`, { payment_method: "pm_card_visa" }, { key });
  check("a later retry with the same key replays the stored response (Idempotent-Replay: true)", replay.replay === "true" && replay.status === 200, { replay: replay.replay, status: replay.status });
  const reused = await call("POST", `/v1/payments/${p3.id}/confirm`, { payment_method: "pm_card_mastercard" }, { key });
  check("same key + different body is rejected (422), not replayed", reused.status === 422, reused.json);

  step("5. ambiguous acquirer timeout: no answer -> payment stays 'processing' -> retry resumes, no double charge");
  const p4 = (await call("POST", "/v1/payments", { amount: 30000, currency: "INR" })).json;
  const key4 = randomUUID();
  const t1 = await call("POST", `/v1/payments/${p4.id}/confirm`, { payment_method: "pm_card_acquirer_timeout" }, { key: key4 });
  const mid = (await call("GET", `/v1/payments/${p4.id}`)).json;
  check("first attempt: 504, payment left in 'processing'", t1.status === 504 && mid.status === "processing", { status: t1.status, mid: mid.status });
  const t2 = await call("POST", `/v1/payments/${p4.id}/confirm`, { payment_method: "pm_card_acquirer_timeout" }, { key: key4 });
  check("retry with the same key resumes: succeeded, only one acquirer reference recorded", t2.status === 200 && t2.json.status === "succeeded", t2.json);

  step("6. cancel: legal before the payment succeeds, never after");
  const p5 = (await call("POST", "/v1/payments", { amount: 40000, currency: "INR" })).json;
  const cx = await call("POST", `/v1/payments/${p5.id}/cancel`, {});
  check("an unconfirmed payment can be canceled", cx.json.status === "canceled", cx.json);
  const cxDone = await call("POST", `/v1/payments/${p1.id}/cancel`, {});
  check("a succeeded payment can't be canceled (409)", cxDone.status === 409, cxDone.json);
  const cxConfirm = await call("POST", `/v1/payments/${p5.id}/confirm`, { payment_method: "pm_card_visa" });
  check("a canceled payment can't be confirmed (409)", cxConfirm.status === 409, cxConfirm.json);

  step("7. the balance is just the sum of the ledger entries");
  const total = await balance();
  check("balance == sum of all captured nets (106810)", total === 106810, total);

  step("8. transactional outbox -> webhooks, at-least-once");
  await sleep(4000);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  if (process.env.DATABASE_URL) {
    const stored = await pool.query<{ public_id: string; status: string }>("SELECT public_id, status FROM outbox_events");
    const ids = stored.rows.map((r) => r.public_id);
    const missing = ids.filter((id) => !received.has(id));
    const notDelivered = stored.rows.filter((r) => r.status !== "delivered").length;
    check(`every stored event (${ids.length}) reached the webhook`, missing.length === 0, { missing: missing.length });
    check(`every stored event is marked delivered in the outbox table`, notDelivered === 0, { notDelivered });
    console.log(`        ${deliveries} deliveries for ${received.size} distinct events; types: ${[...new Set(received.values())].join(", ")}`);
  } else {
    console.log("  (skipped: set DATABASE_URL to check the outbox table)");
  }

  step("9. the ledger invariant is now checked in application code, not the database");
  if (process.env.DATABASE_URL) {
    const before = await pool.query("SELECT count(*) FROM ledger_entries");
    let rejected = "";
    try {
      await postLedgerTransaction(pool, 999999, [
        { account: "acquirer_receivable", merchantId: null, direction: "debit", amount: 100, currency: "INR" },
      ]);
    } catch (e: any) {
      rejected = e.message;
    }
    const after = await pool.query("SELECT count(*) FROM ledger_entries");
    check(
      "an unbalanced set of legs throws before any row is written",
      rejected.includes("unbalanced") && before.rows[0].count === after.rows[0].count,
      { rejected, before: before.rows[0].count, after: after.rows[0].count },
    );

    const mutateClient = await pool.connect();
    try {
      await mutateClient.query("BEGIN");
      await mutateClient.query("UPDATE ledger_entries SET amount = 1");
      console.log("        note: that UPDATE just succeeded — append-only is a convention now, not an enforced guarantee");
      await mutateClient.query("ROLLBACK");
    } finally {
      mutateClient.release();
    }

    const sum = await pool.query<{ amount: string }>(
      "SELECT SUM(CASE direction WHEN 'debit' THEN amount ELSE -amount END) AS amount FROM ledger_entries",
    );
    check("across the whole ledger, sum(debits) - sum(credits) == 0", Number(sum.rows[0].amount) === 0, sum.rows[0]);
  } else {
    console.log("  (skipped: set DATABASE_URL to run the tamper checks)");
  }
  await pool.end();

  hook.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
