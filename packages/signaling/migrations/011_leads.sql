-- Early-access signups from the marketing site. Kept in the platform database
-- rather than a third-party form service so the signup can later be turned
-- into a real app registration without exporting data between systems.
CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  company VARCHAR(255),
  source VARCHAR(64) NOT NULL DEFAULT 'website',
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per email per source: re-submitting the form updates the existing
-- row instead of filling the table with duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_email_source ON leads(LOWER(email), source);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
