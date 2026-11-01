-- Every Dodo payment for a project, saved from payment.* / refund.* webhooks, so the
-- console can show payment history and invoices from our own database.
CREATE TABLE IF NOT EXISTS billing_payments (
  payment_id VARCHAR(64) PRIMARY KEY,
  app_id VARCHAR(64) NOT NULL REFERENCES apps(app_id) ON DELETE CASCADE,
  subscription_id VARCHAR(64),
  status VARCHAR(32) NOT NULL,
  amount_minor BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  refunded_minor BIGINT NOT NULL DEFAULT 0,
  description VARCHAR(200),
  paid_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS billing_payments_app_idx ON billing_payments (app_id, paid_at DESC);

-- Refund ids already counted, so a retried refund webhook is not added twice.
CREATE TABLE IF NOT EXISTS billing_refunds (
  refund_id VARCHAR(64) PRIMARY KEY,
  payment_id VARCHAR(64) NOT NULL,
  amount_minor BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
