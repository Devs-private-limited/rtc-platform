-- Emails whose text is edited in the admin panel (Emails page). One row per email; a missing row means
-- "use the built-in default text". Today: 'welcome', sent once right after a customer verifies their email.
CREATE TABLE IF NOT EXISTS email_templates (
  key VARCHAR(40) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  button_text VARCHAR(60),
  button_link VARCHAR(500),
  reply_to VARCHAR(320),
  updated_by VARCHAR(320),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- When the welcome email went out to this customer (NULL = never). Makes sure the automatic one is sent once.
ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;
