CREATE TABLE currencies (
    code        CHAR(3) PRIMARY KEY,
    minor_unit  SMALLINT NOT NULL CHECK (minor_unit BETWEEN 0 AND 4),
    enabled     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO currencies (code, minor_unit, enabled) VALUES
    ('INR', 2, true);

INSERT INTO currencies (code, minor_unit, enabled) VALUES
    ('USD', 2, false),
    ('JPY', 0, false);

CREATE TABLE merchants (
    id          BIGSERIAL PRIMARY KEY,
    public_id   TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
    id          BIGSERIAL PRIMARY KEY,
    public_id   TEXT NOT NULL UNIQUE,
    merchant_id BIGINT NOT NULL REFERENCES merchants(id),
    key_hash    TEXT NOT NULL UNIQUE,
    prefix      TEXT NOT NULL,
    livemode    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ NULL
);

CREATE INDEX ON api_keys (merchant_id);

CREATE TABLE payments (
    id               BIGSERIAL PRIMARY KEY,
    public_id        TEXT NOT NULL UNIQUE,
    merchant_id      BIGINT NOT NULL REFERENCES merchants(id),

    amount           BIGINT NOT NULL CHECK (amount > 0),
    currency         CHAR(3) NOT NULL REFERENCES currencies(code),

    status           TEXT NOT NULL CHECK (status IN (
                         'requires_confirmation',
                         'processing',
                         'requires_capture',
                         'succeeded',
                         'canceled'
                     )),
    capture_method   TEXT NOT NULL CHECK (capture_method IN ('automatic', 'manual')),

    amount_captured  BIGINT NOT NULL DEFAULT 0 CHECK (amount_captured >= 0),
    amount_refunded  BIGINT NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),

    description      TEXT,
    metadata         JSONB NOT NULL DEFAULT '{}',

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON payments (merchant_id, created_at DESC);
