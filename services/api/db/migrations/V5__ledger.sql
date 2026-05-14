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

CREATE FUNCTION check_ledger_balanced() RETURNS trigger AS $$
DECLARE
    bad RECORD;
BEGIN
    SELECT currency, SUM(CASE direction WHEN 'debit' THEN amount ELSE -amount END) AS diff
      INTO bad
      FROM ledger_entries
     WHERE tx_id = NEW.tx_id
     GROUP BY currency
    HAVING SUM(CASE direction WHEN 'debit' THEN amount ELSE -amount END) <> 0
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION '[LEDGER] transaction % is unbalanced in % (debits - credits = %)', NEW.tx_id, bad.currency, bad.diff;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_balanced
    AFTER INSERT ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_ledger_balanced();

CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '[LEDGER] % is not allowed, the ledger is append-only', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_append_only
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TRIGGER ledger_no_truncate
    BEFORE TRUNCATE ON ledger_entries
    FOR EACH STATEMENT EXECUTE FUNCTION forbid_ledger_mutation();
