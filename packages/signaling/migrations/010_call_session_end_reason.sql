-- Distinguishes a normal hangup from a call closed out because a participant's
-- connection dropped, so abandoned calls are visible rather than indistinguishable
-- from clean ones.
ALTER TABLE call_sessions ADD COLUMN IF NOT EXISTS end_reason VARCHAR(64);

-- Supports closing every open session for a user on disconnect.
CREATE INDEX IF NOT EXISTS idx_call_sessions_open_participants
  ON call_sessions(app_id, caller_user_id, callee_user_id)
  WHERE ended_at IS NULL;
