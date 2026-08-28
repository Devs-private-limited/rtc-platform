CREATE TABLE IF NOT EXISTS call_quality_reports (
  id BIGSERIAL PRIMARY KEY,
  app_id VARCHAR(64) NOT NULL,
  call_id VARCHAR(64),
  room_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  media_mode VARCHAR(8) NOT NULL,
  quality_score SMALLINT NOT NULL,
  quality_label VARCHAR(16) NOT NULL,
  rtt_ms INTEGER,
  jitter_ms INTEGER,
  packet_loss_pct REAL,
  inbound_bitrate_kbps INTEGER,
  outbound_bitrate_kbps INTEGER,
  connection_state VARCHAR(32),
  ice_state VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_app_id ON call_quality_reports(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_call_id ON call_quality_reports(app_id, call_id, created_at DESC);
