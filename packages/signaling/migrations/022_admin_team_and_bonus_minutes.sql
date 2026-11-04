-- Admins added from the admin panel by the owner. The owner(s) stay in ADMIN_EMAILS (env), so they can never be locked out.
CREATE TABLE IF NOT EXISTS admin_users (
  email VARCHAR(320) PRIMARY KEY,
  role VARCHAR(16) NOT NULL CHECK (role IN ('admin', 'viewer')),
  added_by VARCHAR(320),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Extra call minutes given to one project for one calendar month (UTC), on top of its plan allowance.
CREATE TABLE IF NOT EXISTS app_bonus_minutes (
  id BIGSERIAL PRIMARY KEY,
  app_id VARCHAR(64) NOT NULL,
  month CHAR(7) NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1000000),
  note VARCHAR(300),
  granted_by VARCHAR(320),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_app_bonus_minutes_app_month ON app_bonus_minutes(app_id, month);

-- Every change made from the admin panel: who, what, to which customer/admin, when.
CREATE TABLE IF NOT EXISTS admin_audit (
  id BIGSERIAL PRIMARY KEY,
  actor VARCHAR(320) NOT NULL,
  action VARCHAR(64) NOT NULL,
  target VARCHAR(320),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit(target, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
