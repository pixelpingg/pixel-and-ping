-- Pixel & Ping profile/security additions.
ALTER TABLE admins ADD COLUMN avatar_url TEXT;

-- Worker-native relay (services/relayService.ts): Trojan authenticates
-- with a SHA224(password) hash on the wire. Since this project uses the
-- account's own uuid as the Trojan "password", the hash is precomputed
-- once at user-creation time and indexed here for an O(1) lookup per
-- incoming relay connection instead of hashing every trojan user on
-- every request.
ALTER TABLE vpn_users ADD COLUMN trojan_password_hash TEXT;
CREATE UNIQUE INDEX vpn_users_trojan_hash_idx ON vpn_users(trojan_password_hash);
