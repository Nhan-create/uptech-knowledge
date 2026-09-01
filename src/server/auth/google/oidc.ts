import { createHash } from "node:crypto";

import * as openid from "openid-client";

import {
  GOOGLE_ISSUER,
  GOOGLE_LOGIN_SCOPE,
  type GoogleLoginRuntimeConfig,
} from "./config.ts";
import { isCanonicalProof } from "./crypto.ts";
import { createRecoveringPromiseCache } from "./recovering-promise-cache.ts";

export class GoogleOidcError extends Error {
  override readonly name: string = "GoogleOidcError";
}

export class GoogleOidcProviderUnavailableError extends GoogleOidcError {
  override readonly name = "GoogleOidcProviderUnavailableError";
}

export class GoogleOidcProviderRejectedError extends GoogleOidcError {
  override readonly name = "GoogleOidcProviderRejectedError";
}

export class GoogleOidcVerificationError extends GoogleOidcError {
  override readonly name = "GoogleOidcVerificationError";
}

export interface GoogleAuthorizationTransaction {
  readonly state: string;
  readonly nonce: string;
  readonly pkceVerifier: string;
  readonly pkceChallenge: string;
}

export interface GoogleOidcClient {
  createAuthorizationTransaction(): Promise<GoogleAuthorizationTransaction>;
  buildAuthorizationUrl(
    config: GoogleLoginRuntimeConfig,
    transaction: GoogleAuthorizationTransaction,
  ): Promise<URL>;
  exchangeAuthorizationCode(input: {
    readonly config: GoogleLoginRuntimeConfig;
    readonly callbackSearch: string;
    readonly state: string;
    readonly nonce: string;
    readonly pkceVerifier: string;
  }): Promise<openid.IDToken>;
}

const discoveryCache = createRecoveringPromiseCache<openid.Configuration>();

function discoveryFor(
  config: GoogleLoginRuntimeConfig,
): Promise<openid.Configuration> {
  const credentialFingerprint = createHash("sha256")
    .update(config.clientSecret, "utf8")
    .digest("base64url");
  const cacheKey = `${config.clientId}\0${config.redirectUri}\0${credentialFingerprint}`;
  return discoveryCache.get(cacheKey, async () => {
    const discovered = await openid.discovery(
      new URL(GOOGLE_ISSUER),
      config.clientId,
      {
      client_secret: config.clientSecret,
      redirect_uris: [config.redirectUri],
      response_types: ["code"],
      },
    );
    openid.enableNonRepudiationChecks(discovered);
    return discovered;
  });
}

function assertTransaction(transaction: GoogleAuthorizationTransaction): void {
  if (
    !isCanonicalProof(transaction.state) ||
    !isCanonicalProof(transaction.nonce) ||
    !/^[A-Za-z0-9._~-]{43,128}$/u.test(transaction.pkceVerifier) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(transaction.pkceChallenge)
  ) {
    throw new GoogleOidcError("OIDC transaction material is invalid");
  }
}

function requireCallbackSearch(value: string): string {
  if (value.length < 1 || value.length > 4_096 || !value.startsWith("?")) {
    throw new GoogleOidcError("OIDC callback response is invalid");
  }
  return value;
}

const TRANSIENT_PROVIDER_ERRORS = new Set([
  "temporarily_unavailable",
  "server_error",
]);

function providerUnavailable(errorCode: unknown): boolean {
  return typeof errorCode === "string" &&
    TRANSIENT_PROVIDER_ERRORS.has(errorCode);
}

export function classifyGoogleAuthorizationErrorCode(
  errorCode: unknown,
):
  | GoogleOidcProviderRejectedError
  | GoogleOidcProviderUnavailableError
  | GoogleOidcVerificationError {
  if (errorCode === "access_denied") {
    return new GoogleOidcProviderRejectedError(
      "Google authorization was cancelled",
    );
  }
  if (providerUnavailable(errorCode)) {
    return new GoogleOidcProviderUnavailableError(
      "Google authorization service is unavailable",
    );
  }
  return new GoogleOidcVerificationError(
    "Google authorization response verification failed",
  );
}

