-- Clean-IP pool for config generation — see db/schema.ts's frontIps
-- comment for why this deliberately has no reachability/latency columns.
CREATE TABLE front_ips (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  label TEXT,
  source TEXT NOT NULL DEFAULT 'CUSTOM',
  created_at INTEGER NOT NULL
);
