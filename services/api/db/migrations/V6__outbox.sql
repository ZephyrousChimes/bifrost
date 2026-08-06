CREATE TABLE outbox_events (
    id              BIGSERIAL PRIMARY KEY,
    public_id       TEXT NOT NULL UNIQUE,
    merchant_id     BIGINT NOT NULL REFERENCES merchants(id),
    type            TEXT NOT NULL,
    payload         JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
    attempts        INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at    TIMESTAMPTZ
);

CREATE INDEX outbox_due_idx ON outbox_events (next_attempt_at) WHERE status = 'pending';
CREATE INDEX ON outbox_events (merchant_id, id DESC);

ALTER TABLE merchants ADD COLUMN webhook_url TEXT;
