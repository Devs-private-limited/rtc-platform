-- One row per usage email (80% / 100% of voice minutes, video minutes or chat messages) per
-- allowance period ("trial" or the period start date), so each email is sent once.
CREATE TABLE IF NOT EXISTS usage_alert_log (
  app_id VARCHAR(64) NOT NULL,
  period VARCHAR(20) NOT NULL,
  metric VARCHAR(40) NOT NULL,
  level SMALLINT NOT NULL,
  result VARCHAR(20),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, period, metric, level)
);
