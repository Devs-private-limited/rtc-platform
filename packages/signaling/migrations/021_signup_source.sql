-- Where a console account came from, for the admin panel. Recorded at signup only; older accounts stay NULL.
ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS signup_ip VARCHAR(64);
ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS signup_user_agent VARCHAR(400);
-- First page/referrer/utm the visitor arrived with on the website (sent by the website, may be empty).
ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS signup_source VARCHAR(400);
