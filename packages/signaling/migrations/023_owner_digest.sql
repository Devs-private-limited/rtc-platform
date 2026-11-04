-- One row per weekly summary email, so it is sent once even with several server instances.
CREATE TABLE IF NOT EXISTS owner_digest_log (
  week_key VARCHAR(10) PRIMARY KEY,
  result VARCHAR(20),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
