DELETE FROM idempotency_keys WHERE response_status IS NULL;
ALTER TABLE idempotency_keys DROP COLUMN status, DROP COLUMN completed_at;
ALTER TABLE idempotency_keys ALTER COLUMN response_status SET NOT NULL, ALTER COLUMN response_body SET NOT NULL;
