import type { AuthenticatedWebSession } from "../auth/web-session.ts";
import type { ServerVerifiedGoogleDirectoryGrant } from "./directory-production.ts";
import type { DirectoryConsentCookiePayload } from "./directory-consent-crypto.ts";

export class DirectoryConsentDeniedError extends Error {
  override readonly name = "DirectoryConsentDeniedError";
}

export interface PreparedDirectoryConsent {
  readonly connectorId: string;
  readonly providerSubject: string;
  readonly normalizedEmail: string;
  readonly hostedDomain: string;
}

export interface DirectoryConsentProviderGrant {
  readonly providerSubject: string;
  readonly normalizedEmail: string;
  readonly hostedDomain: string;
  readonly customerId: string;
  readonly primaryDomain: string;
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
}

interface DirectoryConsentDependencies {
  readonly now: () => Date;
  readonly consentCookie: {
    seal(value: DirectoryConsentCookiePayload): string;
    open(value: string): DirectoryConsentCookiePayload | null;
  };
  readonly repository: {
    prepare(input: {
      readonly session: AuthenticatedWebSession;
      readonly requestId: string;
    }): Promise<PreparedDirectoryConsent>;
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
    }): Promise<DirectoryConsentProviderGrant>;
  };
  readonly sealGrant: (
    value: DirectoryConsentProviderGrant,
  ) => ServerVerifiedGoogleDirectoryGrant;
  readonly connection: {
    connect(input: {
      readonly session: AuthenticatedWebSession;
      readonly connectorId: string;
      readonly providerGrant: ServerVerifiedGoogleDirectoryGrant;
    }): Promise<unknown>;
  };
}

function requestId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new DirectoryConsentDeniedError("Directory consent is denied");
  }
  return value;
}

function callbackState(search: string): string | null {
  if (search.length < 1 || search.length > 4_096 || !search.startsWith("?")) {
    return null;
  }
  const parameters = new URLSearchParams(search.slice(1));
  const states = parameters.getAll("state");
  const codes = parameters.getAll("code");
  return states.length === 1 && codes.length === 1 &&
      states[0]?.length === 43 && codes[0]!.length > 0 &&
      codes[0]!.length <= 4_096 && parameters.getAll("error").length === 0
    ? states[0]!
    : null;
}

function eligibleGrant(grant: DirectoryConsentProviderGrant): boolean {
  return (
    (grant.isAdmin === true || grant.isDelegatedAdmin === true) &&
    typeof grant.readProbes === "object" &&
    grant.readProbes !== null &&
    Object.keys(grant.readProbes).length === 5 &&
    grant.readProbes.customer === true &&
    grant.readProbes.users === true &&
    grant.readProbes.groups === true &&
    grant.readProbes.groupMembers === true &&
    grant.readProbes.orgUnits === true &&
    grant.refreshToken instanceof Uint8Array &&
    grant.refreshToken.byteLength > 0
  );
}

export function createGoogleDirectoryConsentService(
  dependencies: DirectoryConsentDependencies,
) {
  return Object.freeze({
    async initiate(input: {
      readonly session: AuthenticatedWebSession;
      readonly requestId: string;
    }) {
      if (
        input.session.context.workspaceRole !== "OWNER" &&
        input.session.context.workspaceRole !== "ADMIN"
      ) {
        throw new DirectoryConsentDeniedError("Directory consent is denied");
      }
      const prepared = await dependencies.repository.prepare({
        session: input.session,
        requestId: requestId(input.requestId),
      });
      const authorization = await dependencies.provider.createAuthorization();
      const cookie = dependencies.consentCookie.seal(Object.freeze({
        workspaceId: input.session.context.workspaceId,
        identityId: input.session.context.identityId,
        sessionId: input.session.context.sessionId,
        connectorId: prepared.connectorId,
        providerSubject: prepared.providerSubject,
        normalizedEmail: prepared.normalizedEmail,
        hostedDomain: prepared.hostedDomain,
        state: authorization.state,
        nonce: authorization.nonce,
        pkceVerifier: authorization.pkceVerifier,
        expiresAt: new Date(dependencies.now().getTime() + 10 * 60 * 1_000),
      }));
      return Object.freeze({
        authorizationUrl: authorization.authorizationUrl,
        cookie,
      });
    },

    async callback(input: {
      readonly session: AuthenticatedWebSession;
      readonly callbackSearch: string;
      readonly cookie: string;
      readonly requestId: string;
    }): Promise<{ readonly kind: "connected"; readonly connectorId: string }> {
      requestId(input.requestId);
      const transaction = dependencies.consentCookie.open(input.cookie);
      const state = callbackState(input.callbackSearch);
      if (
        transaction === null ||
        state === null ||
        state !== transaction.state ||
        transaction.workspaceId !== input.session.context.workspaceId ||
        transaction.identityId !== input.session.context.identityId ||
        transaction.sessionId !== input.session.context.sessionId ||
        (input.session.context.workspaceRole !== "OWNER" &&
          input.session.context.workspaceRole !== "ADMIN")
      ) {
        throw new DirectoryConsentDeniedError("Directory consent is denied");
      }

      let grant: DirectoryConsentProviderGrant | undefined;
      try {
        grant = await dependencies.provider.exchangeAndProbe({
          callbackSearch: input.callbackSearch,
          state: transaction.state,
          nonce: transaction.nonce,
          pkceVerifier: transaction.pkceVerifier,
        });
        if (
          grant.providerSubject !== transaction.providerSubject ||
          grant.normalizedEmail !== transaction.normalizedEmail ||
          grant.hostedDomain !== transaction.hostedDomain ||
          !eligibleGrant(grant)
        ) {
          throw new DirectoryConsentDeniedError("Directory consent is denied");
        }
        const providerGrant = dependencies.sealGrant(grant);
        await dependencies.connection.connect({
          session: input.session,
          connectorId: transaction.connectorId,
          providerGrant,
        });
        return Object.freeze({
          kind: "connected" as const,
          connectorId: transaction.connectorId,
        });
      } catch {
        throw new DirectoryConsentDeniedError("Directory consent is denied");
      } finally {
        grant?.refreshToken.fill(0);
      }
    },
  });
}
