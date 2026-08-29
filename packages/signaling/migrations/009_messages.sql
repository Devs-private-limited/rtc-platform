CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  app_id VARCHAR(64) NOT NULL,
  room_id VARCHAR(255) NOT NULL,
  from_user_id VARCHAR(255) NOT NULL,
  text TEXT NOT NULL,
  client_msg_id VARCHAR(64),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keyset pagination reads this directly: newest-first within a room.
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(app_id, room_id, id DESC);

-- Makes a resent message idempotent, so a client retrying after a dropped
-- connection doesn't store the same message twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_client_id
  ON messages(app_id, room_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;
