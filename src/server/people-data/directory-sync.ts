import type { LeasedJob } from "../jobs/core";
import type {
  DirectoryTraversal,
  GoogleDirectoryTransport,
} from "./google-directory-transport";

export class DirectorySyncError extends Error {
  override readonly name = "DirectorySyncError";
}

/** The small database surface used by the Directory worker. */
export interface DirectorySyncDatabaseClient {
  query(text: string, values: readonly unknown[]): Promise<unknown>;
}

export interface DirectorySyncInput {
  readonly client: DirectorySyncDatabaseClient;
  readonly lease: LeasedJob;
  readonly transport: GoogleDirectoryTransport;
  readonly generationId: string;
  readonly requestId: string;
}

export interface PublishedDirectorySync {
  readonly kind: "published";
  readonly workspaceId: string;
  readonly generationId: string;
}

export interface DirectorySyncJobHandlerDependencies {
  readonly transportForLease: (lease: LeasedJob) => GoogleDirectoryTransport;
  /** Generates UUIDv4 values owned by the worker runtime. */
  readonly nextId: () => string;
}

export interface DirectorySyncWorkerContext {
  readonly client: DirectorySyncDatabaseClient;
  readonly lease: LeasedJob;
}

const BEGIN_GENERATION_SQL =
  "SELECT * FROM uptech.begin_people_sync_generation_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid)";
/**
 * Directory snapshot SQL contract. These routines stage source facts only:
 * admin flags are metadata and must never assign an application role here.
 */
const STAGE_CUSTOMER_SQL =
  "SELECT * FROM uptech.stage_people_directory_customer_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text)";
const STAGE_ORG_UNIT_SQL =
  "SELECT * FROM uptech.stage_people_org_unit_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text)";
const STAGE_PROFILE_SQL =
  "SELECT * FROM uptech.stage_people_profile_v2($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::boolean,$11::boolean)";
const STAGE_GROUP_SQL =
  "SELECT * FROM uptech.stage_people_group_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text)";
const STAGE_DIRECT_MEMBER_SQL =
  "SELECT * FROM uptech.stage_people_group_membership_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text)";
const PUBLISH_GENERATION_SQL =
  "SELECT * FROM uptech.publish_people_sync_generation_v1($1::uuid,$2::uuid,$3::uuid,$4::boolean,$5::timestamptz,$6::uuid)";

interface RoutineOutcomeRow {
  readonly outcome?: unknown;
  readonly connector_id?: unknown;
}

function requireRoutineOutcome(
  routine: string,
  result: unknown,
  expected: string,
): RoutineOutcomeRow {
  if (
    typeof result !== "object" ||
    result === null ||
    !Array.isArray((result as { rows?: unknown }).rows) ||
    (result as { rows: unknown[] }).rows.length !== 1
  ) {
    throw new DirectorySyncError(`${routine} returned an invalid result`);
  }
  const row = (result as { rows: unknown[] }).rows[0];
  if (
    typeof row !== "object" ||
    row === null ||
    (row as RoutineOutcomeRow).outcome !== expected
  ) {
    const outcome =
      typeof row === "object" && row !== null
        ? (row as RoutineOutcomeRow).outcome
        : undefined;
    throw new DirectorySyncError(`${routine} returned ${String(outcome)}`);
  }

  return row as RoutineOutcomeRow;
}

function requireNonEmpty(label: string, value: string): string {
  if (value.trim().length === 0 || value.includes("\0")) {
    throw new DirectorySyncError(`${label} is invalid`);
  }

  return value;
}

function requireFreshTraversal<T>(
  label: string,
  traversal: DirectoryTraversal<T>,
): DirectoryTraversal<T> {
  if (!traversal.traversalComplete) {
    throw new DirectorySyncError(`${label} did not complete traversal`);
  }
  if (
    !(traversal.freshUntil instanceof Date) ||
    !Number.isFinite(traversal.freshUntil.getTime()) ||
    traversal.freshUntil.getTime() <= Date.now()
  ) {
    throw new DirectorySyncError(`${label} returned stale source data`);
  }

  return traversal;
}

function earliestFreshUntil(
  current: Date,
  candidate: Date,
): Date {
  return candidate.getTime() < current.getTime() ? candidate : current;
}

/**
 * Stages one complete, direct-membership Directory snapshot. The caller must
 * run this inside the worker transaction tied to the `sync_jobs` lease, so an
 * incomplete or failing traversal rolls the entire generation back.
 */
