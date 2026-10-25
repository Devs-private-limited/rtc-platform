-- Self-serve subscriptions through Dodo Payments. `apps.plan` stays the single
-- source of truth for plan gating; these columns record which Dodo
-- subscription put it there.
ALTER TABLE apps ADD COLUMN IF NOT EXISTS billing_period VARCHAR(16);
ALTER TABLE apps ADD COLUMN IF NOT EXISTS dodo_customer_id VARCHAR(64);
ALTER TABLE apps ADD COLUMN IF NOT EXISTS dodo_subscription_id VARCHAR(64);
ALTER TABLE apps ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(32);
ALTER TABLE apps ADD COLUMN IF NOT EXISTS subscription_renews_at TIMESTAMPTZ;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
-- Webhook timestamp of the last subscription event applied, so a late retry of
-- an older event cannot undo a newer one.
ALTER TABLE apps ADD COLUMN IF NOT EXISTS billing_event_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS apps_dodo_customer_idx ON apps (dodo_customer_id);
CREATE INDEX IF NOT EXISTS apps_dodo_subscription_idx ON apps (dodo_subscription_id);

-- Dodo retries deliveries; each webhook-id is processed once.
CREATE TABLE IF NOT EXISTS dodo_webhook_events (
  webhook_id VARCHAR(128) PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
