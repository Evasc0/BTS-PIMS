-- Auth columns are enforced in runtime schema bootstrap (`ensureCoreSchema`),
-- which supports legacy databases without relying on SQLite-specific ALTER syntax.
SELECT 1;
