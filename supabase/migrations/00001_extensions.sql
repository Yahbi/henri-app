-- 00001_extensions.sql
-- Enable required PostgreSQL extensions for Henri App
-- uuid-ossp: UUID generation
-- postgis: geospatial queries for permit locations
-- pg_cron: scheduled jobs (scraping, scoring)
-- pg_net: HTTP requests from database (webhooks, notifications)
-- moddatetime: automatic updated_at triggers

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "pg_net";
CREATE EXTENSION IF NOT EXISTS "moddatetime";

COMMIT;
