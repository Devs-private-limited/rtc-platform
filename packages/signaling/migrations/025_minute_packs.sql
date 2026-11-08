-- Minute packs: extra voice or video minutes bought once (Dodo one-time payment), on top of the
-- plan allowance for the current paid month (or year). Admin grants use the same table.
ALTER TABLE app_bonus_minutes ADD COLUMN IF NOT EXISTS kind VARCHAR(8) NOT NULL DEFAULT 'voice';
ALTER TABLE app_bonus_minutes ADD COLUMN IF NOT EXISTS payment_id VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_bonus_minutes_payment ON app_bonus_minutes(payment_id) WHERE payment_id IS NOT NULL;
-- Usage emails are now keyed by period + allowance (a pack raises the allowance, so a new 80%/100% email can follow).
ALTER TABLE usage_alert_log ALTER COLUMN period TYPE VARCHAR(40);
