CREATE TABLE IF NOT EXISTS call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id VARCHAR(64) NOT NULL,
  call_id VARCHAR(255) NOT NULL,
  room_id VARCHAR(255),
  initiator_id VARCHAR(255) NOT NULL,
  callee_id VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'ringing',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INT,
  end_reason VARCHAR(64),
  CONSTRAINT uq_call_sessions_app_call UNIQUE (app_id, call_id)
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_app_started ON call_sessions(app_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_app_status ON call_sessions(app_id, status);
CREATE INDEX IF NOT EXISTS idx_call_sessions_initiator ON call_sessions(app_id, initiator_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_callee ON call_sessions(app_id, callee_id);
