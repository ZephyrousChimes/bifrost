CREATE TABLE ledger_entries (
    id          BIGSERIAL PRIMARY KEY,
    tx_id       UUID NOT NULL,
    payment_id  BIGINT REFERENCES payments(id),
    account     TEXT NOT NULL CHECK (account IN (
                    'acquirer_receivable',
                    'merchant_balance',
                    'platform_fee'
                )),
    merchant_id BIGINT REFERENCES merchants(id),
    direction   TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
    amount      BIGINT NOT NULL CHECK (amount > 0),
    currency    CHAR(3) NOT NULL REFERENCES currencies(code),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON ledger_entries (tx_id);
CREATE INDEX ON ledger_entries (merchant_id, account);
