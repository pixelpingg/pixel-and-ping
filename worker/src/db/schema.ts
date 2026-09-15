// Pixel & Ping — D1 (SQLite) schema via Drizzle ORM.
//
// This mirrors the logical data model of the original Prisma/PostgreSQL
// schema (backend/prisma/schema.prisma) as closely as SQLite allows.
// Differences from the Postgres version, all forced by SQLite/D1 itself:
//   - No native enum type      -> plain `text`, values documented per column
//   - No native array type     -> JSON-encoded `text` (e.g. ApiKey.scopes)
//   - No native UUID/cuid()    -> IDs generated in app code via crypto.randomUUID()
//   - No native BigInt         -> `integer` (SQLite INTEGER is 64-bit signed,
//                                  safe up to ~9.2 exabytes; more than enough
//                                  headroom for realistic traffic byte counts)
//   - Timestamps stored as Unix milliseconds (`integer`, mode: "timestamp_ms")
//
// Every table/column here has a 1:1 conceptual counterpart in the Postgres
// schema — nothing was dropped, only re-expressed for SQLite.

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------
// Admin / Auth / 2FA
// ---------------------------------------------------------------------

export const admins = sqliteTable("admins", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  avatarUrl: text("avatar_url"),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("ADMIN"), // SUPER_ADMIN | ADMIN | VIEWER
  twoFactorSecret: text("two_factor_secret"),
  twoFactorPendingSecret: text("two_factor_pending_secret"),
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  lastLoginIp: text("last_login_ip"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    adminId: text("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => ({ adminIdx: index("sessions_admin_idx").on(t.adminId) })
);

export const twoFactorRecoveryCodes = sqliteTable(
  "two_factor_recovery_codes",
  {
    id: text("id").primaryKey(),
    adminId: text("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({ adminIdx: index("recovery_codes_admin_idx").on(t.adminId) })
);

// scopes: JSON array of "TRAFFIC_INGEST" | "PRESENCE_INGEST" | "FULL_INGEST"
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  scopes: text("scopes").notNull(), // JSON.stringify(string[])
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  createdById: text("created_by_id").references(() => admins.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

// ---------------------------------------------------------------------
// Cloudflare
// ---------------------------------------------------------------------

export const cloudflareAccounts = sqliteTable("cloudflare_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  accountId: text("account_id").notNull().unique(),
  // AES-256-GCM ciphertext (via Web Crypto SubtleCrypto — see lib/crypto.ts).
  // The encryption key comes from the ENCRYPTION_KEY Worker secret, never
  // from D1 or the frontend.
  encryptedToken: text("encrypted_token").notNull(),
  tokenIv: text("token_iv").notNull(),
  tokenAuthTag: text("token_auth_tag").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  status: text("status").notNull().default("UNKNOWN"), // HEALTHY | UNHEALTHY | UNKNOWN
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  lastSyncError: text("last_sync_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const cloudflareUsageSnapshots = sqliteTable(
  "cloudflare_usage_snapshots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().references(() => cloudflareAccounts.id, { onDelete: "cascade" }),
    zoneId: text("zone_id"),
    zoneName: text("zone_name"),
    requestsToday: integer("requests_today"),
    requestsThisMonth: integer("requests_this_month"),
    bandwidthBytes: integer("bandwidth_bytes"),
    errorsCount: integer("errors_count"),
    dataAvailable: integer("data_available", { mode: "boolean" }).notNull().default(true),
    source: text("source").notNull().default("Cloudflare GraphQL Analytics API"),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    accountIdx: index("cf_usage_account_idx").on(t.accountId, t.capturedAt),
    zoneIdx: index("cf_usage_zone_idx").on(t.zoneId, t.capturedAt),
  })
);

// ---------------------------------------------------------------------
// Servers / Endpoints
// ---------------------------------------------------------------------

export const servers = sqliteTable("servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  protocol: text("protocol").notNull(),
  location: text("location"),
  status: text("status").notNull().default("OFFLINE"), // ONLINE | OFFLINE | DEGRADED | MAINTENANCE
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  cloudflareAccountId: text("cloudflare_account_id").references(() => cloudflareAccounts.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const endpoints = sqliteTable(
  "endpoints",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    weight: integer("weight").notNull().default(100),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    health: text("health").notNull().default("UNKNOWN"), // EXCELLENT|GOOD|FAIR|POOR|OFFLINE|UNKNOWN
    score: integer("score").notNull().default(0),
    latencyMs: integer("latency_ms"),
    packetLossPct: integer("packet_loss_pct"), // tenths-of-percent (x10) to avoid REAL rounding
    tlsOk: integer("tls_ok", { mode: "boolean" }),
    httpStatus: integer("http_status"),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    serverIdx: index("endpoints_server_idx").on(t.serverId),
    healthIdx: index("endpoints_health_idx").on(t.health),
  })
);

export const healthChecks = sqliteTable(
  "health_checks",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").references(() => servers.id, { onDelete: "cascade" }),
    endpointId: text("endpoint_id").references(() => endpoints.id, { onDelete: "cascade" }),
    latencyMs: integer("latency_ms"),
    packetLossPct: integer("packet_loss_pct"),
    tlsOk: integer("tls_ok", { mode: "boolean" }),
    httpStatus: integer("http_status"),
    success: integer("success", { mode: "boolean" }).notNull(),
    errorMessage: text("error_message"),
    checkedAt: integer("checked_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    serverIdx: index("health_checks_server_idx").on(t.serverId, t.checkedAt),
    endpointIdx: index("health_checks_endpoint_idx").on(t.endpointId, t.checkedAt),
  })
);

export const failoverEvents = sqliteTable("failover_events", {
  id: text("id").primaryKey(),
  fromEndpointId: text("from_endpoint_id").references(() => endpoints.id),
  toEndpointId: text("to_endpoint_id").references(() => endpoints.id),
  reason: text("reason").notNull(),
  triggeredAt: integer("triggered_at", { mode: "timestamp_ms" }).notNull(),
  automatic: integer("automatic", { mode: "boolean" }).notNull().default(true),
});

export const failoverSettings = sqliteTable("failover_settings", {
  id: text("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  failureThreshold: integer("failure_threshold").notNull().default(3),
  retryCount: integer("retry_count").notNull().default(2),
  healthCheckIntervalSec: integer("health_check_interval_sec").notNull().default(30),
  recoveryThreshold: integer("recovery_threshold").notNull().default(2),
  strategy: text("strategy").notNull().default("HEALTH_BASED"), // ROUND_ROBIN|LEAST_LATENCY|WEIGHTED|HEALTH_BASED
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// ---------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------

export const ports = sqliteTable("ports", {
  id: text("id").primaryKey(),
  number: integer("number").notNull().unique(),
  type: text("type").notNull(), // TLS | NON_TLS | CUSTOM
  label: text("label"),
  isReserved: integer("is_reserved", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// ---------------------------------------------------------------------
// VPN Users
// ---------------------------------------------------------------------

export const vpnUsers = sqliteTable(
  "vpn_users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    status: text("status").notNull().default("ACTIVE"), // ACTIVE|DISABLED|SUSPENDED|EXPIRED
    serverId: text("server_id").references(() => servers.id),
    preferredEndpointId: text("preferred_endpoint_id").references(() => endpoints.id),
    protocol: text("protocol").notNull(),
    port: integer("port").notNull(),
    tls: integer("tls", { mode: "boolean" }).notNull().default(true),
    uuid: text("uuid").notNull().unique(),
    // sha224(uuid) hex, precomputed at creation time — Trojan's wire
    // protocol authenticates with a SHA224 password hash, and looking a
    // presented hash up directly (indexed, O(1)) is far cheaper per
    // connection than hashing every trojan user's uuid on every relay
    // request. See services/relayService.ts.
    trojanPasswordHash: text("trojan_password_hash").unique(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    trafficLimitBytes: integer("traffic_limit_bytes"),
    requestLimit: integer("request_limit"),
    autoIpFailover: integer("auto_ip_failover", { mode: "boolean" }).notNull().default(false),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    isOnline: integer("is_online", { mode: "boolean" }).notNull().default(false),
    lastEndpointId: text("last_endpoint_id"),
    provisioningStatus: text("provisioning_status").notNull().default("NOT_PROVISIONED"),
    provisioningMessage: text("provisioning_message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    onlineIdx: index("vpn_users_online_idx").on(t.isOnline),
    lastSeenIdx: index("vpn_users_last_seen_idx").on(t.lastSeenAt),
  })
);

export const connectionSessions = sqliteTable(
  "connection_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => vpnUsers.id, { onDelete: "cascade" }),
    serverId: text("server_id").references(() => servers.id),
    endpointId: text("endpoint_id").references(() => endpoints.id),
    clientIp: text("client_ip"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    endReason: text("end_reason"),
  },
  (t) => ({
    userIdx: index("connection_sessions_user_idx").on(t.userId, t.startedAt),
    endedIdx: index("connection_sessions_ended_idx").on(t.endedAt),
  })
);

export const trafficUsage = sqliteTable(
  "traffic_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => vpnUsers.id, { onDelete: "cascade" }),
    uploadBytes: integer("upload_bytes").notNull().default(0),
    downloadBytes: integer("download_bytes").notNull().default(0),
    isEstimated: integer("is_estimated", { mode: "boolean" }).notNull().default(true),
    sourceApiKeyId: text("source_api_key_id"),
    idempotencyKey: text("idempotency_key").unique(),
    periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    userIdx: index("traffic_usage_user_idx").on(t.userId, t.periodStart),
    periodIdx: index("traffic_usage_period_idx").on(t.periodStart),
  })
);

export const requestUsage = sqliteTable(
  "request_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => vpnUsers.id, { onDelete: "cascade" }),
    count: integer("count").notNull().default(0),
    idempotencyKey: text("idempotency_key").unique(),
    periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    userIdx: index("request_usage_user_idx").on(t.userId, t.periodStart),
    periodIdx: index("request_usage_period_idx").on(t.periodStart),
  })
);

export const configurations = sqliteTable(
  "configurations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => vpnUsers.id, { onDelete: "cascade" }),
    serverId: text("server_id").references(() => servers.id),
    protocol: text("protocol").notNull(),
    port: integer("port").notNull(),
    tls: integer("tls", { mode: "boolean" }).notNull(),
    rawConfig: text("raw_config").notNull(),
    version: integer("version").notNull().default(1),
    isRevoked: integer("is_revoked", { mode: "boolean" }).notNull().default(false),
    cloudflareAccountId: text("cloudflare_account_id"),
    cloudflareZoneId: text("cloudflare_zone_id"),
    hostname: text("hostname"),
    cloudflareVerified: integer("cloudflare_verified", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({ userIdx: index("configurations_user_idx").on(t.userId) })
);

// ---------------------------------------------------------------------
// Logs / Notifications / Settings
// ---------------------------------------------------------------------

export const activityLogs = sqliteTable(
  "activity_logs",
  {
    id: text("id").primaryKey(),
    adminId: text("admin_id").references(() => admins.id),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: text("metadata"), // JSON.stringify(...)
    ipAddress: text("ip_address"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({ createdIdx: index("activity_logs_created_idx").on(t.createdAt) })
);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  level: text("level").notNull().default("INFO"), // INFO|WARNING|ERROR|CRITICAL
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  metadata: text("metadata"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(), // JSON.stringify(...)
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * "Clean IP" pool for config generation (see services/configService.ts's
 * `frontIps` option and services/relayService.ts). Deliberately has NO
 * reachability/latency columns: Cloudflare Workers Sockets explicitly
 * block outbound connections to Cloudflare's own IP ranges (see
 * healthCheckService.ts's probeEndpoint docstring), so this Worker
 * cannot ever test whether one of these IPs is actually reachable —
 * and even if it could, "reachable from inside Cloudflare's network"
 * says nothing about whether a specific end user's ISP blocks it. This
 * table is honestly just a curated address book: Cloudflare's own
 * officially published ranges (seeded once) plus whatever addresses the
 * operator has separately confirmed work from their own network. Real
 * verification has to happen client-side, in the VPN app itself.
 */
export const frontIps = sqliteTable("front_ips", {
  id: text("id").primaryKey(),
  address: text("address").notNull().unique(),
  label: text("label"),
  source: text("source").notNull().default("CUSTOM"), // SEED | CUSTOM
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

