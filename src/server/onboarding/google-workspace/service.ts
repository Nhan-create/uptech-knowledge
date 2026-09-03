import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { hashProof, isCanonicalProof } from "../../auth/google/crypto.ts";
import type { SecretAdapter, SecretOperationMetadata } from "../../secrets/core.ts";
import type { GoogleDirectoryConsentEvidence } from "../../people-data/google-directory-consent-provider.ts";
import { hasExactGoogleDirectoryReadOnlyScopes } from "../../people-data/google-directory-scopes.ts";
import {
  openGoogleWorkspaceSetupCookie,
  sealGoogleWorkspaceSetupCookie,
  type SetupCookieKey,
} from "./crypto.ts";
import type { GoogleWorkspaceBootstrapRepository } from "./types.ts";

const REQUIRED_OPERATION = "FIRST_DOMAIN_CLAIM_RESERVE" as const;
const SERVICE_IDENTITY = "GOOGLE_DIRECTORY_BOOTSTRAP_V1";
const SECRET_PURPOSE = "GOOGLE_WORKSPACE_DIRECTORY_REFRESH_TOKEN";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type BootstrapServiceErrorCode =
  | "ONBOARDING_EXPIRED"
  | "CONSENT_ACCOUNT_MISMATCH"
  | "SUPER_ADMIN_REQUIRED"
  | "DELEGATED_ADMIN_UNSUPPORTED"
  | "GOOGLE_ORGANIZATION_MISMATCH"
  | "DOMAIN_NOT_VERIFIED"
  | "DIRECTORY_SCOPE_REQUIRED"
  | "ORGANIZATION_ALREADY_REGISTERED"
  | "PROVIDER_UNAVAILABLE";

export class BootstrapServiceError extends Error {
  override readonly name = "BootstrapServiceError";
  readonly code: BootstrapServiceErrorCode;
  constructor(code: BootstrapServiceErrorCode) {
    super("Google Workspace bootstrap could not be completed");
    this.code = code;
  }
}

export interface GoogleWorkspaceBootstrapIdentity {
  readonly identityId: string;
  readonly providerSubject: string;
  readonly normalizedEmail: string;
  readonly hostedDomain: string;
  readonly identityActive: boolean;
  readonly userActive: boolean;
}

export interface GoogleWorkspaceBootstrapProviderEvidence extends GoogleDirectoryConsentEvidence {
  /** Customer binding returned by users.get for the consenting account. */
  readonly directoryUserCustomerId: string;
  /** True only after users.get proves the account is neither suspended nor archived. */
  readonly directoryUserActive: true;
}

export interface GoogleWorkspaceBootstrapService {
  initiate(input: { readonly onboardingCredential: string; readonly requestId: string }): Promise<{
    readonly authorizationUrl: URL;
    readonly transactionCookie: string;
  }>;
  callback(input: {
    readonly onboardingCredential: string;
    readonly callbackSearch: string;
    readonly transactionCookie: string;
    readonly requestId: string;
  }): Promise<{
    readonly outcome: "PROVISIONING";
    readonly statusCredential: string;
    readonly statusExpiresAt: Date;
  }>;
}

export interface GoogleWorkspaceBootstrapServiceDependencies {
  readonly now: () => Date;
  readonly nextId?: () => string;
  readonly issueCredentialBytes?: () => Uint8Array;
  readonly issueCredential?: () => string;
  readonly cookieKey: SetupCookieKey;
  readonly sourceAuthority: {
    authenticate(input: {
      readonly credentialHash: Uint8Array;
      readonly requiredOperation: typeof REQUIRED_OPERATION;
    }): Promise<GoogleWorkspaceBootstrapIdentity | null>;
  };
  readonly provider: {
    createAuthorization(): Promise<{
      readonly state: string;
      readonly nonce: string;
      readonly pkceVerifier: string;
      readonly authorizationUrl: URL;
    }>;
    exchangeAndProbe(input: {
      readonly callbackSearch: string;
      readonly state: string;
      readonly nonce: string;
      readonly pkceVerifier: string;
    }): Promise<GoogleWorkspaceBootstrapProviderEvidence>;
  };
  readonly repository: GoogleWorkspaceBootstrapRepository;
  readonly secretAdapter: SecretAdapter;
  readonly report?: (record: Readonly<
    | { event: "GOOGLE_WORKSPACE_BOOTSTRAP_RECONCILE"; request_id: string; outcome: "COMMITTED" | "NOT_COMMITTED" | "UNKNOWN" }
    | { event: "GOOGLE_WORKSPACE_BOOTSTRAP_SECRET_ORPHAN"; request_id: string; outcome: "DESTROY_FAILED" }
  >) => void;
}

