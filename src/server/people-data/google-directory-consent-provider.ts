import { domainToASCII } from "node:url";

import * as openid from "openid-client";
import type { IDToken } from "openid-client";

import {
  GOOGLE_ISSUER,
  type GoogleLoginRuntimeConfig,
} from "../auth/google/config.ts";
import { verifyGoogleWorkspaceClaims } from "../auth/google/claims.ts";
import {
  googleOidcClient,
  type GoogleAuthorizationTransaction,
} from "../auth/google/oidc.ts";
import { isCanonicalProof } from "../auth/google/crypto.ts";
import type { DirectoryConsentProviderGrant } from "./directory-consent.ts";
import { GOOGLE_DIRECTORY_READ_ONLY_SCOPES } from "./google-directory-scopes.ts";
import {
  normalizeVerifiedGoogleWorkspaceDomains,
  type VerifiedGoogleWorkspaceDomain,
} from "./google-workspace-domains.ts";

const DIRECTORY_ORIGIN = "https://admin.googleapis.com/admin/directory/v1";
const DIRECTORY_CALLBACK_PATH =
  "/api/v1/admin/connectors/google-directory/callback";
const WORKSPACE_BOOTSTRAP_CALLBACK_PATH =
  "/api/v1/onboarding/google-workspace/callback";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;

export { GOOGLE_DIRECTORY_READ_ONLY_SCOPES } from "./google-directory-scopes.ts";

export const GOOGLE_DIRECTORY_CONSENT_SCOPES = Object.freeze([
  "openid",
  "email",
  "profile",
  ...GOOGLE_DIRECTORY_READ_ONLY_SCOPES,
] as const);

export class GoogleDirectoryConsentProviderError extends Error {
  override readonly name = "GoogleDirectoryConsentProviderError";

  constructor() {
    super("Google Directory consent could not be verified");
  }
}

export type GoogleDirectoryConsentProviderConfig = Readonly<
  Pick<GoogleLoginRuntimeConfig, "clientId" | "clientSecret" | "redirectUri">
>;

export interface GoogleDirectoryConsentExchange {
  readonly claims: IDToken;
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly scope?: string;
}

export interface GoogleDirectoryConsentExchangeInput {
  readonly config: GoogleDirectoryConsentProviderConfig;
  readonly callbackSearch: string;
  readonly state: string;
  readonly nonce: string;
  readonly pkceVerifier: string;
}

export interface GoogleDirectoryConsentProviderDependencies {
  readonly createAuthorizationTransaction?:
    () => Promise<GoogleAuthorizationTransaction>;
  readonly discover?: (
    config: GoogleDirectoryConsentProviderConfig,
  ) => Promise<openid.Configuration>;
  readonly exchangeAuthorizationCode?: (
    input: GoogleDirectoryConsentExchangeInput,
  ) => Promise<GoogleDirectoryConsentExchange>;
  readonly fetch?: typeof globalThis.fetch;
  readonly nowEpochSeconds?: () => number;
  readonly timeoutMs?: number;
}

export interface GoogleDirectoryConsentEvidence extends DirectoryConsentProviderGrant {
  readonly customerId: string;
  readonly directoryUserCustomerId: string;
  readonly directoryUserActive: true;
  readonly primaryDomain: string;
  readonly verifiedDomains: readonly VerifiedGoogleWorkspaceDomain[];
  readonly providerSubject: string;
  readonly normalizedEmail: string;
  readonly hostedDomain: string;
  readonly refreshToken: Uint8Array;
  readonly grantedScopes: typeof GOOGLE_DIRECTORY_READ_ONLY_SCOPES;
  readonly isAdmin: boolean;
  readonly isDelegatedAdmin: boolean;
  readonly readProbes: Readonly<{
    customer: true;
    users: true;
    groups: true;
    groupMembers: true;
    orgUnits: true;
  }>;
}

export interface GoogleDirectoryConsentProvider {
  createAuthorization(): Promise<{
    readonly state: string;
    readonly nonce: string;
    readonly pkceVerifier: string;
    readonly authorizationUrl: URL;
  }>;
  createAuthorizationTransaction(): Promise<GoogleAuthorizationTransaction>;
  buildAuthorizationUrl(
    transaction: GoogleAuthorizationTransaction,
  ): Promise<URL>;
  exchangeAndProbe(
    input: Omit<GoogleDirectoryConsentExchangeInput, "config">,
  ): Promise<GoogleDirectoryConsentEvidence>;
}

