# Bifrost (Node) — Requirements & Handoff

Read this before writing any code. It's the full context from the planning conversation that
produced this repo — a fresh session here has no memory of that conversation, so this file is
the only record. If anything here conflicts with what you observe in the code later, trust the
code and update this file, not the other way around.

## What Bifrost is

A **Stripe-style payment service provider (PSP) sandbox**: merchants sign up, get API keys,
take payments with test cards, see them in a dashboard (not built), issue refunds, receive
webhooks. No real money, no real card data, no PCI surface — a simulated acquirer whose
failures are injectable on demand. It's a portfolio project, not a startup — don't
over-philosophize it, don't add scope it doesn't need.

## Why this repo exists, and its relationship to `bifrost-java`

Bifrost was originally planned as three backend implementations of one OpenAPI spec (Spring
Boot → Node.js → Django), Spring built to full depth first, then ported. That sequencing
**flipped**: there's now a specific target job — **slice**, a Bengaluru fintech, SDE1 Backend
role, JD is Express/Loopback/Hapi-flavored (see "Target JD" below). Because this repo is what
goes in front of that job, **this is now the active build, and the one making first-time
design decisions** for anything not yet built in Spring (idempotency's real implementation,
`confirm`, the acquirer simulator — none of these have real code in either stack yet, only
design). `bifrost-java` is paused, not abandoned, and should eventually catch up by porting
whatever gets decided here.

`bifrost-java` (`~/bifrost-java`) already has, fully built and tested: merchant registration,
API-key auth (hash-checked bearer token, tenant-scoped), payment create + get. That's a stable,
already-decided design — port it here as straightforward translation, not redesign. Its
migrations are copied into `reference/` for exactly this purpose (see below); its route/schema
decisions should be treated as settled unless something about Node/Express genuinely requires
otherwise.

## Target JD — slice, SDE1 Backend, Bengaluru, on-site

Fintech ("a new bank for new India": savings account, UPI credit card, UPI, slice business).
Stated requirements: design/develop microservices in a large-scale multi-tenant environment;
balance functionality/performance/maintainability; deploy and maintain in a secure AWS
environment; hands-on API dev with Express/Loopback/Hapi; good understanding of SQL *and*
NoSQL; TDD (unit test **and** API test — both, literally); basic cloud concepts; containerized
deployment; app logging/monitoring (Prometheus or Kibana); end-to-end ownership from ideation
to deployment.

Everything below is designed to answer these honestly — not padded, not keyword-stuffed for
its own sake, but every JD line does need a true, concrete answer somewhere in this system.

## Stack decisions (already made, don't relitigate without reason)

- **TypeScript**, not plain JS. Matches production practice at most fintechs; catches the same
  class of bug the Java compiler caught in the Spring build.
- **Express** (the JD names it first among Express/Loopback/Hapi).
- **Monorepo, two services**: `services/api` (core PSP, multi-tenant) and
  `services/acquirer-sim` (the acquirer simulator — see below), tied together with
  `docker-compose`. Rejected two-separate-repos: that overhead is about team/org boundaries
  this project doesn't have. The monorepo still ships two independently deployable containers,
  which is what "microservices" actually requires at the JD's level.
- **PostgreSQL** — the ledger's system of record. **Redis** — a fast-path layer, not a second
  system of record (see Idempotency below). **MongoDB** — not yet wired to anything specific;
  it exists in the resume's skills list from a course, don't force it into the architecture
  just to use it. If a genuine document-shaped use case shows up (e.g. storing raw
  webhook/acquirer payloads for audit), that's a legitimate fit; don't manufacture one.
