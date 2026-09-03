import type { SecretAdapter, SecretReference } from "../secrets/core.ts";
import {
  requestTransactionContextFromSession,
  type DatabasePool,
  type NormalSessionContext,
  withRequestTransaction,
} from "../db/core.ts";
import { hasExactGoogleDirectoryReadOnlyScopes } from "./google-directory-scopes.ts";
import type { VerifiedGoogleWorkspaceDomain } from "./google-workspace-domains.ts";

export class DirectoryConnectionDeniedError extends Error {
  override readonly name = "DirectoryConnectionDeniedError";
}

export class DirectoryConnectionCommitUnknownError extends Error {
  override readonly name = "DirectoryConnectionCommitUnknownError";
  constructor() {
    super("Directory connection commit outcome is unknown");
  }
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.includes("\0")
  );
}

export interface DirectoryConnectionRepository {
  activate(input: {
    readonly workspaceId: string;
    readonly connectorId: string;
    readonly identityId: string;
    readonly providerCustomerId: string;
    readonly providerSubject: string;
    readonly hostedDomain: string;
    readonly credentialReference: SecretReference;
    readonly authorizedScopes: readonly string[];
    readonly requestId: string;
  }): Promise<
    | {
      readonly outcome: "ACTIVATED";
      readonly previousCredentialReference: SecretReference | null;
    }
    | { readonly outcome: "DENIED" }
  >;
}

const ACTIVATE_DIRECTORY_CONNECTOR_SQL = `
SELECT * FROM uptech.activate_directory_connector_v1(
  $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text[], $7::uuid
)`;

interface ActivationRow {
  readonly outcome?: unknown;
  readonly previous_credential_reference?: unknown;
}

function isSafeSecretReference(value: unknown): value is SecretReference {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 1_024 &&
    !value.includes("\0")
  );
}

/**
 * Binds connector activation to the already-authenticated request context.
 * Workspace, identity, membership, and session authority are revalidated by
 * the existing transaction boundary before the hardened SQL routine runs.
 */
export function createPostgresDirectoryConnectionRepository(
  session: {
    readonly context: NormalSessionContext;
    readonly credentialHash: Uint8Array;
  },
  pool: Pick<DatabasePool, "connect">,
): DirectoryConnectionRepository {
  return Object.freeze({
    async activate(
      input: Parameters<DirectoryConnectionRepository["activate"]>[0],
    ) {
      if (
        input.workspaceId !== session.context.workspaceId ||
        input.identityId !== session.context.identityId
      ) {
        return { outcome: "DENIED" as const };
      }

      try {
        return await withRequestTransaction(
          requestTransactionContextFromSession(
            session.context,
            session.credentialHash,
          ),
          async (client) => {
            const result = await client.query<ActivationRow>(
              ACTIVATE_DIRECTORY_CONNECTOR_SQL,
              [
                input.connectorId,
                input.providerCustomerId,
                input.credentialReference,
                input.providerSubject,
                input.hostedDomain,
                [...input.authorizedScopes],
                input.requestId,
              ],
            );
            if (result.rows.length !== 1) {
              throw new Error("Directory activation returned an invalid result");
            }
            const row = result.rows[0];
            if (
              row.outcome === "DENIED" &&
              (row.previous_credential_reference === null ||
                row.previous_credential_reference === undefined)
            ) {
              return { outcome: "DENIED" as const };
            }
            if (
              row.outcome === "ACTIVATED" &&
              (row.previous_credential_reference === null ||
                isSafeSecretReference(row.previous_credential_reference))
            ) {
              return Object.freeze({
                outcome: "ACTIVATED" as const,
                previousCredentialReference:
                  row.previous_credential_reference ?? null,
              });
            }
            throw new Error("Directory activation returned an invalid result");
          },
          pool,
        );
      } catch {
        throw new DirectoryConnectionCommitUnknownError();
      }
    },
  });
}

export interface ConnectGoogleDirectoryInput {
  readonly setup: {
    readonly workspaceId: string;
    readonly connectorId: string;
    readonly identityId: string;
    readonly role: "OWNER" | "ADMIN" | "MEMBER";
    readonly requestId: string;
    readonly serviceIdentity: string;
  };
  readonly google: {
    readonly customerId: string;
    readonly providerSubject: string;
    readonly hostedDomain: string;
    readonly verifiedDomains: readonly VerifiedGoogleWorkspaceDomain[];
    readonly refreshToken: Uint8Array;
    readonly grantedScopes: readonly string[];
    readonly isAdmin: boolean;
    readonly isDelegatedAdmin: boolean;
    readonly readProbes: {
      readonly customer: boolean;
      readonly users: boolean;
      readonly groups: boolean;
      readonly groupMembers: boolean;
      readonly orgUnits: boolean;
    };
  };
  readonly secretAdapter: SecretAdapter;
  readonly repository: DirectoryConnectionRepository;
  readonly reportOperationalEvent?: (event: {
    readonly event: "DIRECTORY_CONNECTION_COMMIT_UNKNOWN";
    readonly request_id: string;
  }) => void;
}

