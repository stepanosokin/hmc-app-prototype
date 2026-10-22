#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  --set=worker_password="$WORKER_PASSWORD" --set=api_password="$API_PASSWORD" --set=mosaic_password="$MOSAIC_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;
\i /docker-entrypoint-initdb.d/native-crs.sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE hmc_worker LOGIN PASSWORD :'worker_password';
CREATE ROLE hmc_api LOGIN PASSWORD :'api_password';
CREATE ROLE hmc_mosaic LOGIN PASSWORD :'mosaic_password';
CREATE SCHEMA app AUTHORIZATION hmc_worker;
CREATE SCHEMA mosaic AUTHORIZATION hmc_mosaic;
SET ROLE hmc_worker;
CREATE TABLE app.jobs (
  id uuid PRIMARY KEY, submitted_at timestamptz NOT NULL,
  source_name text NOT NULL, checksum text, pipeline_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('discovered','staged','decoded','normalized','derivatives_ready','validated','published','failed')),
  history jsonb NOT NULL, selection text, manifest_path text, manifest_sha256 text,
  error text, scenario text NOT NULL DEFAULT 'actual', request jsonb
  , attempts integer NOT NULL DEFAULT 0, stage text, retry_at timestamptz,
  retryable boolean NOT NULL DEFAULT false, delivery_key text, managed_source text
);
CREATE TABLE app.catalogue (
  selection text PRIMARY KEY, job_id uuid UNIQUE NOT NULL REFERENCES app.jobs,
  manifest_path text NOT NULL, manifest_sha256 text NOT NULL,
  published_at timestamptz NOT NULL
);
GRANT USAGE ON SCHEMA app TO hmc_api;
GRANT SELECT, INSERT ON app.jobs TO hmc_api;
GRANT SELECT ON app.catalogue TO hmc_api;
CREATE TABLE app.revisions (
  revision text PRIMARY KEY, run text NOT NULL, manifest_path text NOT NULL,
  manifest_sha256 text NOT NULL, published_at timestamptz NOT NULL,
  job_id uuid NOT NULL REFERENCES app.jobs
);
GRANT SELECT ON app.revisions TO hmc_api;
RESET ROLE;
SQL
