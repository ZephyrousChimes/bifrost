-- Defense in depth: the DB itself refuses to over-refund.
ALTER TABLE payments
    ADD CONSTRAINT payments_refund_le_captured CHECK (amount_refunded <= amount_captured);

-- Remove the unused manual-capture / hold-expiry leftovers (authorize+capture is one step).
DROP INDEX IF EXISTS payments_hold_expiry_idx;
ALTER TABLE payments DROP COLUMN capture_expires_at;

ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments
    ADD CONSTRAINT payments_status_check CHECK (status IN (
        'requires_confirmation', 'processing', 'succeeded', 'canceled'
    ));
