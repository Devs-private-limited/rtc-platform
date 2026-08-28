CREATE TABLE IF NOT EXISTS call_sessions (
  id BIGSERIAL PRIMARY KEY,
  app_id VARCHAR(64) NOT NULL,
  call_id VARCHAR(64) NOT NULL,
  room_id VARCHAR(255) NOT NULL,
  caller_user_id VARCHAR(255) NOT NULL,
  callee_user_id VARCHAR(255),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,
  UNIQUE (app_id, call_id)
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_app_id ON call_sessions(app_id, started_at DESC);