- **Docker** for both services, **AWS** for deployment (ECS/Fargate or EC2+Compose to start —
  user already has an AWS account; they were separately learning AWS in another chat this
  session has no visibility into — ask them to recap current AWS state before deployment work,
  don't assume continuity).
- **Prometheus** (not Kibana — JD says "Prometheus or Kibana," Prometheus was chosen) +
  Grafana, `prom-client` in each service.

## Architecture — the domain model (carried over from bifrost-java's design work, unchanged)

- **Two layers, never one.** Business objects (payments, charges, refunds, payouts) are
  mutable rows with a status. The ledger (accounts, transactions, entries) is append-only and
  immutable.
- **Stripe's object split, copied deliberately**: `payments` = intent (the goal), `charges` =
  one attempt to move money. One intent can have many charges (declined card, retry). There is
  no payment-level "failed" status — only a charge fails; a declined charge returns the payment
  to `requires_confirmation` so another card can be tried.
- **Double-entry ledger**, invariant `sum(debits) == sum(credits)` per transaction per
  currency, enforced by a **deferred database constraint** (in practice: a Postgres
  `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` that validates at commit — plain
  `CHECK` constraints can't express a multi-row aggregate, so don't reach for one here) —
  enforced in the database, not application code. This is the single highest-value correctness
  claim in the whole system; a chaos test suite should exist specifically to try to violate it.
- **Pending vs. available balance are two separate ledger accounts**, not two integer columns
  — so the maturity sweep (pending → available) is itself an auditable balanced transaction,
  not an untraceable field update.
- **Refunds/corrections are appended reversals, never mutations.** `reverses_transaction_id`.
- Money is **integers in minor units**, currency alongside. Never floats. See the `currencies`
  table pattern in `reference/V2__merchants_and_payments.sql` (`minor_unit` per currency — 2
  for INR/USD, 0 for JPY — decided once, referenced everywhere, not hardcoded per amount).

Full worked ledger examples (a ₹500 payment through capture → settlement → availability →
payout, chart of accounts, balance computation at scale) exist in a previously published
design doc from the Spring-side work. If deep ledger-mechanics questions come up that this file
doesn't answer, that doc is the primary source — ask the user for the link if needed, don't
re-derive the whole model from scratch.

## Idempotency keys

**The non-idempotent operation this protects is `confirm`** (`POST
/v1/payments/{id}/confirm`) — the endpoint that will actually call the acquirer and move state.
`create` doesn't need this protection: a duplicate `create` just makes a second harmless draft
payment. Later, `capture`, `cancel`, and `refund` need the same protection `confirm` does.

**Why the client generates the key, not the server:** the key has to survive the request being
ambiguous (timed out, connection dropped). If the server generated it and handed it back in the
response, the key would be exposed to exactly the same delivery failure it's meant to protect
against — a lost response means the client never learns the key either. A client-generated
UUID (v4, ~122 bits of randomness) needs no server round-trip to be safe: the collision space
is large enough that independent parties can each pick their own value with no coordination.

**Storage design** (Leach's schema, `brandur.org/idempotency-keys`): a durable record per
`(merchant_id, key)` — unique constraint on that pair is what makes the *concurrent* case safe,
not just the sequential-retry case. Fields: the key, merchant_id, a fingerprint hash of the
request body (catches key-reuse-with-a-different-payload, which is a client bug), status
(`in_progress` / `completed`), the stored response (status + body) to replay, timestamps.

**Where Redis fits — and where it doesn't:** Redis is a **fast-path claim/lock layer in front
of Postgres**, not a replacement for it. `SETNX key ttl` resolves "who claims this key first"
quickly among concurrent requests without contending on a Postgres row lock. **Postgres remains
the durable source of truth** — the actual key record and stored response are written in the
same transaction as the business side effect. Do NOT make Redis the system of record for
idempotency completion status — that reintroduces the dual-write problem (two systems, no
shared transaction) that the transactional outbox exists specifically to solve for webhooks;
doing it here too would be architecturally inconsistent with the project's own stated
principle. If unsure whether a given piece of idempotency state belongs in Redis or Postgres,
default to Postgres and treat Redis purely as an optimization.

**The algorithm, regardless of where it's wired in (filter/middleware vs. per-route):**
1. Require `Idempotency-Key` header on protected endpoints; missing → 400.
2. Try to atomically claim `(merchant_id, key)` — Redis `SETNX` fast path, Postgres unique
   constraint as the real guarantee.
3. Existing row, `completed` → don't touch business logic at all, replay the stored response.
4. Existing row, `in_progress` → another request with this key is mid-flight → 409, don't block.
5. Fingerprint mismatch on an existing key → 409/422 (client bug: same key, different body).
6. On success: write response + flip to `completed`, in the same transaction as the side
   effect. On failure: decide whether to delete the row (retry gets a fresh attempt) or keep it
   `failed` — this is a real design decision, not yet made; make it deliberately, not by
   accident.

**Test that actually needs to exist, not just be claimed:** two (near-)simultaneous requests
with the same key and body — exactly one should execute the side effect, the other should
either replay or get 409 depending on timing. This is the concrete proof behind the resume's
"concurrency tests" claim (see "What the resume already commits to," below) — it needs to be
real, not aspirational, before that resume goes out.

## The acquirer simulator — a real second microservice, not an in-process fake

`services/acquirer-sim`, called over HTTP from `services/api`, with **injectable latency and
failure modes** (configurable: succeed, decline, timeout, slow-respond). This is *more*
realistic than an in-process fake, not a contrivance — real acquirer integrations are exactly
this: a separate system over a network that can genuinely hang or drop a response. It's also
what makes "ambiguous acquirer timeout" something you can actually trigger in a test, rather
than something only described in a design doc — which is precisely what the idempotency
recovery-point logic (in `confirm`) needs to be tested against.

This decomposition is the honest answer to the JD's "design and develop microservices... large-
scale, multi-tenant environment" line — two services with genuinely different failure domains,
not two services because a JD asked for the word "microservices." Do not extend this pattern
into splitting the ledger/payments core itself — that should stay one strongly-consistent
service; a premature microservices split there would be bad engineering, not good practice.

## Metrics / observability design

Three tiers — see `bifrost-java` project memory (`slice-jd-alignment.md`) for the full writeup
if this section needs expanding; summarized here:

1. **Infra-level** (`prom-client`, mostly auto-instrumented): HTTP RED metrics (rate/errors/
   duration) per route; **Node event-loop lag** specifically — the canonical Node health
   signal, since Node is single-threaded and a blocked loop degrades everything concurrently,
   not just one request; process CPU/memory/GC pauses; Postgres pool + Redis connection
   metrics.
2. **Domain-level** (the differentiated part, worth building deliberately, not skipping):
   - Payment state-machine transition counter.
   - **A live gauge on `sum(debits) - sum(credits)`, which should always read zero** — the same
     invariant the deferred DB constraint enforces, made continuously visible. Highest-value
     single metric in the system.
   - Idempotency-key hit counter labeled `{new, replayed, conflicting}` — proves the dedup and
     race-handling paths are actually exercised in production traffic, not just in tests.
   - Acquirer-interaction outcome counter labeled by injected failure mode, plus a **recovery-
     point resumption counter** specifically.
   - Outbox lag (commit-to-relay time).
3. **Type discipline**: Counter (monotonic totals) vs. Gauge (current value — the ledger
   imbalance check MUST be a gauge, not a counter, or a self-corrected imbalance would look
   identical to one that never happened) vs. Histogram (for percentiles — request/acquirer-call
   latency).

**Cardinality rule, non-negotiable:** never label a metric by an unbounded value (`payment_id`,
`merchant_id`, `idempotency_key`) — labels must be bounded sets (`status`, `currency`,
`failure_mode`, `transition`). Getting this wrong quietly kills Prometheus at scale; decide it
correctly from the first metric, not after a cardinality blowup.

Each service exposes its own `/metrics`; one Prometheus scrapes both; Grafana on top.

## What the resume already commits to — build to make these literally true

A resume for this project has already been drafted and sent to the user, targeting this exact
JD. It makes specific, checkable claims. Treat these as acceptance criteria, not just prose:
- Ledger invariant enforced by a deferred DB constraint, **validated by a chaos test suite**.
- Idempotency keys, Redis fast-path lock over Postgres's durable record, **verified by
  concurrency tests**: exactly one of N duplicate retries executes; an injected acquirer
  timeout resumes without double-charging.
- Transactional outbox for webhooks, dual-write problem named explicitly.
- Authorize-capture state machine with a hold-expiry sweeper; pending/available as distinct
  ledger accounts.
- Spec-first OpenAPI 3.1 contract, **unit and API-level tests**, conformance suite, simulated
  acquirer with injectable failure modes.
- Acquirer simulator as an independently deployable microservice; both services containerized
  and deployed to AWS; Prometheus metrics including the ledger-invariant gauge and idempotency
  replay/conflict counters, named specifically.

If something here turns out not to be worth building as designed, the right move is to update
the resume to match reality — not to leave the resume overclaiming.

## Build sequencing

1. Scaffold `services/api` and `services/acquirer-sim`, port merchant registration + auth +
   payment create/get from `bifrost-java` (pure translation — see reference migrations).
2. Idempotency keys: schema, Postgres-durable + Redis-fast-path, the concurrent-duplicate test.
3. `confirm`, calling the real `services/acquirer-sim` over HTTP, exercising recovery-point
   resumption against injected timeouts.
4. `capture` + the ledger (hardest, highest-value milestone — the double-entry invariant, the
   deferred constraint, the chaos test).
5. Containerize both services, deploy to AWS, wire Prometheus/Grafana.
6. Cancel, refunds, balance endpoint, outbox/webhooks — in roughly that order.
7. Port whatever got newly decided here (idempotency, confirm, capture, acquirer-sim) back into
   `bifrost-java`.

## Conventions carried over from bifrost-java

- All commits authored as **ZephyrousChimes** (already configured locally in this repo — do
  not touch the machine's global git identity, which is different).
- **User scaffolds their own code.** Design, review, explain, and fix when asked — don't write
  application code unprompted. This applies here exactly as it did in the Spring build.
- Tenant isolation via `findByXAndMerchantId`-shaped lookups + 404 (never 403) — deliberate
  enumeration defense, same as `bifrost-java`.
- "Extract shared code only on the second real caller" — don't pre-abstract.
- Verification discipline: booting the app / passing typecheck proves nothing about routing or
  business-logic correctness — real bugs in the Spring build were only caught by live requests
  or real integration tests, never by compile-only checks. Don't trust "it builds" as "it
  works."

## Reference material in this repo

- `openapi/bifrost.v1.yaml` — the shared contract, copied verbatim from `bifrost-java`. This is
  the single source of truth across all Bifrost backends; if the API needs to diverge from it,
  that's a spec change, made deliberately, not an accidental drift.
- `reference/V1__init.sql`, `reference/V2__merchants_and_payments.sql` — bifrost-java's actual
  migrations, for schema reference during translation. Not meant to be run here verbatim (no
  `idempotency_keys` table yet, no ledger tables yet — those don't exist in bifrost-java either,
  this repo is where they get designed first).
