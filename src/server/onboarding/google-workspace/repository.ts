import type { QueryResultRow } from "pg";

import type { DatabasePool } from "../../db/core.ts";
import type {
  BootstrapCompleteInput,
  BootstrapRetryOutcome,
  BootstrapStatusOutcome,
  GoogleWorkspaceBootstrapRepository,
  VerifiedGoogleWorkspaceDomain,
} from "./types.ts";

export type {
  BootstrapAbortInput,
  BootstrapCompleteInput,
  BootstrapPrepareInput,
  BootstrapReconcileInput,
  BootstrapRetryOutcome,
  BootstrapStatusInput,
  BootstrapStatusOutcome,
  GoogleWorkspaceBootstrapRepository,
  VerifiedGoogleWorkspaceDomain,
} from "./types.ts";

export class BootstrapCommitUnknownError extends Error {
  override readonly name = "BootstrapCommitUnknownError";
  constructor() { super("Google Workspace bootstrap database outcome is unknown"); }
}

export type GoogleWorkspaceBootstrapStartAdmissionResult = Readonly<{
  outcome: "ADMITTED" | "RATE_LIMITED" | "DENIED";
}>;

export type GoogleWorkspaceBootstrapStartAdmission = (input: Readonly<{
  networkHmac: Uint8Array;
  requestId: string;
}>) => Promise<GoogleWorkspaceBootstrapStartAdmissionResult>;

const ADMIT_START_SQL = `SELECT result.outcome::text AS outcome
FROM uptech.admit_google_workspace_bootstrap_start_v1(
  $1::uptech.google_auth_hash32_v1,$2::uuid
) AS result`;

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const PREPARE_SQL = `SELECT result.outcome::text AS outcome
FROM uptech.prepare_google_workspace_bootstrap_v1(
  $1::uuid,$2::uptech.google_auth_hash32_v1,$3::uuid,
  $4::uptech.google_auth_hash32_v1,$5::uuid
) AS result`;

const COMPLETE_SQL = `SELECT result.outcome::text AS outcome,result.status_expires_at
FROM uptech.complete_google_workspace_bootstrap_v1(
  $1::uuid,$2::uptech.google_auth_hash32_v1,$3::uptech.google_auth_hash32_v1,
  $4::text,$5::text,$6::text,$7::text,
  $8::uptech.google_workspace_verified_domain_v1[],$9::text,$10::text[],$11::uuid
) AS result`;

const RECONCILE_SQL = `SELECT result.outcome::text AS outcome
FROM uptech.reconcile_google_workspace_bootstrap_v1(
  $1::uuid,$2::uptech.google_auth_hash32_v1,$3::uptech.google_auth_hash32_v1,
  $4::text,$5::uuid
) AS result`;

const ABORT_SQL = `SELECT result.outcome::text AS outcome
FROM uptech.abort_google_workspace_bootstrap_v1(
  $1::uuid,$2::uptech.google_auth_hash32_v1,$3::uuid
) AS result`;

const READ_STATUS_SQL = `SELECT result.outcome::text AS outcome
FROM uptech.read_google_workspace_bootstrap_status_v1(
  $1::uptech.google_auth_hash32_v1,$2::uuid
) AS result`;

const RETRY_SYNC_SQL = `SELECT result.outcome::text AS outcome
FROM uptech.retry_google_workspace_bootstrap_sync_v1(
  $1::uptech.google_auth_hash32_v1,$2::uuid
) AS result`;

function bytes(value: Uint8Array): Buffer { return Buffer.from(value); }

function compositeField(value: string | null): string {
  if (value === null) return "";
  if (/^[A-Za-z0-9.-]+$/u.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function domainArray(domains: readonly VerifiedGoogleWorkspaceDomain[]): string {
  return `{${domains.map((domain) => {
    const composite = `(${compositeField(domain.normalizedDomain)},${domain.domainKind},${compositeField(domain.providerParentDomain)})`;
    return `"${composite.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  }).join(",")}}`;
}

function one(rows: QueryResultRow[]): QueryResultRow {
  if (rows.length !== 1) throw new BootstrapCommitUnknownError();
  return rows[0]!;
}

function outcomeOnly(row: QueryResultRow, allowed: readonly string[]): string {
  if (Object.keys(row).length !== 1 || typeof row.outcome !== "string" || !allowed.includes(row.outcome)) {
    throw new BootstrapCommitUnknownError();
  }
  return row.outcome;
}

async function unknownBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof BootstrapCommitUnknownError) throw error;
    throw new BootstrapCommitUnknownError();
  }
}

