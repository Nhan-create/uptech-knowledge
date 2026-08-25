import type { Pool, QueryResultRow } from "pg";

export class JobLeaseBoundaryError extends Error {
  override readonly name = "JobLeaseBoundaryError";
}

export type SyncJobKind =
  | "DIRECTORY_SYNC"
  | "DRIVE_SYNC"
  | "DRIVE_CHANGES"
  | "DRIVE_RECONCILE";

export interface LeasedJob {
  readonly jobId: string;
  readonly jobKind: SyncJobKind;
  readonly workspaceId: string;
  readonly serviceActor: string;
  readonly connectorId: string;
  readonly sourceId: string | null;
  readonly leaseFence: string;
  readonly leaseExpiresAt: Date;
}

interface LeaseNextJobRow extends QueryResultRow {
  readonly job_id: unknown;
  readonly job_kind: unknown;
  readonly workspace_id: unknown;
  readonly service_actor_id: unknown;
  readonly connector_id: unknown;
  readonly source_id: unknown;
  readonly lease_fence: unknown;
  readonly lease_expires_at: unknown;
}

const LEASE_NEXT_JOB_SQL = "SELECT * FROM uptech.lease_next_job()";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function requireLeaseString(label: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new JobLeaseBoundaryError(
      `lease_next_job returned an invalid ${label}`,
    );
  }

  return value;
}

function requireJobKind(value: unknown): SyncJobKind {
  if (
    value === "DIRECTORY_SYNC" ||
    value === "DRIVE_SYNC" ||
    value === "DRIVE_CHANGES" ||
    value === "DRIVE_RECONCILE"
  ) {
    return value;
  }

  throw new JobLeaseBoundaryError(
    "lease_next_job returned an invalid job_kind",
  );
}

function requireLeaseFence(value: unknown): string {
  if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
    throw new JobLeaseBoundaryError(
      "lease_next_job returned an invalid lease_fence",
    );
  }

  return value;
}

function requireLeaseExpiry(value: unknown): Date {
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime()) ||
    value.getTime() <= Date.now()
  ) {
    throw new JobLeaseBoundaryError(
      "lease_next_job returned an invalid lease_expires_at",
    );
  }

  return new Date(value.getTime());
}

export async function leaseNextJobFromPool(
  pool: Pick<Pool, "query">,
): Promise<LeasedJob | null> {
  const result = await pool.query<LeaseNextJobRow>(LEASE_NEXT_JOB_SQL);

  if (result.rows.length === 0) {
    return null;
  }

  if (result.rows.length !== 1) {
    throw new JobLeaseBoundaryError(
      "lease_next_job returned a non-scalar result",
    );
  }

  const row = result.rows[0];
  if (
    row.source_id !== null &&
    (typeof row.source_id !== "string" || row.source_id.length === 0)
  ) {
    throw new JobLeaseBoundaryError(
      "lease_next_job returned an invalid source_id",
    );
  }

  const jobKind = requireJobKind(row.job_kind);
  if (
    (jobKind === "DIRECTORY_SYNC" && row.source_id !== null) ||
    (jobKind !== "DIRECTORY_SYNC" && row.source_id === null)
  ) {
    throw new JobLeaseBoundaryError(
      "lease_next_job returned an inconsistent job_kind/source_id",
    );
  }

  return Object.freeze({
    jobId: requireLeaseString("job_id", row.job_id),
    jobKind,
    workspaceId: requireLeaseString("workspace_id", row.workspace_id),
    serviceActor: requireLeaseString(
      "service_actor_id",
      row.service_actor_id,
    ),
    connectorId: requireLeaseString("connector_id", row.connector_id),
    sourceId: row.source_id,
    leaseFence: requireLeaseFence(row.lease_fence),
    leaseExpiresAt: requireLeaseExpiry(row.lease_expires_at),
  });
}
