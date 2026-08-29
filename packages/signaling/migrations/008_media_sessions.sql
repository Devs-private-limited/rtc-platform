CREATE TABLE IF NOT EXISTS media_sessions (
  id BIGSERIAL PRIMARY KEY,
  app_id VARCHAR(64) NOT NULL,
  room_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'voice',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  duration_ms INTEGER,
  end_reason VARCHAR(64)
);

-- At most one open session per user per room, so joining voice and then video
-- upgrades the existing session rather than billing the participant twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_sessions_active
  ON media_sessions(app_id, room_id, user_id)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_media_sessions_app_joined ON media_sessions(app_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_sessions_app_room ON media_sessions(app_id, room_id);
CREATE INDEX IF NOT EXISTS idx_media_sessions_app_user ON media_sessions(app_id, user_id);
