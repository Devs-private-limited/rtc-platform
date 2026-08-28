CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id VARCHAR(64) NOT NULL,
  call_id VARCHAR(64),
  room_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  duration_ms INTEGER NOT NULL,
  size_bytes BIGINT NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recordings_app_id ON recordings(app_id, created_at DESC);
