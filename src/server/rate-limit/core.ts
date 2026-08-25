import type { QueryResultRow } from "pg";

import {
  getDatabasePool,
  withRequestTransaction,
  type DatabaseClient,
  type DatabasePool,
  type RequestTransactionContext,
} from "../db/core.ts";

export const TENANT_RATE_LIMIT_POLICIES = Object.freeze([
  "CONNECTOR_MUTATION",
  "SEARCH",
  "RAG",
] as const);

export type TenantRateLimitPolicy =
  (typeof TENANT_RATE_LIMIT_POLICIES)[number];

export interface TenantRateLimitDecision {
  readonly outcome: "ALLOW" | "DENY";
  readonly policy: TenantRateLimitPolicy;
}

export class TenantRateLimitUnavailableError extends Error {
  override readonly name = "TenantRateLimitUnavailableError";
  readonly code = "RATE_LIMIT_UNAVAILABLE";

  constructor() {
    super("Tenant rate-limit decision is unavailable");
  }
}

interface AdmissionRow extends QueryResultRow {
  readonly expected_count: unknown;
  readonly context_count: unknown;
  readonly admitted_count: unknown;
}

type RateLimitClient = Pick<DatabaseClient, "query">;

const RAG_SAVEPOINT = "uptech_tenant_rag_rate_limit";
const SAVE_RAG_RATE_LIMIT = `SAVEPOINT ${RAG_SAVEPOINT}`;
const ROLLBACK_RAG_RATE_LIMIT = `ROLLBACK TO SAVEPOINT ${RAG_SAVEPOINT}`;
const RELEASE_RAG_RATE_LIMIT = `RELEASE SAVEPOINT ${RAG_SAVEPOINT}`;

// The sole parameter selects one closed policy. Scope, maxima and windows are
// fixed below; tenant locators come only from transaction-local PostgreSQL GUCs.
const CONSUME_TENANT_RATE_LIMIT_SQL = `
WITH requested_policy (
  policy_name,
  scope_kind,
  max_requests,
  window_seconds,
  ordinal
) AS (
  SELECT configured_policy.*
  FROM (
    VALUES
      ('CONNECTOR_MUTATION'::text, 'MEMBERSHIP'::text, 10::integer, 600::integer, 1::integer),
      ('SEARCH'::text, 'MEMBERSHIP'::text, 60::integer, 60::integer, 1::integer),
      ('RAG'::text, 'MEMBERSHIP'::text, 10::integer, 60::integer, 1::integer),
      ('RAG'::text, 'WORKSPACE'::text, 100::integer, 60::integer, 2::integer)
  ) AS configured_policy (
    policy_name,
    scope_kind,
    max_requests,
    window_seconds,
    ordinal
  )
  WHERE configured_policy.policy_name = $1::text
),
request_context AS MATERIALIZED (
  SELECT
    membership.workspace_id,
    membership.id AS membership_id
  FROM uptech.workspace_memberships AS membership
  WHERE membership.workspace_id = current_setting('app.workspace_id')::uuid
    AND membership.id = current_setting('app.membership_id')::uuid
    AND membership.user_id = current_setting('app.actor_id')::uuid
    AND membership.status = 'ACTIVE'
),
targets AS (
  SELECT
    request_context.workspace_id,
    requested_policy.scope_kind,
    pg_catalog.sha256(
      pg_catalog.convert_to(
        CASE requested_policy.scope_kind
          WHEN 'MEMBERSHIP' THEN request_context.membership_id::text
          WHEN 'WORKSPACE' THEN request_context.workspace_id::text
        END,
        'UTF8'
      )
    ) AS scope_hash,
    requested_policy.policy_name AS route_class,
    window_boundaries.window_started_at,
    requested_policy.window_seconds,
    window_boundaries.window_started_at
      + requested_policy.window_seconds * interval '1 second' AS expires_at,
    requested_policy.ordinal
  FROM requested_policy
  CROSS JOIN request_context
  CROSS JOIN LATERAL (
    SELECT pg_catalog.to_timestamp(
      pg_catalog.floor(
        extract(epoch FROM pg_catalog.statement_timestamp())
        / requested_policy.window_seconds
      ) * requested_policy.window_seconds
    ) AS window_started_at
  ) AS window_boundaries
),
admission AS (
  INSERT INTO uptech.rate_limit_buckets (
    workspace_id,
    scope_kind,
    scope_hash,
    route_class,
    window_started_at,
    window_seconds,
    request_count,
    expires_at,
    updated_at
  )
  SELECT
    targets.workspace_id,
    targets.scope_kind,
    targets.scope_hash,
    targets.route_class,
    targets.window_started_at,
    targets.window_seconds,
    1,
    targets.expires_at,
    pg_catalog.statement_timestamp()
  FROM targets
  ORDER BY targets.ordinal
  ON CONFLICT (
    workspace_id,
    scope_kind,
    scope_hash,
    route_class,
    window_started_at
  )
  DO UPDATE SET
    request_count = uptech.rate_limit_buckets.request_count + 1,
    updated_at = pg_catalog.statement_timestamp()
  WHERE uptech.rate_limit_buckets.request_count < CASE
    WHEN EXCLUDED.route_class = 'CONNECTOR_MUTATION'
      AND EXCLUDED.scope_kind = 'MEMBERSHIP' THEN 10
    WHEN EXCLUDED.route_class = 'SEARCH'
      AND EXCLUDED.scope_kind = 'MEMBERSHIP' THEN 60
    WHEN EXCLUDED.route_class = 'RAG'
      AND EXCLUDED.scope_kind = 'MEMBERSHIP' THEN 10
    WHEN EXCLUDED.route_class = 'RAG'
      AND EXCLUDED.scope_kind = 'WORKSPACE' THEN 100
    ELSE 0
  END
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM requested_policy)::integer AS expected_count,
  (SELECT count(*) FROM request_context)::integer AS context_count,
  (SELECT count(*) FROM admission)::integer AS admitted_count
`;

