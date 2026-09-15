-- Pixel & Ping — initial D1 schema.
-- Hand-written to match worker/src/db/schema.ts exactly (Drizzle's own
-- `drizzle-kit generate` could not be run in this environment — no
-- network access to install drizzle-kit or its deps. Review this against
-- schema.ts before applying, and prefer regenerating with drizzle-kit
-- once you have a working toolchain: `npx drizzle-kit generate`).
--
-- Apply with:
--   npx wrangler d1 migrations apply pixelping --local   (for `wrangler dev`)
--   npx wrangler d1 migrations apply pixelping --remote  (for production)

CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ADMIN',
  two_factor_secret TEXT,
  two_factor_pending_secret TEXT,
  two_factor_enabled INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at INTEGER,
  last_login_ip TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX sessions_admin_idx ON sessions(admin_id);

CREATE TABLE two_factor_recovery_codes (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX recovery_codes_admin_idx ON two_factor_recovery_codes(admin_id);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER,
  created_by_id TEXT REFERENCES admins(id),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE cloudflare_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_id TEXT NOT NULL UNIQUE,
  encrypted_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_auth_tag TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'UNKNOWN',
  last_sync_at INTEGER,
  last_sync_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE cloudflare_usage_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cloudflare_accounts(id) ON DELETE CASCADE,
  zone_id TEXT,
  zone_name TEXT,
  requests_today INTEGER,
  requests_this_month INTEGER,
  bandwidth_bytes INTEGER,
  errors_count INTEGER,
  data_available INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'Cloudflare GraphQL Analytics API',
  captured_at INTEGER NOT NULL
);
CREATE INDEX cf_usage_account_idx ON cloudflare_usage_snapshots(account_id, captured_at);
CREATE INDEX cf_usage_zone_idx ON cloudflare_usage_snapshots(zone_id, captured_at);

CREATE TABLE servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  protocol TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'OFFLINE',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  cloudflare_account_id TEXT REFERENCES cloudflare_accounts(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE endpoints (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  weight INTEGER NOT NULL DEFAULT 100,
  is_primary INTEGER NOT NULL DEFAULT 0,
  health TEXT NOT NULL DEFAULT 'UNKNOWN',
  score INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  packet_loss_pct INTEGER,
  tls_ok INTEGER,
  http_status INTEGER,
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX endpoints_server_idx ON endpoints(server_id);
CREATE INDEX endpoints_health_idx ON endpoints(health);

CREATE TABLE health_checks (
  id TEXT PRIMARY KEY,
  server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
  endpoint_id TEXT REFERENCES endpoints(id) ON DELETE CASCADE,
  latency_ms INTEGER,
  packet_loss_pct INTEGER,
  tls_ok INTEGER,
  http_status INTEGER,
  success INTEGER NOT NULL,
  error_message TEXT,
  checked_at INTEGER NOT NULL
);
CREATE INDEX health_checks_server_idx ON health_checks(server_id, checked_at);
CREATE INDEX health_checks_endpoint_idx ON health_checks(endpoint_id, checked_at);

CREATE TABLE failover_events (
  id TEXT PRIMARY KEY,
  from_endpoint_id TEXT REFERENCES endpoints(id),
  to_endpoint_id TEXT REFERENCES endpoints(id),
  reason TEXT NOT NULL,
  triggered_at INTEGER NOT NULL,
  automatic INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE failover_settings (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  failure_threshold INTEGER NOT NULL DEFAULT 3,
  retry_count INTEGER NOT NULL DEFAULT 2,
  health_check_interval_sec INTEGER NOT NULL DEFAULT 30,
  recovery_threshold INTEGER NOT NULL DEFAULT 2,
  strategy TEXT NOT NULL DEFAULT 'HEALTH_BASED',
  updated_at INTEGER NOT NULL
);

CREATE TABLE ports (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  type TEXT NOT NULL,
  label TEXT,
  is_reserved INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE vpn_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  server_id TEXT REFERENCES servers(id),
  preferred_endpoint_id TEXT REFERENCES endpoints(id),
  protocol TEXT NOT NULL,
  port INTEGER NOT NULL,
  tls INTEGER NOT NULL DEFAULT 1,
  uuid TEXT NOT NULL UNIQUE,
  expires_at INTEGER,
  traffic_limit_bytes INTEGER,
  request_limit INTEGER,
  auto_ip_failover INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  is_online INTEGER NOT NULL DEFAULT 0,
  last_endpoint_id TEXT,
  provisioning_status TEXT NOT NULL DEFAULT 'NOT_PROVISIONED',
  provisioning_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX vpn_users_online_idx ON vpn_users(is_online);
CREATE INDEX vpn_users_last_seen_idx ON vpn_users(last_seen_at);

CREATE TABLE connection_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES vpn_users(id) ON DELETE CASCADE,
  server_id TEXT REFERENCES servers(id),
  endpoint_id TEXT REFERENCES endpoints(id),
  client_ip TEXT,
  started_at INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT
);
CREATE INDEX connection_sessions_user_idx ON connection_sessions(user_id, started_at);
CREATE INDEX connection_sessions_ended_idx ON connection_sessions(ended_at);

CREATE TABLE traffic_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES vpn_users(id) ON DELETE CASCADE,
  upload_bytes INTEGER NOT NULL DEFAULT 0,
  download_bytes INTEGER NOT NULL DEFAULT 0,
  is_estimated INTEGER NOT NULL DEFAULT 1,
  source_api_key_id TEXT,
  idempotency_key TEXT UNIQUE,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX traffic_usage_user_idx ON traffic_usage(user_id, period_start);
CREATE INDEX traffic_usage_period_idx ON traffic_usage(period_start);

CREATE TABLE request_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES vpn_users(id) ON DELETE CASCADE,
  count INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX request_usage_user_idx ON request_usage(user_id, period_start);
CREATE INDEX request_usage_period_idx ON request_usage(period_start);

CREATE TABLE configurations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES vpn_users(id) ON DELETE CASCADE,
  server_id TEXT REFERENCES servers(id),
  protocol TEXT NOT NULL,
  port INTEGER NOT NULL,
  tls INTEGER NOT NULL,
  raw_config TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_revoked INTEGER NOT NULL DEFAULT 0,
  cloudflare_account_id TEXT,
  cloudflare_zone_id TEXT,
  hostname TEXT,
  cloudflare_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX configurations_user_idx ON configurations(user_id);

CREATE TABLE activity_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT REFERENCES admins(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT,
  ip_address TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX activity_logs_created_idx ON activity_logs(created_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'INFO',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
