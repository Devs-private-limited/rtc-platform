-- One row per usage email (80% / 100% of monthly voice or video minutes), so each is sent once.
CREATE TABLE IF NOT EXISTS usage_alert_log (
  app_id VARCHAR(64) NOT NULL,
  month VARCHAR(7) NOT NULL,
  metric VARCHAR(40) NOT NULL,
  level SMALLINT NOT NULL,
  result VARCHAR(20),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, month, metric, level)
);