function isTenantRateLimitPolicy(
  value: unknown,
): value is TenantRateLimitPolicy {
  return (
    value === "CONNECTOR_MUTATION" ||
    value === "SEARCH" ||
    value === "RAG"
  );
}

function expectedBucketCount(policy: TenantRateLimitPolicy): number {
  return policy === "RAG" ? 2 : 1;
}

function parseAdmission(
  rows: readonly AdmissionRow[],
  policy: TenantRateLimitPolicy,
): TenantRateLimitDecision {
  const expectedCount = expectedBucketCount(policy);
  if (rows.length !== 1) {
    throw new TenantRateLimitUnavailableError();
  }

  const row = rows[0];
  if (
    row.expected_count !== expectedCount ||
    row.context_count !== 1 ||
    typeof row.admitted_count !== "number" ||
    !Number.isInteger(row.admitted_count) ||
    row.admitted_count < 0 ||
    row.admitted_count > expectedCount
  ) {
    throw new TenantRateLimitUnavailableError();
  }

  return Object.freeze({
    outcome: row.admitted_count === expectedCount ? "ALLOW" : "DENY",
    policy,
  });
}

async function queryAdmission(
  client: RateLimitClient,
  policy: TenantRateLimitPolicy,
): Promise<TenantRateLimitDecision> {
  const result = await client.query<AdmissionRow>(
    CONSUME_TENANT_RATE_LIMIT_SQL,
    [policy],
  );
  return parseAdmission(result.rows, policy);
}

async function consumeRagRateLimit(
  client: RateLimitClient,
): Promise<TenantRateLimitDecision> {
  let savepointActive = false;

  try {
    await client.query(SAVE_RAG_RATE_LIMIT);
    savepointActive = true;

    const decision = await queryAdmission(client, "RAG");
    if (decision.outcome === "DENY") {
      await client.query(ROLLBACK_RAG_RATE_LIMIT);
    }

    await client.query(RELEASE_RAG_RATE_LIMIT);
    savepointActive = false;
    return decision;
  } catch {
    if (savepointActive) {
      try {
        await client.query(ROLLBACK_RAG_RATE_LIMIT);
        await client.query(RELEASE_RAG_RATE_LIMIT);
      } catch {
        // The outer request transaction owns the final rollback.
      }
    }

    throw new TenantRateLimitUnavailableError();
  }
}

async function consumeTenantRateLimitInTransaction(
  client: RateLimitClient,
  policy: TenantRateLimitPolicy,
): Promise<TenantRateLimitDecision> {
  if (policy === "RAG") {
    return consumeRagRateLimit(client);
  }

  try {
    return await queryAdmission(client, policy);
  } catch {
    throw new TenantRateLimitUnavailableError();
  }
}

// Admission owns a short, independent transaction. Returning ALLOW means the
// counter commit completed before any downstream provider or business work can
// start; a later failure therefore cannot roll quota back or retain its row lock.
export async function consumeTenantRateLimit(
  context: RequestTransactionContext,
  policy: TenantRateLimitPolicy,
  pool: Pick<DatabasePool, "connect"> = getDatabasePool(),
): Promise<TenantRateLimitDecision> {
  if (!isTenantRateLimitPolicy(policy)) {
    throw new TenantRateLimitUnavailableError();
  }

  try {
    return await withRequestTransaction(
      context,
      (client) => consumeTenantRateLimitInTransaction(client, policy),
      pool,
    );
  } catch {
    throw new TenantRateLimitUnavailableError();
  }
}