export function classifyGoogleOidcExchangeError(error: unknown): GoogleOidcError {
  if (error instanceof openid.AuthorizationResponseError) {
    return classifyGoogleAuthorizationErrorCode(error.error);
  }
  if (error instanceof openid.ResponseBodyError) {
    if (providerUnavailable(error.error)) {
      return new GoogleOidcProviderUnavailableError(
        "Google authorization service is unavailable",
      );
    }
    return new GoogleOidcVerificationError(
      "Google authorization response verification failed",
    );
  }
  if (error instanceof openid.WWWAuthenticateChallengeError) {
    if (
      error.cause.some((challenge) =>
        providerUnavailable(challenge.parameters.error))
    ) {
      return new GoogleOidcProviderUnavailableError(
        "Google authorization service is unavailable",
      );
    }
    return new GoogleOidcVerificationError(
      "Google authorization response verification failed",
    );
  }
  if (error instanceof TypeError) {
    return new GoogleOidcProviderUnavailableError(
      "Google authorization transport is unavailable",
    );
  }
  if (error instanceof openid.ClientError) {
    if (
      error.code === "OAUTH_TIMEOUT" ||
      error.code === "OAUTH_ABORT" ||
      error.code === "OAUTH_RESPONSE_IS_NOT_CONFORM" ||
      error.code === "OAUTH_RESPONSE_IS_NOT_JSON"
    ) {
      return new GoogleOidcProviderUnavailableError(
        "Google authorization transport is unavailable",
      );
    }
    return new GoogleOidcVerificationError(
      "Google authorization response verification failed",
    );
  }
  return new GoogleOidcProviderUnavailableError(
    "Google authorization exchange is unavailable",
  );
}

export function createGoogleOidcClient(
  dependencies: {
    readonly discover?: (
      config: GoogleLoginRuntimeConfig,
    ) => Promise<openid.Configuration>;
  } = {},
): GoogleOidcClient {
  const discover = dependencies.discover ?? discoveryFor;
  const implementation: GoogleOidcClient = {
  async createAuthorizationTransaction() {
    const state = openid.randomState();
    const nonce = openid.randomNonce();
    const pkceVerifier = openid.randomPKCECodeVerifier();
    const pkceChallenge =
      await openid.calculatePKCECodeChallenge(pkceVerifier);
    const transaction = Object.freeze({
      state,
      nonce,
      pkceVerifier,
      pkceChallenge,
    });
    assertTransaction(transaction);
    return transaction;
  },

  async buildAuthorizationUrl(config, transaction) {
    assertTransaction(transaction);
    const discovered = await discover(config);
    const parameters: Record<string, string> = {
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: GOOGLE_LOGIN_SCOPE,
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: transaction.pkceChallenge,
      code_challenge_method: "S256",
      // Every entry point doubles as the real "use another account" action.
      // Keep this server-owned so clients cannot widen the authorization
      // request or choose a different OAuth application.
      prompt: "select_account",
    };
    return openid.buildAuthorizationUrl(discovered, parameters);
  },

  async exchangeAuthorizationCode(input) {
    const { config, state, nonce, pkceVerifier } = input;
    assertTransaction({
      state,
      nonce,
      pkceVerifier,
      // This value is shape-checked only; the callback does not need to
      // recompute it because the verifier is authenticated by its AEAD envelope.
      pkceChallenge: await openid.calculatePKCECodeChallenge(pkceVerifier),
    });
    const callback = new URL(config.redirectUri);
    callback.search = requireCallbackSearch(input.callbackSearch);
    try {
      const discovered = await discover(config);
      const tokens = await openid.authorizationCodeGrant(discovered, callback, {
        expectedState: state,
        expectedNonce: nonce,
        pkceCodeVerifier: pkceVerifier,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (claims === undefined) {
        throw new GoogleOidcVerificationError(
          "Google did not return a verified ID token",
        );
      }
      return claims;
    } catch (error) {
      if (error instanceof GoogleOidcError) {
        throw error;
      }
      throw classifyGoogleOidcExchangeError(error);
    }
  },
  };
  return Object.freeze(implementation);
}

export const googleOidcClient: GoogleOidcClient = createGoogleOidcClient();