function fail(): never {
  throw new GoogleDirectoryConsentProviderError();
}

function requireConfig(
  config: GoogleDirectoryConsentProviderConfig,
): GoogleDirectoryConsentProviderConfig {
  if (
    typeof config.clientId !== "string" ||
    config.clientId.trim().length === 0 ||
    config.clientId.length > 512 ||
    typeof config.clientSecret !== "string" ||
    config.clientSecret.length === 0 ||
    config.clientSecret.length > 4_096
  ) {
    return fail();
  }
  let callback: URL;
  try {
    callback = new URL(config.redirectUri);
  } catch {
    return fail();
  }
  const localDevelopment = callback.protocol === "http:" &&
    (callback.hostname === "localhost" || callback.hostname === "127.0.0.1");
  if (
    (callback.protocol !== "https:" && !localDevelopment) ||
    (callback.pathname !== DIRECTORY_CALLBACK_PATH &&
      callback.pathname !== WORKSPACE_BOOTSTRAP_CALLBACK_PATH) ||
    callback.search.length > 0 ||
    callback.hash.length > 0 ||
    callback.username.length > 0 ||
    callback.password.length > 0
  ) {
    return fail();
  }
  return Object.freeze({
    clientId: config.clientId.trim(),
    clientSecret: config.clientSecret,
    redirectUri: callback.href,
  });
}

function assertTransaction(
  transaction: GoogleAuthorizationTransaction,
): GoogleAuthorizationTransaction {
  if (
    !isCanonicalProof(transaction.state) ||
    !isCanonicalProof(transaction.nonce) ||
    !/^[A-Za-z0-9._~-]{43,128}$/u.test(transaction.pkceVerifier) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(transaction.pkceChallenge)
  ) {
    return fail();
  }
  return transaction;
}

function requireCallback(input: {
  readonly callbackSearch: string;
  readonly state: string;
}): void {
  if (
    typeof input.callbackSearch !== "string" ||
    input.callbackSearch.length < 1 ||
    input.callbackSearch.length > 4_096 ||
    !input.callbackSearch.startsWith("?") ||
    !isCanonicalProof(input.state)
  ) {
    return fail();
  }
  const parameters = new URLSearchParams(input.callbackSearch.slice(1));
  const states = parameters.getAll("state");
  const codes = parameters.getAll("code");
  if (
    states.length !== 1 ||
    states[0] !== input.state ||
    codes.length !== 1 ||
    codes[0].length < 1 ||
    codes[0].length > 4_096 ||
    parameters.getAll("error").length !== 0
  ) {
    return fail();
  }
}

function requireText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    return fail();
  }
  return value.trim();
}

function normalizeEmail(value: unknown): string {
  const email = requireText(value, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/u.test(email)) {
    return fail();
  }
  return email;
}

function normalizeDomain(value: unknown): string {
  const candidate = requireText(value, 253).toLowerCase();
  const normalized = domainToASCII(candidate);
  if (
    normalized.length < 3 ||
    normalized.length > 253 ||
    normalized.endsWith(".") ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u
      .test(normalized)
  ) {
    return fail();
  }
  return normalized;
}

function records(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): readonly Readonly<Record<string, unknown>>[] {
  const value = payload[key];
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))
  ) {
    return fail();
  }
  return value as readonly Readonly<Record<string, unknown>>[];
}

function requireExactScopes(value: unknown): void {
  if (typeof value !== "string" || value.length > 8_192) {
    return fail();
  }
  const scopes = value.trim().split(/\s+/u).filter(Boolean).map((scope) => {
    if (scope === "https://www.googleapis.com/auth/userinfo.email") return "email";
    if (scope === "https://www.googleapis.com/auth/userinfo.profile") return "profile";
    return scope;
  });
  const exact = new Set<string>(GOOGLE_DIRECTORY_CONSENT_SCOPES);
  if (
    scopes.length !== exact.size ||
    new Set(scopes).size !== exact.size ||
    !scopes.every((scope) => exact.has(scope))
  ) {
    return fail();
  }
}