function denied(code: BootstrapServiceErrorCode): never { throw new BootstrapServiceError(code); }

function requestId(value: string): string {
  if (!UUID_V4.test(value)) return denied("PROVIDER_UNAVAILABLE");
  return value;
}

function hashCredential(value: string): Uint8Array {
  try { return hashProof(value); } catch { return denied("ONBOARDING_EXPIRED"); }
}

function sameHash(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function exactCallbackState(search: string): string | null {
  if (typeof search !== "string" || search.length < 1 || search.length > 4_096 || !search.startsWith("?")) return null;
  const parameters = new URLSearchParams(search.slice(1));
  const states = parameters.getAll("state");
  const codes = parameters.getAll("code");
  return states.length === 1 && isCanonicalProof(states[0]) && codes.length === 1 && codes[0]!.length > 0 && codes[0]!.length <= 4_096 && parameters.getAll("error").length === 0
    ? states[0]! : null;
}

function activeIdentity(identity: GoogleWorkspaceBootstrapIdentity | null): GoogleWorkspaceBootstrapIdentity {
  if (identity === null || identity.identityActive !== true || identity.userActive !== true) return denied("ONBOARDING_EXPIRED");
  return identity;
}

function matchingIdentity(identity: GoogleWorkspaceBootstrapIdentity, transaction: ReturnType<typeof openGoogleWorkspaceSetupCookie>): void {
  if (transaction === null || identity.identityId !== transaction.identityId || identity.providerSubject !== transaction.providerSubject ||
      identity.normalizedEmail !== transaction.normalizedEmail || identity.hostedDomain !== transaction.hostedDomain) {
    return denied("CONSENT_ACCOUNT_MISMATCH");
  }
}

function validateEvidence(evidence: GoogleWorkspaceBootstrapProviderEvidence, transaction: NonNullable<ReturnType<typeof openGoogleWorkspaceSetupCookie>>): void {
  if (typeof evidence !== "object" || evidence === null) return denied("PROVIDER_UNAVAILABLE");
  if (evidence.providerSubject !== transaction.providerSubject || evidence.normalizedEmail !== transaction.normalizedEmail || evidence.hostedDomain !== transaction.hostedDomain) {
    return denied("CONSENT_ACCOUNT_MISMATCH");
  }
  if (evidence.isAdmin !== true) {
    return denied(evidence.isDelegatedAdmin === true ? "DELEGATED_ADMIN_UNSUPPORTED" : "SUPER_ADMIN_REQUIRED");
  }
  if (evidence.directoryUserActive !== true || typeof evidence.customerId !== "string" || evidence.customerId.length === 0 || evidence.directoryUserCustomerId !== evidence.customerId) {
    return denied("GOOGLE_ORGANIZATION_MISMATCH");
  }
  if (!Array.isArray(evidence.verifiedDomains)) return denied("DOMAIN_NOT_VERIFIED");
  if (!evidence.verifiedDomains.some((domain) =>
    domain.verified === true && domain.normalizedDomain === transaction.hostedDomain &&
    (domain.kind === "PRIMARY" || domain.kind === "SECONDARY" || domain.kind === "ALIAS"))) {
    return denied("DOMAIN_NOT_VERIFIED");
  }
  const primaryDomains = evidence.verifiedDomains.filter((domain) => domain.verified === true && domain.kind === "PRIMARY");
  if (primaryDomains.length !== 1 || primaryDomains[0]!.normalizedDomain !== evidence.primaryDomain) {
    return denied("GOOGLE_ORGANIZATION_MISMATCH");
  }
  if (!hasExactGoogleDirectoryReadOnlyScopes(evidence.grantedScopes)) return denied("DIRECTORY_SCOPE_REQUIRED");
  const probes = evidence.readProbes;
  if (typeof probes !== "object" || probes === null || Object.keys(probes).length !== 5 ||
      probes.customer !== true || probes.users !== true || probes.groups !== true || probes.groupMembers !== true || probes.orgUnits !== true ||
      !(evidence.refreshToken instanceof Uint8Array) || evidence.refreshToken.byteLength === 0) {
    return denied("PROVIDER_UNAVAILABLE");
  }
}

function newStatusCredential(dependencies: GoogleWorkspaceBootstrapServiceDependencies): { raw: Uint8Array; credential: string } {
  if (dependencies.issueCredential !== undefined) {
    const credential = dependencies.issueCredential();
    if (!isCanonicalProof(credential)) return denied("PROVIDER_UNAVAILABLE");
    return { raw: Uint8Array.from(Buffer.from(credential, "base64url")), credential };
  }
  const raw = dependencies.issueCredentialBytes?.() ?? randomBytes(32);
  if (!(raw instanceof Uint8Array) || raw.byteLength !== 32) return denied("PROVIDER_UNAVAILABLE");
  return { raw, credential: Buffer.from(raw).toString("base64url") };
}

export function createGoogleWorkspaceBootstrapService(dependencies: GoogleWorkspaceBootstrapServiceDependencies): GoogleWorkspaceBootstrapService {
  const nextId = dependencies.nextId ?? randomUUID;
  return Object.freeze({
    async initiate(input: Parameters<GoogleWorkspaceBootstrapService["initiate"]>[0]) {
      const sourceTokenHash = hashCredential(input.onboardingCredential);
      requestId(input.requestId);
      let identity: GoogleWorkspaceBootstrapIdentity;
      try {
        identity = activeIdentity(await dependencies.sourceAuthority.authenticate({ credentialHash: sourceTokenHash, requiredOperation: REQUIRED_OPERATION }));
      } catch (error) {
        if (error instanceof BootstrapServiceError) throw error;
        return denied("ONBOARDING_EXPIRED");
      }
      try {
        const authorization = await dependencies.provider.createAuthorization();
        const attemptId = nextId();
        const candidateWorkspaceId = nextId();
        if (!UUID_V4.test(attemptId) || !UUID_V4.test(candidateWorkspaceId) || attemptId === candidateWorkspaceId) return denied("PROVIDER_UNAVAILABLE");
        const transactionCookie = sealGoogleWorkspaceSetupCookie(Object.freeze({
          attemptId, candidateWorkspaceId, identityId: identity.identityId,
          providerSubject: identity.providerSubject, normalizedEmail: identity.normalizedEmail,
          hostedDomain: identity.hostedDomain, state: authorization.state, nonce: authorization.nonce,
          pkceVerifier: authorization.pkceVerifier, expiresAt: new Date(dependencies.now().getTime() + 10 * 60 * 1_000),
        }), dependencies.cookieKey);
        return Object.freeze({ authorizationUrl: new URL(authorization.authorizationUrl), transactionCookie });
      } catch (error) {
        if (error instanceof BootstrapServiceError) throw error;
        return denied("PROVIDER_UNAVAILABLE");
      }
    },

    async callback(input: Parameters<GoogleWorkspaceBootstrapService["callback"]>[0]) {
      requestId(input.requestId);
      const now = dependencies.now();
      const transaction = openGoogleWorkspaceSetupCookie(input.transactionCookie, { ...dependencies.cookieKey, now });
      const callbackState = exactCallbackState(input.callbackSearch);
      if (transaction === null || callbackState !== transaction.state) return denied("CONSENT_ACCOUNT_MISMATCH");
      const sourceTokenHash = hashCredential(input.onboardingCredential);
      let identity: GoogleWorkspaceBootstrapIdentity;
      try {
        identity = activeIdentity(await dependencies.sourceAuthority.authenticate({ credentialHash: sourceTokenHash, requiredOperation: REQUIRED_OPERATION }));
      } catch (error) {
        if (error instanceof BootstrapServiceError) throw error;
        return denied("ONBOARDING_EXPIRED");
      }
      matchingIdentity(identity, transaction);

      let evidence: GoogleWorkspaceBootstrapProviderEvidence | undefined;
      let statusRaw: Uint8Array | undefined;
      try {
        try {
          evidence = await dependencies.provider.exchangeAndProbe({ callbackSearch: input.callbackSearch, state: transaction.state, nonce: transaction.nonce, pkceVerifier: transaction.pkceVerifier });
        } catch { return denied("PROVIDER_UNAVAILABLE"); }
        try { validateEvidence(evidence, transaction); }
        catch (error) {
          if (error instanceof BootstrapServiceError) throw error;
          return denied("PROVIDER_UNAVAILABLE");
        }

        const status = newStatusCredential(dependencies);
        statusRaw = status.raw;
        const statusTokenHash = hashCredential(status.credential);
        if (status.credential === input.onboardingCredential || sameHash(statusTokenHash, sourceTokenHash)) return denied("PROVIDER_UNAVAILABLE");
        const prepareInput = Object.freeze({
          attemptId: transaction.attemptId, sourceTokenHash,
          candidateWorkspaceId: transaction.candidateWorkspaceId,
          statusTokenHash, requestId: input.requestId,
        });
        let prepared: unknown;
        try { prepared = await dependencies.repository.prepare(prepareInput); }
        catch { prepared = undefined; }
        const determinate = (value: unknown): value is { readonly outcome: "PREPARED" | "DENIED" } =>
          typeof value === "object" && value !== null && Object.keys(value).length === 1 &&
          ((value as { outcome?: unknown }).outcome === "PREPARED" || (value as { outcome?: unknown }).outcome === "DENIED");
        if (!determinate(prepared)) {
          try { prepared = await dependencies.repository.prepare(prepareInput); }
          catch { return denied("PROVIDER_UNAVAILABLE"); }
        }
        if (!determinate(prepared)) return denied("PROVIDER_UNAVAILABLE");
        if (prepared.outcome !== "PREPARED") return denied("ORGANIZATION_ALREADY_REGISTERED");

        const metadata: SecretOperationMetadata = {
          workspaceId: transaction.candidateWorkspaceId,
          serviceIdentity: SERVICE_IDENTITY,
          purpose: SECRET_PURPOSE,
          requestId: input.requestId,
          bootstrapAttemptId: transaction.attemptId,
        };
        let reference;
        try {
          reference = await dependencies.secretAdapter.create(evidence.refreshToken, metadata);
        } catch {
          try { await dependencies.repository.abort({ attemptId: transaction.attemptId, sourceTokenHash, requestId: input.requestId }); } catch { /* non-authoritative attempt expires */ }
          return denied("PROVIDER_UNAVAILABLE");
        }

        const completeInput = {
          attemptId: transaction.attemptId, sourceTokenHash, statusTokenHash,
          customerId: evidence.customerId, customerDomain: evidence.primaryDomain,
          providerSubject: evidence.providerSubject, hostedDomain: evidence.hostedDomain,
          verifiedDomains: evidence.verifiedDomains.map((domain) => ({ normalizedDomain: domain.normalizedDomain, domainKind: domain.kind, providerParentDomain: domain.providerParentDomain })),
          credentialReference: reference, authorizedScopes: evidence.grantedScopes, requestId: input.requestId,
        } as const;
        try {
          const completion = await dependencies.repository.complete(completeInput);
          if (completion.outcome === "PROVISIONING") {
            return Object.freeze({ outcome: "PROVISIONING" as const, statusCredential: status.credential, statusExpiresAt: new Date(completion.statusExpiresAt.getTime()) });
          }
        } catch { /* reconcile every ambiguous completion */ }

        let outcome: "COMMITTED" | "NOT_COMMITTED" | "UNKNOWN" = "UNKNOWN";
        try {
          outcome = (await dependencies.repository.reconcile({ attemptId: transaction.attemptId, sourceTokenHash, statusTokenHash, credentialReference: reference, requestId: input.requestId })).outcome;
        } catch { outcome = "UNKNOWN"; }
        try { dependencies.report?.({ event: "GOOGLE_WORKSPACE_BOOTSTRAP_RECONCILE", request_id: input.requestId, outcome }); } catch { /* reporting never changes authority */ }
        if (outcome === "NOT_COMMITTED") {
          try { await dependencies.secretAdapter.destroy(reference, metadata); }
          catch {
            try { dependencies.report?.({ event: "GOOGLE_WORKSPACE_BOOTSTRAP_SECRET_ORPHAN", request_id: input.requestId, outcome: "DESTROY_FAILED" }); } catch { /* reporting never changes authority */ }
            return denied("PROVIDER_UNAVAILABLE");
          }
        }
        return denied("PROVIDER_UNAVAILABLE");
      } finally {
        if (evidence?.refreshToken instanceof Uint8Array) evidence.refreshToken.fill(0);
        statusRaw?.fill(0);
      }
    },
  });
}
