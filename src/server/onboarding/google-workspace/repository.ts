import type { QueryResultRow } from "pg";

import type { DatabasePool } from "../../db/core.ts";
import type {
  BootstrapCompleteInput,
  BootstrapFinishOutcome,
  BootstrapReissueStatusInput,
  BootstrapReissueStatusResult,
  BootstrapRevokeOutcome,
  BootstrapRetryOutcome,
  BootstrapStatusOutcome,
  WorkspaceAccessRequestReadResult,
  WorkspaceAccessRequestSubmitResult,
  GoogleWorkspaceBootstrapRepository,
  VerifiedGoogleWorkspaceDomain,
} from "./types.ts";

export type {
  BootstrapAbortInput,
  BootstrapCompleteInput,
  BootstrapFinishOutcome,
  BootstrapPrepareInput,
  BootstrapReconcileInput,
  BootstrapReissueStatusInput,
  BootstrapReissueStatusResult,
  BootstrapRevokeOutcome,
  BootstrapRetryOutcome,
  BootstrapStatusInput,
  BootstrapStatusOutcome,
  WorkspaceAccessRequestReadResult,
  WorkspaceAccessRequestSubmitResult,
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

const FINISH_SQL = `SELECT result.outcome::text AS outcome
FROM uptech.finish_google_workspace_bootstrap_v1(
  $1::uptech.google_auth_hash32_v1,$2::uuid
) AS result`;

const REISSUE_STATUS_SQL = `SELECT result.outcome::text AS outcome,result.status_expires_at
FROM uptech.reissue_google_workspace_bootstrap_status_v1(
  $1::uptech.google_auth_hash32_v1,
  ROW(
    $2::uptech.google_auth_issuer_v1,$3::uptech.google_provider_subject_v1,
    $4::uptech.google_normalized_email_v1,$5::boolean,
    $6::uptech.google_normalized_domain_v1,$7::timestamptz,$8::timestamptz,
    $9::uptech.google_auth_configuration_key_v1,
    $10::uptech.google_auth_configuration_key_v1,
    $11::uptech.google_auth_hash32_v1
  )::uptech.google_verified_claims_assertion_v1,
  $12::uptech.google_auth_hash32_v1,$13::uuid
) AS result`;

const REVOKE_CAPABILITY_SQL = `SELECT result.outcome::text AS outcome
FROM uptech.revoke_onboarding_capability_v1(
  $1::uptech.google_auth_hash32_v1,$2::uuid
) AS result`;

const SUBMIT_ACCESS_REQUEST_SQL = `SELECT result.outcome::text AS outcome,
  result.request_id::text AS request_id,result.status::text AS status
FROM uptech.submit_workspace_access_request_v1(
  $1::uptech.google_auth_hash32_v1,$2::uuid
) AS result`;

const READ_ACCESS_REQUEST_SQL = `SELECT result.outcome::text AS outcome,
  result.request_id::text AS request_id,result.status::text AS status
FROM uptech.read_workspace_access_request_v1(
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
  const statusOperation = <T extends string>(
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
  const accessRequestOperation = <T extends "PENDING" | "FOUND">(
    sql: string,
    expectedSuccess: T,
    input: import("./types.ts").BootstrapStatusInput,
  ) => unknownBoundary(async (): Promise<
    T extends "PENDING" ? WorkspaceAccessRequestSubmitResult : WorkspaceAccessRequestReadResult
  > => {
    if (!(input.statusTokenHash instanceof Uint8Array) || input.statusTokenHash.byteLength !== 32 ||
        !CANONICAL_UUID.test(input.requestId)) {
      throw new BootstrapCommitUnknownError();
    }
    const row = one((await pool.query(sql, [bytes(input.statusTokenHash), input.requestId])).rows as QueryResultRow[]);
    if (Object.keys(row).length !== 3) throw new BootstrapCommitUnknownError();
    if (row.outcome === "DENIED" && row.request_id === null && row.status === null) {
      return { outcome: "DENIED" } as (T extends "PENDING"
        ? WorkspaceAccessRequestSubmitResult : WorkspaceAccessRequestReadResult);
    }
    if (row.outcome !== expectedSuccess || typeof row.request_id !== "string" ||
        !CANONICAL_UUID.test(row.request_id) ||
        !["PENDING", "FULFILLED", "CANCELLED"].includes(String(row.status)) ||
        (expectedSuccess === "PENDING" && row.status !== "PENDING")) {
      throw new BootstrapCommitUnknownError();
    }
    return { outcome: expectedSuccess, requestId: row.request_id, status: row.status } as
      (T extends "PENDING" ? WorkspaceAccessRequestSubmitResult : WorkspaceAccessRequestReadResult);
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
    finish: (input) => statusOperation(FINISH_SQL, ["FINISHED", "DENIED"] as const, input),
    reissueStatus: (input: BootstrapReissueStatusInput) => unknownBoundary(async (): Promise<BootstrapReissueStatusResult> => {
      if (!(input.reservedCompletionHash instanceof Uint8Array) || input.reservedCompletionHash.byteLength !== 32 ||
          !(input.newStatusTokenHash instanceof Uint8Array) || input.newStatusTokenHash.byteLength !== 32 ||
          !(input.claims.nonceHash instanceof Uint8Array) || input.claims.nonceHash.byteLength !== 32 ||
          !CANONICAL_UUID.test(input.requestId)) {
        throw new BootstrapCommitUnknownError();
      }
      const claims = input.claims;
      const row = one((await pool.query(REISSUE_STATUS_SQL, [
        bytes(input.reservedCompletionHash), claims.issuer, claims.providerSubject,
        claims.normalizedEmail, claims.emailVerified, claims.hostedDomain,
        new Date(claims.issuedAtEpochSeconds * 1000), new Date(claims.expiresAtEpochSeconds * 1000),
        claims.audienceConfigurationKey, claims.authorizedPartyConfigurationKey,
        bytes(claims.nonceHash), bytes(input.newStatusTokenHash), input.requestId,
      ])).rows as QueryResultRow[]);
      if (row.outcome === "DENIED" && row.status_expires_at === null && Object.keys(row).length === 2) {
        return { outcome: "DENIED" };
      }
      if (row.outcome !== "REISSUED" || Object.keys(row).length !== 2 ||
          !(row.status_expires_at instanceof Date) || !Number.isFinite(row.status_expires_at.getTime())) {
        throw new BootstrapCommitUnknownError();
      }
      return { outcome: "REISSUED", statusExpiresAt: new Date(row.status_expires_at.getTime()) };
    }),
    revokeCapability: (input) => statusOperation(REVOKE_CAPABILITY_SQL, ["REVOKED", "DENIED"] as const, input),
    submitAccessRequest: (input) => accessRequestOperation(SUBMIT_ACCESS_REQUEST_SQL, "PENDING", input),
    readAccessRequest: (input) => accessRequestOperation(READ_ACCESS_REQUEST_SQL, "FOUND", input),
  };
  return Object.freeze(implementation);
}
