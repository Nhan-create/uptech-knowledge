import type { LeasedJob } from "../jobs/core.ts";
import type { SecretReference } from "../secrets/core.ts";

export class DirectoryCredentialReferenceError extends Error {
  override readonly name = "DirectoryCredentialReferenceError";
}

export interface DirectoryCredentialDatabaseClient {
  query(text: string, values: readonly unknown[]): Promise<unknown>;
}

const RESOLVE_DIRECTORY_CREDENTIAL_REFERENCE_SQL =
  "SELECT * FROM uptech.resolve_directory_connector_credential_reference_v1()";

function requireDirectoryLease(lease: LeasedJob): void {
  if (lease.jobKind !== "DIRECTORY_SYNC" || lease.sourceId !== null) {
    throw new DirectoryCredentialReferenceError(
      "Directory credential resolution requires a DIRECTORY_SYNC lease",
    );
  }
}

/**
 * Reads an opaque connector credential reference through the worker-only SQL
 * routine. Authorization remains entirely in the current transaction's lease
 * context; this function never reads connectors directly or receives a
 * caller-selected workspace or connector identifier.
 */
export async function resolveDirectoryCredentialReference(
  client: DirectoryCredentialDatabaseClient,
  lease: LeasedJob,
): Promise<SecretReference> {
  requireDirectoryLease(lease);
  let result: unknown;
  try {
    result = await client.query(RESOLVE_DIRECTORY_CREDENTIAL_REFERENCE_SQL, []);
  } catch {
    throw new DirectoryCredentialReferenceError(
      "Directory credential reference is unavailable",
    );
  }
  if (
    typeof result !== "object" ||
    result === null ||
    !Array.isArray((result as { rows?: unknown }).rows) ||
    (result as { rows: unknown[] }).rows.length !== 1
  ) {
    throw new DirectoryCredentialReferenceError(
      "Directory credential reference is unavailable",
    );
  }
  const row = (result as { rows: unknown[] }).rows[0];
  const reference = typeof row === "object" && row !== null
    ? (row as { credential_reference?: unknown }).credential_reference
    : undefined;
  if (
    typeof reference !== "string" ||
    reference.trim().length === 0 ||
    reference.length > 1_024 ||
    reference.includes("\0")
  ) {
    throw new DirectoryCredentialReferenceError(
      "Directory credential reference is unavailable",
    );
  }
  return reference as SecretReference;
}
