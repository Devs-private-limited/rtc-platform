-- Plans include separate voice and video allowances, so each 1:1 call records
-- whether it was a voice or a video call. Existing rows predate video metering
-- and are treated as voice.
ALTER TABLE call_sessions ADD COLUMN IF NOT EXISTS call_type VARCHAR(8) NOT NULL DEFAULT 'voice';
