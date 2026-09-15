-- Bot admin/editor improvements and deployment metadata.
ALTER TABLE bot_emoji_library ADD COLUMN custom_emoji_id TEXT;
ALTER TABLE bot_cloudflare_accounts ADD COLUMN email TEXT;
ALTER TABLE bot_panels ADD COLUMN worker_name TEXT;
ALTER TABLE bot_panels ADD COLUMN d1_database_id TEXT;
ALTER TABLE bot_panels ADD COLUMN kv_namespace_id TEXT;
ALTER TABLE bot_panels ADD COLUMN deployment_version_id TEXT;
