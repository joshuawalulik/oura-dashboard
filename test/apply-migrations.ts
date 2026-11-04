/**
 * Vitest setup: apply the checked-in D1 migrations to the test database
 * before each test file, so tests run against the exact production schema.
 */
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.OURA_DB, env.TEST_MIGRATIONS);
