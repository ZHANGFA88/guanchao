-- LOCAL ADAPTATION (sandbox calibration only): the user-space PostgreSQL 17 binaries used in the
-- Muse sandbox were built without lz4 support (only pglz), so the original statements fail here.
-- Both statements are pure storage-compression tuning; skipping them changes no behavior.
-- On the production deployment (official postgres:17 Docker image, built with lz4) restore the
-- original file from the upstream AIHOT repo (0034_lz4_toast.sql) before first migration.
SELECT 1;
