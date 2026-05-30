ALTER TABLE payments ADD COLUMN payment_method TEXT;
ALTER TABLE payments ADD COLUMN acquirer_reference TEXT;
ALTER TABLE payments ADD COLUMN attempt_reference TEXT;
