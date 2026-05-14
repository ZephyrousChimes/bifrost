-- Merchants, their API keys, and the payment intent.
-- No ledger tables yet — creating a payment moves no money and writes no ledger rows.

-- The currency registry. This exists so "widen to a new currency" is an INSERT, not a hunt
-- through every CHECK constraint in the schema that hardcodes 'INR'. minor_unit is the decimal
-- exponent Stripe warns about: 2 for INR/USD (paise, cents), 0 for JPY (no subunit at all) — get
-- it in now, because retrofitting it later means rewriting every amount-formatting call site.
-- `enabled` lets a currency's *metadata* exist (for rendering, for a future FX rate table) before
-- the API is allowed to accept payments in it — those are two different questions.
CREATE TABLE currencies (
    code        CHAR(3) PRIMARY KEY,          -- ISO 4217
    minor_unit  SMALLINT NOT NULL CHECK (minor_unit BETWEEN 0 AND 4),
    enabled     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO currencies (code, minor_unit, enabled) VALUES
    ('INR', 2, true);

-- Present but disabled: proves the zero-decimal case renders correctly (JPY) and that a second
-- two-decimal currency doesn't collide with anything (USD), without opening the API to either.
INSERT INTO currencies (code, minor_unit, enabled) VALUES
    ('USD', 2, false),
    ('JPY', 0, false);

CREATE TABLE merchants (
    id          BIGSERIAL PRIMARY KEY,
    public_id   TEXT NOT NULL UNIQUE,               -- mer_...
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
    id          BIGSERIAL PRIMARY KEY,
    public_id   TEXT NOT NULL UNIQUE,                       -- key_...
    merchant_id BIGINT NOT NULL REFERENCES merchants(id),
    key_hash    TEXT NOT NULL UNIQUE,                        -- SHA-256(secret key), never the key itself
    prefix      TEXT NOT NULL,                                -- e.g. sk_test_a1b2c3d4, safe to display
    livemode    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ NULL
);

CREATE INDEX ON api_keys (merchant_id);

CREATE TABLE payments (
    id               BIGSERIAL PRIMARY KEY,
    public_id        TEXT NOT NULL UNIQUE,           -- pay_...
    merchant_id      BIGINT NOT NULL REFERENCES merchants(id),

    amount           BIGINT NOT NULL CHECK (amount > 0),
    -- FK to currencies, not CHECK (currency = 'INR'): referential integrity says "this is a
    -- currency we know about" at the database level, permanently. Whether it's *acceptable to
    -- charge in* (currencies.enabled) is a business rule, checked in the service layer where a
    -- proper "currency_not_supported" error can be raised — the FK alone can't express that.
    currency         CHAR(3) NOT NULL REFERENCES currencies(code),

    -- Terminal states are succeeded and canceled. There is no payment-level "failed": a
    -- declined charge returns the payment to requires_confirmation so another card can be
    -- tried — only a charge fails, never the payment itself.
    -- Uppercase, matching the Java enum constants verbatim (Hibernate's EnumType.STRING writes
    -- the constant name as-is) — deliberately not lowercase SQL convention, so the mapping needs
    -- no converter at all. See PaymentStatus / CaptureMethod.
    status           TEXT NOT NULL CHECK (status IN (
                         'REQUIRES_CONFIRMATION',
                         'PROCESSING',
                         'REQUIRES_CAPTURE',
                         'SUCCEEDED',
                         'CANCELED'
                     )),
    capture_method   TEXT NOT NULL CHECK (capture_method IN ('AUTOMATIC', 'MANUAL')),

    amount_captured  BIGINT NOT NULL DEFAULT 0 CHECK (amount_captured >= 0),
    amount_refunded  BIGINT NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),

    description      TEXT,
    metadata         JSONB NOT NULL DEFAULT '{}',

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON payments (merchant_id, created_at DESC);
