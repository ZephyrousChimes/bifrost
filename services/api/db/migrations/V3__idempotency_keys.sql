CREATE TABLE idempotency_keys (
    id           BIGSERIAL PRIMARY KEY,
    key          TEXT NOT NULL,
    merchant_id  BIGINT NOT NULL REFERENCES merchants(id),

    fingerprint  TEXT NOT NULL,

    status       TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),

    response_status  SMALLINT,
    response_body    JSONB,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX idempotency_keys_merchant_id_key_key ON idempotency_keys (merchant_id, key);