export async function runDirectorySync(
  input: DirectorySyncInput,
): Promise<PublishedDirectorySync> {
  const { client, lease, transport, generationId, requestId } = input;
  if (lease.jobKind !== "DIRECTORY_SYNC" || lease.sourceId !== null) {
    throw new DirectorySyncError("Directory sync requires a DIRECTORY_SYNC lease");
  }

  const workspaceId = requireNonEmpty("workspaceId", lease.workspaceId);
  const fence = requireNonEmpty("leaseFence", lease.leaseFence);
  requireNonEmpty("generationId", generationId);
  requireNonEmpty("requestId", requestId);

  const started = requireRoutineOutcome(
    "begin_people_sync_generation_v1",
    await client.query(BEGIN_GENERATION_SQL, [
    workspaceId,
    generationId,
    fence,
    requestId,
    ]),
    "STARTED",
  );
  if (started.connector_id !== lease.connectorId) {
    throw new DirectorySyncError("begin_people_sync_generation_v1 returned the wrong connector");
  }

  const customer = await transport.getCustomer();
  requireRoutineOutcome(
    "stage_people_directory_customer_v1",
    await client.query(STAGE_CUSTOMER_SQL, [
      workspaceId,
      generationId,
      fence,
      requireNonEmpty("googleCustomerId", customer.googleCustomerId),
      requireNonEmpty("primaryDomain", customer.primaryDomain),
    ]),
    "STAGED",
  );

  const orgUnits = requireFreshTraversal(
    "Google organizational units",
    await transport.listOrgUnits(),
  );
  for (const orgUnit of orgUnits.items) {
    requireRoutineOutcome("stage_people_org_unit_v1", await client.query(STAGE_ORG_UNIT_SQL, [
      workspaceId,
      generationId,
      fence,
      requireNonEmpty("googleOrgUnitId", orgUnit.googleOrgUnitId),
      requireNonEmpty("orgUnitPath", orgUnit.orgUnitPath),
      orgUnit.parentGoogleOrgUnitId === null
        ? null
        : requireNonEmpty("parentGoogleOrgUnitId", orgUnit.parentGoogleOrgUnitId),
    ]), "STAGED");
  }

  const users = requireFreshTraversal("Google users", await transport.listUsers());
  const tenantUserSubjects = new Set<string>();
  for (const user of users.items) {
    const googleSubject = requireNonEmpty("googleSubject", user.googleSubject);
    tenantUserSubjects.add(googleSubject);
    requireRoutineOutcome("stage_people_profile_v2", await client.query(STAGE_PROFILE_SQL, [
      workspaceId,
      generationId,
      fence,
      googleSubject,
      requireNonEmpty("fullName", user.fullName),
      requireNonEmpty("primaryEmail", user.primaryEmail),
      user.department === null ? "" : user.department,
      user.lifecycleState,
      requireNonEmpty("orgUnitPath", user.orgUnitPath),
      user.isAdmin,
      user.isDelegatedAdmin,
    ]), "STAGED");
  }

  const groups = requireFreshTraversal("Google groups", await transport.listGroups());
  let freshUntil = earliestFreshUntil(
    earliestFreshUntil(orgUnits.freshUntil, users.freshUntil),
    groups.freshUntil,
  );
  for (const group of groups.items) {
    const googleGroupId = requireNonEmpty("googleGroupId", group.googleGroupId);
    requireRoutineOutcome("stage_people_group_v1", await client.query(STAGE_GROUP_SQL, [
      workspaceId,
      generationId,
      fence,
      googleGroupId,
      requireNonEmpty("groupName", group.groupName),
    ]), "STAGED");

    const members = requireFreshTraversal(
      `Google direct members for ${googleGroupId}`,
      await transport.listDirectMembers(googleGroupId),
    );
    freshUntil = earliestFreshUntil(freshUntil, members.freshUntil);
    for (const member of members.items) {
      const googleSubject = requireNonEmpty(
        "googleSubject",
        member.googleSubject,
      );
      // Google groups may contain external users. Only subjects from the
      // complete tenant users traversal can become tenant permission edges.
      if (!tenantUserSubjects.has(googleSubject)) continue;
      requireRoutineOutcome("stage_people_group_membership_v1", await client.query(STAGE_DIRECT_MEMBER_SQL, [
        workspaceId,
        generationId,
        fence,
        googleGroupId,
        googleSubject,
      ]), "STAGED");
    }
  }

  requireRoutineOutcome("publish_people_sync_generation_v1", await client.query(PUBLISH_GENERATION_SQL, [
    workspaceId,
    generationId,
    fence,
    true,
    freshUntil,
    requestId,
  ]), "PUBLISHED");

  return Object.freeze({
    kind: "published" as const,
    workspaceId,
    generationId,
  });
}

/**
 * Adapter for `createWorkerBoundary().runNext(...)`. IDs are generated at the
 * worker boundary; tenant, connector, and fence remain derived from the lease.
 */
export function createDirectorySyncJobHandler(
  dependencies: DirectorySyncJobHandlerDependencies,
): (context: DirectorySyncWorkerContext) => Promise<PublishedDirectorySync> {
  return (context) =>
    runDirectorySync({
      client: context.client,
      lease: context.lease,
      transport: dependencies.transportForLease(context.lease),
      generationId: dependencies.nextId(),
      requestId: dependencies.nextId(),
    });
}
