CREATE TABLE IF NOT EXISTS local_accounts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('student', 'guest', 'admin')),
  role TEXT NOT NULL CHECK (role IN ('participant', 'boothAdmin', 'rewardAdmin', 'superAdmin')),
  login_id TEXT NOT NULL UNIQUE,
  login_id_lower TEXT NOT NULL UNIQUE,
  student_code TEXT UNIQUE,
  guest_pass_id TEXT UNIQUE,
  password_hash TEXT,
  display_name TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS local_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES local_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('participant', 'boothAdmin', 'rewardAdmin', 'superAdmin')),
  device_hash TEXT,
  ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_booths (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  club_name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  stamp_design_data_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS local_invite_codes (
  id TEXT PRIMARY KEY,
  code_label TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('boothAdmin', 'rewardAdmin', 'superAdmin')),
  booth_id TEXT REFERENCES local_booths(id) ON DELETE CASCADE,
  used_by_account_id TEXT REFERENCES local_accounts(id) ON DELETE SET NULL,
  used_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS local_admin_booths (
  account_id TEXT NOT NULL REFERENCES local_accounts(id) ON DELETE CASCADE,
  booth_id TEXT NOT NULL REFERENCES local_booths(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, booth_id)
);

CREATE TABLE IF NOT EXISTS local_guest_passes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'guest',
  token_hash TEXT NOT NULL UNIQUE,
  qr_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('active', 'voided')) DEFAULT 'active',
  account_id TEXT UNIQUE REFERENCES local_accounts(id) ON DELETE SET NULL,
  created_by_admin_id TEXT REFERENCES local_accounts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS local_goods (
  id TEXT PRIMARY KEY,
  booth_id TEXT NOT NULL REFERENCES local_booths(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft', 'public', 'closed')) DEFAULT 'draft',
  limit_per_user INTEGER NOT NULL DEFAULT 1 CHECK (limit_per_user >= 1 AND limit_per_user <= 20),
  created_by_admin_id TEXT REFERENCES local_accounts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS local_goods_options (
  id TEXT PRIMARY KEY,
  goods_id TEXT NOT NULL REFERENCES local_goods(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_stock INTEGER NOT NULL CHECK (total_stock >= 0),
  remaining_stock INTEGER NOT NULL CHECK (remaining_stock >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS local_goods_orders (
  id TEXT PRIMARY KEY,
  goods_id TEXT NOT NULL REFERENCES local_goods(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES local_goods_options(id) ON DELETE RESTRICT,
  participant_account_id TEXT NOT NULL REFERENCES local_accounts(id) ON DELETE CASCADE,
  claim_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'claimed', 'cancelled')) DEFAULT 'reserved',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT,
  claimed_by_admin_id TEXT REFERENCES local_accounts(id) ON DELETE SET NULL,
  UNIQUE (participant_account_id, goods_id)
);

CREATE TABLE IF NOT EXISTS local_stamps (
  id TEXT PRIMARY KEY,
  participant_account_id TEXT NOT NULL REFERENCES local_accounts(id) ON DELETE CASCADE,
  booth_id TEXT NOT NULL REFERENCES local_booths(id) ON DELETE CASCADE,
  issued_by_admin_id TEXT NOT NULL REFERENCES local_accounts(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided INTEGER NOT NULL DEFAULT 0 CHECK (voided IN (0, 1)),
  UNIQUE (participant_account_id, booth_id)
);

CREATE TABLE IF NOT EXISTS local_audit_logs (
  id TEXT PRIMARY KEY,
  actor_account_id TEXT REFERENCES local_accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_local_sessions_account ON local_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_local_sessions_expires ON local_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_local_goods_booth ON local_goods(booth_id);
CREATE INDEX IF NOT EXISTS idx_local_goods_orders_participant ON local_goods_orders(participant_account_id);
CREATE INDEX IF NOT EXISTS idx_local_audit_created ON local_audit_logs(created_at DESC);
