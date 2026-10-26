-- ============================================================================
-- PLOTIFY ARCHITECTURE INTELLIGENCE OS
-- P53: Database Role Provisioning and Least Privilege Setup
-- Target Engine: PostgreSQL 16+
-- ============================================================================

-- Ensure script is idempotent
DO $$
BEGIN
  -- 1. Create Migration Role if not exists
  -- This role owns the DDL, migrations ledger, and schema definitions
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'plotify_migrator') THEN
    CREATE ROLE plotify_migrator WITH LOGIN PASSWORD 'plotify_migrator_secure_pass';
  END IF;

  -- 2. Create Application Runtime Role if not exists
  -- This role is restricted to DML only, NOBYPASSRLS, and NOSUPERUSER
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'plotify_app') THEN
    CREATE ROLE plotify_app WITH LOGIN PASSWORD 'plotify_app_secure_pass'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS;
  END IF;
END
$$;

-- Schema Permissions
GRANT CONNECT ON DATABASE current_database() TO plotify_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO plotify_migrator;

GRANT CONNECT ON DATABASE current_database() TO plotify_app;
GRANT USAGE ON SCHEMA public TO plotify_app;

-- Grant DML to application role on existing and future public tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO plotify_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO plotify_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO plotify_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO plotify_app;

-- Explicitly deny DDL & migration table to runtime application role
REVOKE CREATE ON SCHEMA public FROM plotify_app;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'schema_migrations') THEN
    REVOKE ALL ON TABLE schema_migrations FROM plotify_app;
  END IF;
END
$$;
