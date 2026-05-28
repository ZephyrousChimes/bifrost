import { randomUUID } from "node:crypto";
import http from "node:http";
import { Pool } from "pg";

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

  step("1. register a merchant and point webhooks at this script");
  const reg = await call("POST", "/v1/merchants", { name: "Demo Co", email: `demo-${Date.now()}@example.com` }, { auth: false });
  secretKey = reg.json.api_key.secret_key;
  const patched = await call("PATCH", "/v1/merchant", { webhook_url: `http://localhost:${HOOK_PORT}/hook` });
  check("merchant registered, webhook url set", reg.status === 201 && patched.json.webhook_url === `http://localhost:${HOOK_PORT}/hook`, patched.json);

  step("2. happy path: create -> confirm (automatic capture) -> ledger written");
  const p1 = (await call("POST", "/v1/payments", { amount: 50000, currency: "INR" })).json;
  const c1 = await call("POST", `/v1/payments/${p1.id}/confirm`, { payment_method: "pm_card_visa" });
  check("payment succeeded, one succeeded charge", c1.json.status === "succeeded" && c1.json.charges.length === 1 && c1.json.charges[0].status === "succeeded", c1.json);
  const b1 = await balance();
  check("balance = amount minus the 2.9% fee (50000 - 1450 = 48550)", b1 === 48550, b1);

  step("3. a declined card: only the charge fails; the payment goes back to requires_confirmation");
  const p2 = (await call("POST", "/v1/payments", { amount: 10000, currency: "INR" })).json;
  const d = await call("POST", `/v1/payments/${p2.id}/confirm`, { payment_method: "pm_card_declined" });
  check("HTTP 200, payment requires_confirmation, charge failed with a code", d.status === 200 && d.json.status === "requires_confirmation" && d.json.charges[0].status === "failed" && !!d.json.charges[0].failure_code, d.json);
  const retry = await call("POST", `/v1/payments/${p2.id}/confirm`, { payment_method: "pm_card_visa" });
  check("retrying with another card works; both attempts are kept (2 charges)", retry.json.status === "succeeded" && retry.json.charges.length === 2, retry.json);

  step("4. idempotency: 8 concurrent confirms with ONE key -> exactly one executes");
  const p3 = (await call("POST", "/v1/payments", { amount: 20000, currency: "INR" })).json;
  const key = randomUUID();
  const burst = await Promise.all(Array.from({ length: 8 }, () => call("POST", `/v1/payments/${p3.id}/confirm`, { payment_method: "pm_card_visa" }, { key })));
  const codes = burst.map((r) => r.status);
  const after = (await call("GET", `/v1/payments/${p3.id}`)).json;
  check("payment has exactly one charge", after.charges.length === 1 && after.status === "succeeded", { codes, charges: after.charges.length });
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
  check("first attempt: 504, payment left in 'processing' with a pending charge", t1.status === 504 && mid.status === "processing" && mid.charges[0].status === "pending", { status: t1.status, mid: mid.status });
  const t2 = await call("POST", `/v1/payments/${p4.id}/confirm`, { payment_method: "pm_card_acquirer_timeout" }, { key: key4 });
  check("retry with the same key resumes: succeeded, still exactly one charge", t2.status === 200 && t2.json.status === "succeeded" && t2.json.charges.length === 1, t2.json);

  step("6. cancel: legal before the payment succeeds, never after");
  const p5 = (await call("POST", "/v1/payments", { amount: 40000, currency: "INR" })).json;
  const cx = await call("POST", `/v1/payments/${p5.id}/cancel`, { cancellation_reason: "abandoned" });
  check("an unconfirmed payment can be canceled", cx.json.status === "canceled" && cx.json.cancellation_reason === "abandoned", cx.json);
  const cxDone = await call("POST", `/v1/payments/${p1.id}/cancel`, {});
  check("a succeeded payment can't be canceled (409)", cxDone.status === 409, cxDone.json);
  const cxConfirm = await call("POST", `/v1/payments/${p5.id}/confirm`, { payment_method: "pm_card_visa" });
  check("a canceled payment can't be confirmed (409)", cxConfirm.status === 409, cxConfirm.json);

  step("7. the balance is just the sum of the ledger entries");
  const total = await balance();
  check("balance == sum of all captured nets (106810)", total === 106810, total);

  step("8. refund: a reversing ledger entry, in one transaction");
  const rf = await call("POST", "/v1/refunds", { payment: p1.id, amount: 20000 });
  const afterRefund = await balance();
  check("refund created and the balance dropped by exactly 20000", rf.status === 201 && total - afterRefund === 20000, { status: rf.status, total, afterRefund });
  const again = await call("GET", `/v1/payments/${p1.id}`);
  check("payment.amount_refunded is 20000", again.json.amount_refunded === 20000, again.json);
  const tooMuch = await call("POST", "/v1/refunds", { payment: p1.id, amount: 999999 });
  check("refunding more than what's left is rejected (400)", tooMuch.status === 400, tooMuch.json);
  const uncaptured = await call("POST", "/v1/refunds", { payment: p5.id });
  check("refunding a payment that was never captured (the canceled one) is rejected (409)", uncaptured.status === 409, uncaptured.json);

  step("9. transactional outbox -> webhooks, at-least-once");
  await sleep(4000);
  const events = (await call("GET", "/v1/events?limit=100")).json;
  const ids = new Set<string>(events.data.map((e: any) => e.id));
  const missing = [...ids].filter((id) => !received.has(id));
  check(`every stored event (${ids.size}) reached the webhook`, missing.length === 0, { missing: missing.length });
  console.log(`        ${deliveries} deliveries for ${received.size} distinct events; types: ${[...new Set(received.values())].join(", ")}`);

  step("10. the ledger invariant lives in the database: try to break it");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  if (process.env.DATABASE_URL) {
    const client = await pool.connect();
    let rejected = "";
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO ledger_entries (tx_id, account, direction, amount, currency) VALUES (gen_random_uuid(), 'acquirer_receivable', 'debit', 100, 'INR')",
      );
      await client.query("COMMIT");
    } catch (e: any) {
      rejected = e.message;
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    check("an unbalanced transaction is rejected at COMMIT", rejected.includes("unbalanced"), rejected);
    let mutated = "";
    try {
      await pool.query("UPDATE ledger_entries SET amount = 1");
    } catch (e: any) {
      mutated = e.message;
    }
    check("UPDATE on the ledger is rejected (append-only)", mutated.includes("append-only"), mutated);
    const sum = await pool.query(
      "SELECT COALESCE(SUM(CASE direction WHEN 'debit' THEN amount ELSE -amount END), 0)::bigint AS diff FROM ledger_entries",
    );
    check("across the whole ledger, sum(debits) - sum(credits) == 0", Number(sum.rows[0].diff) === 0, sum.rows[0]);
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
