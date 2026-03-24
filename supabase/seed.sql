-- LoopStorm Guard — local development seed data
-- Applied by: bunx supabase db reset (runs after migrations)
--
-- IMPORTANT: These are dev-only placeholder values. Never use these in production.

-- Dev tenant
INSERT INTO tenants (id, name, slug, plan, is_active, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Dev Tenant (Local)',
  'dev-local',
  'free',
  true,
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Dev user (Better Auth uses text IDs, not UUIDs)
INSERT INTO users (id, name, email, email_verified, tenant_id, created_at, updated_at)
VALUES (
  'dev-user-001',
  'Dev User',
  'dev@localhost',
  true,
  '00000000-0000-0000-0000-000000000001',
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Dev API key
-- Plaintext: lsg_00000000000000000000000000000001
-- SHA-256:   aefc972a193a1be9685dd37fa11af3668b785dbf97ec551c69c9683ec97170b7
INSERT INTO api_keys (id, tenant_id, user_id, name, key_prefix, key_hash, scopes, created_at)
VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'dev-user-001',
  'dev-key',
  'lsg_0000',
  'aefc972a193a1be9685dd37fa11af3668b785dbf97ec551c69c9683ec97170b7',
  ARRAY['ingest', 'read'],
  NOW()
) ON CONFLICT DO NOTHING;