export function createGoogleWorkspaceBootstrapStartAdmission(
  pool: Pick<DatabasePool, "query">,
): GoogleWorkspaceBootstrapStartAdmission {
  return (input: Parameters<GoogleWorkspaceBootstrapStartAdmission>[0]) => unknownBoundary(async () => {
    if (!(input.networkHmac instanceof Uint8Array) || input.networkHmac.byteLength !== 32 ||
        !CANONICAL_UUID.test(input.requestId)) {
      throw new BootstrapCommitUnknownError();
    }
    const row = one((await pool.query(ADMIT_START_SQL, [
      bytes(input.networkHmac), input.requestId,
    ])).rows as QueryResultRow[]);
    return {
      outcome: outcomeOnly(row, ["ADMITTED", "RATE_LIMITED", "DENIED"]) as
        GoogleWorkspaceBootstrapStartAdmissionResult["outcome"],
    };
  });
}

export function createGoogleWorkspaceBootstrapRepository(
  pool: Pick<DatabasePool, "query">,
): GoogleWorkspaceBootstrapRepository {
  const statusOperation = <T extends BootstrapStatusOutcome | BootstrapRetryOutcome>(
    sql: string,
    allowed: readonly T[],
    input: import("./types.ts").BootstrapStatusInput,
  ) => unknownBoundary(async () => {
    if (!(input.statusTokenHash instanceof Uint8Array) || input.statusTokenHash.byteLength !== 32 ||
        !CANONICAL_UUID.test(input.requestId)) {
      throw new BootstrapCommitUnknownError();
    }
    const row = one((await pool.query(sql, [bytes(input.statusTokenHash), input.requestId])).rows as QueryResultRow[]);
    return { outcome: outcomeOnly(row, allowed) as T };
  });
  const implementation: GoogleWorkspaceBootstrapRepository = {
    prepare: (input) => unknownBoundary(async () => {
      const row = one((await pool.query(PREPARE_SQL, [
        input.attemptId, bytes(input.sourceTokenHash), input.candidateWorkspaceId,
        bytes(input.statusTokenHash), input.requestId,
      ])).rows as QueryResultRow[]);
      return { outcome: outcomeOnly(row, ["PREPARED", "DENIED"]) as "PREPARED" | "DENIED" };
    }),
    complete: (input: BootstrapCompleteInput) => unknownBoundary(async () => {
      const row = one((await pool.query(COMPLETE_SQL, [
        input.attemptId, bytes(input.sourceTokenHash), bytes(input.statusTokenHash),
        input.customerId, input.customerDomain, input.providerSubject, input.hostedDomain,
        domainArray(input.verifiedDomains), input.credentialReference,
        [...input.authorizedScopes], input.requestId,
      ])).rows as QueryResultRow[]);
      if (row.outcome === "DENIED" && row.status_expires_at === null && Object.keys(row).length === 2) {
        return { outcome: "DENIED" as const };
      }
      if (row.outcome !== "PROVISIONING" || Object.keys(row).length !== 2 ||
          !(row.status_expires_at instanceof Date) || !Number.isFinite(row.status_expires_at.getTime())) {
        throw new BootstrapCommitUnknownError();
      }
      return { outcome: "PROVISIONING" as const, statusExpiresAt: new Date(row.status_expires_at.getTime()) };
    }),
    reconcile: (input) => unknownBoundary(async () => {
      const row = one((await pool.query(RECONCILE_SQL, [
        input.attemptId, bytes(input.sourceTokenHash), bytes(input.statusTokenHash),
        input.credentialReference, input.requestId,
      ])).rows as QueryResultRow[]);
      return { outcome: outcomeOnly(row, ["COMMITTED", "NOT_COMMITTED", "UNKNOWN"]) as "COMMITTED" | "NOT_COMMITTED" | "UNKNOWN" };
    }),
    abort: (input) => unknownBoundary(async () => {
      const row = one((await pool.query(ABORT_SQL, [
        input.attemptId, bytes(input.sourceTokenHash), input.requestId,
      ])).rows as QueryResultRow[]);
      return { outcome: outcomeOnly(row, ["ABORTED", "UNKNOWN"]) as "ABORTED" | "UNKNOWN" };
    }),
    readStatus: (input) => statusOperation(READ_STATUS_SQL, [
      "DIRECTORY_BOOTSTRAP_SYNC_PENDING", "READY",
      "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE",
      "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED",
      "ONBOARDING_EXPIRED", "DENIED",
    ] as const, input),
    retrySync: (input) => statusOperation(RETRY_SYNC_SQL, [
      "REQUEUED", "DIRECTORY_BOOTSTRAP_SYNC_PENDING", "READY",
      "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED",
      "ONBOARDING_EXPIRED", "DENIED",
    ] as const, input),
  };
  return Object.freeze(implementation);
}
