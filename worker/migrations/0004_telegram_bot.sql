-- Telegram bot integration. Tokens are AES-256-GCM encrypted; raw tokens are never stored.
CREATE TABLE bot_users (
  telegram_id TEXT PRIMARY KEY,
  first_name TEXT,
  username TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX bot_users_seen_idx ON bot_users(last_seen_at);

CREATE TABLE bot_cloudflare_accounts (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL REFERENCES bot_users(telegram_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_id TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_auth_tag TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNKNOWN',
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(telegram_id, account_id)
);
CREATE INDEX bot_cf_user_idx ON bot_cloudflare_accounts(telegram_id, created_at);

CREATE TABLE bot_panels (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL REFERENCES bot_users(telegram_id) ON DELETE CASCADE,
  cloudflare_account_id TEXT NOT NULL REFERENCES bot_cloudflare_accounts(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  panel_url TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX bot_panels_user_idx ON bot_panels(telegram_id, created_at);
CREATE INDEX bot_panels_status_idx ON bot_panels(status);

CREATE TABLE bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE bot_emoji_library (
  key TEXT PRIMARY KEY,
  emoji TEXT NOT NULL,
  label TEXT,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO bot_settings(key,value,updated_at) VALUES
 ('menu.title','🚀 Pixel & Ping',strftime('%s','now')*1000),
 ('menu.connect_cloudflare','☁️ اتصال Cloudflare',strftime('%s','now')*1000),
 ('menu.my_panels','📦 پنل‌های من',strftime('%s','now')*1000),
 ('menu.new_panel','➕ ساخت پنل',strftime('%s','now')*1000);

INSERT OR IGNORE INTO bot_emoji_library(key,emoji,label,updated_at) VALUES
 ('cloudflare','☁️','Cloudflare',strftime('%s','now')*1000),
 ('panel','📦','Panel',strftime('%s','now')*1000),
 ('admin','👑','Admin',strftime('%s','now')*1000),
 ('success','✅','Success',strftime('%s','now')*1000),
 ('warning','⚠️','Warning',strftime('%s','now')*1000);
