CREATE TABLE charges (
    id                 BIGSERIAL PRIMARY KEY,
    public_id          TEXT NOT NULL UNIQUE,
    payment_id         BIGINT NOT NULL REFERENCES payments(id),
    amount             BIGINT NOT NULL CHECK (amount > 0),
    currency           CHAR(3) NOT NULL REFERENCES currencies(code),
    status             TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    payment_method     TEXT NOT NULL,
    acquirer_reference TEXT,
    failure_code       TEXT,
    failure_message    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON charges (payment_id, created_at);

ALTER TABLE payments ADD COLUMN latest_charge_id BIGINT REFERENCES charges(id);
ALTER TABLE payments ADD COLUMN cancellation_reason TEXT
    CHECK (cancellation_reason IN ('duplicate', 'fraudulent', 'requested_by_customer', 'abandoned', 'expired'));

ALTER TABLE payments ADD COLUMN capture_expires_at TIMESTAMPTZ;

CREATE INDEX payments_hold_expiry_idx ON payments (capture_expires_at) WHERE status = 'requires_capture';
