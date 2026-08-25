\set ON_ERROR_STOP on

-- Run once as a PostgreSQL cluster administrator. These are capability roles,
-- not login roles; deployment-specific login roles and credentials are created
-- outside this repository and granted exactly one runtime capability role.
DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'uptech_migration_owner') THEN
    CREATE ROLE uptech_migration_owner NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'uptech_api_runtime') THEN
    CREATE ROLE uptech_api_runtime NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'uptech_worker_runtime') THEN
    CREATE ROLE uptech_worker_runtime NOLOGIN;
  END IF;
END
$bootstrap$;

ALTER ROLE uptech_migration_owner
  WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE uptech_api_runtime
  WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE uptech_worker_runtime
  WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

REVOKE uptech_migration_owner FROM uptech_api_runtime;
REVOKE uptech_migration_owner FROM uptech_worker_runtime;
REVOKE uptech_api_runtime FROM uptech_worker_runtime;
REVOKE uptech_worker_runtime FROM uptech_api_runtime;

-- Do not let an untrusted user shadow migration-owned objects in the default
-- schema. CONNECT and login-role membership remain deployment concerns.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS uptech AUTHORIZATION uptech_migration_owner;
ALTER SCHEMA uptech OWNER TO uptech_migration_owner;
REVOKE ALL ON SCHEMA uptech FROM PUBLIC;
GRANT USAGE ON SCHEMA uptech TO uptech_api_runtime, uptech_worker_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
