CREATE TABLE refunds (
    id          BIGSERIAL PRIMARY KEY,
    public_id   TEXT NOT NULL UNIQUE,
    payment_id  BIGINT NOT NULL REFERENCES payments(id),
    merchant_id BIGINT NOT NULL REFERENCES merchants(id),
    amount      BIGINT NOT NULL CHECK (amount > 0),
    currency    CHAR(3) NOT NULL REFERENCES currencies(code),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON refunds (payment_id);
