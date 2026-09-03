import type { SecretReference } from "../../secrets/core.ts";

export type GoogleWorkspaceDomainKind = "PRIMARY" | "SECONDARY" | "ALIAS";

export interface VerifiedGoogleWorkspaceDomain {
  readonly normalizedDomain: string;
  readonly domainKind: GoogleWorkspaceDomainKind;
  readonly providerParentDomain: string | null;
}

export interface BootstrapPrepareInput {
  readonly attemptId: string;
  readonly sourceTokenHash: Uint8Array;
  readonly candidateWorkspaceId: string;
  readonly statusTokenHash: Uint8Array;
  readonly requestId: string;
}

export interface BootstrapCompleteInput {
  readonly attemptId: string;
  readonly sourceTokenHash: Uint8Array;
  readonly statusTokenHash: Uint8Array;
  readonly customerId: string;
  readonly customerDomain: string;
  readonly providerSubject: string;
  readonly hostedDomain: string;
  readonly verifiedDomains: readonly VerifiedGoogleWorkspaceDomain[];
  readonly credentialReference: SecretReference;
  readonly authorizedScopes: readonly string[];
  readonly requestId: string;
}

export interface BootstrapReconcileInput {
  readonly attemptId: string;
  readonly sourceTokenHash: Uint8Array;
  readonly statusTokenHash: Uint8Array;
  readonly credentialReference: SecretReference;
  readonly requestId: string;
}

export interface BootstrapAbortInput {
  readonly attemptId: string;
  readonly sourceTokenHash: Uint8Array;
  readonly requestId: string;
}

export interface GoogleWorkspaceBootstrapRepository {
  prepare(input: BootstrapPrepareInput): Promise<{ readonly outcome: "PREPARED" | "DENIED" }>;
  complete(input: BootstrapCompleteInput): Promise<
    | { readonly outcome: "PROVISIONING"; readonly statusExpiresAt: Date }
    | { readonly outcome: "DENIED" }
  >;
  reconcile(input: BootstrapReconcileInput): Promise<{
    readonly outcome: "COMMITTED" | "NOT_COMMITTED" | "UNKNOWN";
  }>;
  abort(input: BootstrapAbortInput): Promise<{ readonly outcome: "ABORTED" | "UNKNOWN" }>;
}