async function defaultDiscovery(
  config: GoogleDirectoryConsentProviderConfig,
): Promise<openid.Configuration> {
  const configuration = await openid.discovery(
    new URL(GOOGLE_ISSUER),
    config.clientId,
    {
      client_secret: config.clientSecret,
      redirect_uris: [config.redirectUri],
      response_types: ["code"],
    },
  );
  openid.enableNonRepudiationChecks(configuration);
  return configuration;
}

export function createGoogleDirectoryConsentProvider(
  unsafeConfig: GoogleDirectoryConsentProviderConfig,
  dependencies: GoogleDirectoryConsentProviderDependencies = {},
): GoogleDirectoryConsentProvider {
  const config = requireConfig(unsafeConfig);
  const createAuthorizationTransaction =
    dependencies.createAuthorizationTransaction ??
    (() => googleOidcClient.createAuthorizationTransaction());
  const discover = dependencies.discover ?? defaultDiscovery;
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const nowEpochSeconds = dependencies.nowEpochSeconds ??
    (() => Math.floor(Date.now() / 1_000));
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    typeof fetch !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    return fail();
  }

  const exchangeAuthorizationCode = dependencies.exchangeAuthorizationCode ??
    (async (input: GoogleDirectoryConsentExchangeInput) => {
      requireCallback(input);
      assertTransaction({
        state: input.state,
        nonce: input.nonce,
        pkceVerifier: input.pkceVerifier,
        pkceChallenge: await openid.calculatePKCECodeChallenge(input.pkceVerifier),
      });
      const callback = new URL(input.config.redirectUri);
      callback.search = input.callbackSearch;
      const tokens = await openid.authorizationCodeGrant(
        await discover(input.config),
        callback,
        {
          expectedState: input.state,
          expectedNonce: input.nonce,
          pkceCodeVerifier: input.pkceVerifier,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims();
      if (claims === undefined) return fail();
      return {
        claims,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        scope: tokens.scope,
      };
    });

  async function requestJson(
    url: URL,
    accessToken: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (!response.ok || response.redirected) return fail();
      const payload: unknown = await response.json();
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        return fail();
      }
      return payload as Readonly<Record<string, unknown>>;
    } catch {
      return fail();
    } finally {
      clearTimeout(timeout);
    }
  }

  function url(
    path: string,
    parameters: Readonly<Record<string, string>> = {},
  ): URL {
    const result = new URL(`${DIRECTORY_ORIGIN}${path}`);
    for (const [key, value] of Object.entries(parameters)) {
      result.searchParams.set(key, value);
    }
    return result;
  }

  return Object.freeze({
    async createAuthorization() {
      try {
        const transaction = assertTransaction(
          await createAuthorizationTransaction(),
        );
        const authorizationUrl = openid.buildAuthorizationUrl(
          await discover(config),
          {
            redirect_uri: config.redirectUri,
            response_type: "code",
            scope: GOOGLE_DIRECTORY_CONSENT_SCOPES.join(" "),
            state: transaction.state,
            nonce: transaction.nonce,
            code_challenge: transaction.pkceChallenge,
            code_challenge_method: "S256",
            access_type: "offline",
            prompt: "consent select_account",
            include_granted_scopes: "false",
          },
        );
        return Object.freeze({
          state: transaction.state,
          nonce: transaction.nonce,
          pkceVerifier: transaction.pkceVerifier,
          authorizationUrl,
        });
      } catch {
        return fail();
      }
    },

    async createAuthorizationTransaction() {
      try {
        return assertTransaction(await createAuthorizationTransaction());
      } catch {
        return fail();
      }
    },

    async buildAuthorizationUrl(transaction: GoogleAuthorizationTransaction) {
      try {
        assertTransaction(transaction);
        return openid.buildAuthorizationUrl(await discover(config), {
          redirect_uri: config.redirectUri,
          response_type: "code",
          scope: GOOGLE_DIRECTORY_CONSENT_SCOPES.join(" "),
          state: transaction.state,
          nonce: transaction.nonce,
          code_challenge: transaction.pkceChallenge,
          code_challenge_method: "S256",
          access_type: "offline",
          prompt: "consent select_account",
          include_granted_scopes: "false",
        });
      } catch {
        return fail();
      }
    },

    async exchangeAndProbe(
      input: Omit<GoogleDirectoryConsentExchangeInput, "config">,
    ) {
      try {
        requireCallback(input);
        assertTransaction({
          state: input.state,
          nonce: input.nonce,
          pkceVerifier: input.pkceVerifier,
          pkceChallenge: await openid.calculatePKCECodeChallenge(input.pkceVerifier),
        });
        const exchange = await exchangeAuthorizationCode({ ...input, config });
        requireExactScopes(exchange.scope);
        let accessToken = requireText(exchange.accessToken, 8_192);
        const refreshToken = requireText(exchange.refreshToken, 4_096);
        const claims = verifyGoogleWorkspaceClaims({
          claims: exchange.claims,
          expectedClientId: config.clientId,
          expectedNonce: input.nonce,
          nowEpochSeconds: nowEpochSeconds(),
        });

        try {
          const customer = await requestJson(
            url("/customers/my_customer"),
            accessToken,
          );
          const customerId = requireText(customer.id, 512);
          const customerDomain = normalizeDomain(customer.customerDomain);
          const domainPayload = await requestJson(
            url(`/customer/${encodeURIComponent(customerId)}/domains`),
            accessToken,
          );
          const verifiedDomains = normalizeVerifiedGoogleWorkspaceDomains({
            customerDomain,
            domains: records(domainPayload, "domains"),
          });
          const primaryDomain = verifiedDomains.find((domain) => domain.kind === "PRIMARY")?.normalizedDomain;
          if (
            primaryDomain === undefined ||
            !verifiedDomains.some((domain) => domain.normalizedDomain === claims.hostedDomain)
          ) {
            return fail();
          }

          const currentUser = await requestJson(
            url(`/users/${encodeURIComponent(claims.normalizedEmail)}`, {
              projection: "FULL",
              viewType: "admin_view",
            }),
            accessToken,
          );
          const directoryUserCustomerId = requireText(currentUser.customerId, 512);
          if (
            requireText(currentUser.id, 255) !== claims.providerSubject ||
            normalizeEmail(currentUser.primaryEmail) !== claims.normalizedEmail ||
            directoryUserCustomerId !== customerId ||
            currentUser.suspended === true ||
            currentUser.archived === true
          ) {
            return fail();
          }

          const users = await requestJson(
            url("/users", {
              customer: "my_customer",
              projection: "FULL",
              viewType: "admin_view",
              maxResults: "1",
            }),
            accessToken,
          );
          records(users, "users");

          const groups = await requestJson(
            url("/groups", { customer: "my_customer", maxResults: "1" }),
            accessToken,
          );
          const listedGroups = records(groups, "groups");
          if (listedGroups.length > 0) {
            const googleGroupId = requireText(listedGroups[0].id, 255);
            const members = await requestJson(
              url(`/groups/${encodeURIComponent(googleGroupId)}/members`, {
                includeDerivedMembership: "false",
                maxResults: "1",
              }),
              accessToken,
            );
            records(members, "members");
          }

          const orgUnits = await requestJson(
            url("/customer/my_customer/orgunits", {
              type: "ALL_INCLUDING_PARENT",
            }),
            accessToken,
          );
          records(orgUnits, "organizationUnits");

          return Object.freeze({
            customerId,
            directoryUserCustomerId,
            directoryUserActive: true as const,
            primaryDomain,
            verifiedDomains,
            providerSubject: claims.providerSubject,
            normalizedEmail: claims.normalizedEmail,
            hostedDomain: claims.hostedDomain,
            refreshToken: new TextEncoder().encode(refreshToken),
            grantedScopes: GOOGLE_DIRECTORY_READ_ONLY_SCOPES,
            isAdmin: currentUser.isAdmin === true,
            isDelegatedAdmin: currentUser.isDelegatedAdmin === true,
            readProbes: Object.freeze({
              customer: true as const,
              users: true as const,
              groups: true as const,
              groupMembers: true as const,
              orgUnits: true as const,
            }),
          });
        } finally {
          accessToken = "";
        }
      } catch {
        return fail();
      }
    },
  });
}
