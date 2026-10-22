#!/bin/sh
# Also safe to execute explicitly when upgrading existing publication volumes.
set -eu
psql --username "${POSTGRES_USER:-postgres}" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  --set=gateway_password="$GATEWAY_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE hmc_gateway LOGIN' WHERE NOT EXISTS
  (SELECT 1 FROM pg_roles WHERE rolname='hmc_gateway') \gexec
ALTER ROLE hmc_gateway PASSWORD :'gateway_password';
CREATE SCHEMA IF NOT EXISTS access AUTHORIZATION hmc_worker;
SQL