export async function connectGoogleDirectory(
  input: ConnectGoogleDirectoryInput,
): Promise<{
  readonly kind: "connected";
  readonly workspaceId: string;
  readonly connectorId: string;
  readonly customerId: string;
}> {
  const { setup, google, secretAdapter, repository } = input;
  const setupAuthorized = setup.role === "OWNER" || setup.role === "ADMIN";
  const googleAuthorized = google.isAdmin === true || google.isDelegatedAdmin === true;
  const probesComplete =
    typeof google.readProbes === "object" &&
    google.readProbes !== null &&
    Object.keys(google.readProbes).length === 5 &&
    google.readProbes.customer === true &&
    google.readProbes.users === true &&
    google.readProbes.groups === true &&
    google.readProbes.groupMembers === true &&
    google.readProbes.orgUnits === true;
  const identifiersValid = [
    setup.workspaceId,
    setup.connectorId,
    setup.identityId,
    setup.requestId,
    setup.serviceIdentity,
    google.customerId,
    google.providerSubject,
    google.hostedDomain,
  ].every(isSafeIdentifier);
  const domainEvidenceValid = Array.isArray(google.verifiedDomains) &&
    google.verifiedDomains.some((domain) =>
      domain.verified === true && domain.normalizedDomain === google.hostedDomain
    );

  if (
    !setupAuthorized ||
    !googleAuthorized ||
    !probesComplete ||
    !domainEvidenceValid ||
    !identifiersValid ||
    !(google.refreshToken instanceof Uint8Array) ||
    google.refreshToken.byteLength === 0 ||
    !hasExactGoogleDirectoryReadOnlyScopes(google.grantedScopes)
  ) {
    throw new DirectoryConnectionDeniedError("Directory connection is denied");
  }

  const metadata = Object.freeze({
    workspaceId: setup.workspaceId,
    serviceIdentity: setup.serviceIdentity,
    purpose: "GOOGLE_WORKSPACE_DIRECTORY_REFRESH_TOKEN",
    requestId: setup.requestId,
  });
  const credential = Uint8Array.from(google.refreshToken);
  let credentialReference: SecretReference | undefined;

  try {
    credentialReference = await secretAdapter.create(credential, metadata);
    let activation: Awaited<ReturnType<DirectoryConnectionRepository["activate"]>>;
    try {
      activation = await repository.activate({
        workspaceId: setup.workspaceId,
        connectorId: setup.connectorId,
        identityId: setup.identityId,
        providerCustomerId: google.customerId,
        providerSubject: google.providerSubject,
        hostedDomain: google.hostedDomain,
        credentialReference,
        authorizedScopes: Object.freeze([...google.grantedScopes]),
        requestId: setup.requestId,
      });
    } catch {
      try {
        input.reportOperationalEvent?.({
          event: "DIRECTORY_CONNECTION_COMMIT_UNKNOWN",
          request_id: setup.requestId,
        });
      } catch {
        // Operational reporting must never change the fail-closed outcome.
      }
      throw new DirectoryConnectionDeniedError("Directory connection is denied");
    }

    if (activation.outcome !== "ACTIVATED") {
      try {
        await secretAdapter.destroy(credentialReference, metadata);
      } catch {
        // Keep the outward failure fail-closed and free of provider details.
      }
      throw new DirectoryConnectionDeniedError("Directory connection is denied");
    }

    if (activation.previousCredentialReference === credentialReference) {
      throw new DirectoryConnectionDeniedError("Directory connection is denied");
    }

    if (activation.previousCredentialReference !== null) {
      try {
        await secretAdapter.destroy(
          activation.previousCredentialReference,
          metadata,
        );
      } catch {
        throw new DirectoryConnectionDeniedError("Directory connection is denied");
      }
    }

    return Object.freeze({
      kind: "connected" as const,
      workspaceId: setup.workspaceId,
      connectorId: setup.connectorId,
      customerId: google.customerId,
    });
  } catch (error) {
    if (credentialReference !== undefined) {
      if (!(error instanceof DirectoryConnectionDeniedError) &&
        !(error instanceof DirectoryConnectionCommitUnknownError)) {
        try {
          await secretAdapter.destroy(credentialReference, metadata);
        } catch {
          // Keep the outward failure fail-closed and free of provider details.
        }
      }
    }
    throw new DirectoryConnectionDeniedError("Directory connection is denied");
  } finally {
    credential.fill(0);
  }
}
