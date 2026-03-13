-- LoopStorm Guard — local development seed data
-- Applied by: bunx supabase db reset (runs after migrations)
--
-- IMPORTANT: These are dev-only values. Never use these in production.
-- The API key hash below is sha256('lsg_devkey123').

-- Dev tenant
INSERT INTO tenants (id, name, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Dev Tenant (Local)',
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Dev API key
-- Plaintext: lsg_devkey123
-- SHA-256:   c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2
INSERT INTO api_keys (id, tenant_id, name, key_hash, created_at)
VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'dev-key',
  'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2',
  NOW()
) ON CONFLICT DO NOTHING;

-- Dev agent profile: data-processor-v2 / etl-worker
INSERT INTO agent_profiles (id, tenant_id, agent_name, agent_role, created_at)
VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'data-processor-v2',
  'etl-worker',
  NOW()
) ON CONFLICT DO NOTHING;
