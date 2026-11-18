import { randomUUID } from "node:crypto";

import {
  hashCredential,
  issueSessionCredential,
} from "../../sessions/session-security.ts";
import {
  GoogleWorkspaceAccountRequiredError,
  verifyGoogleWorkspaceClaims,
} from "./claims.ts";
import {
  GOOGLE_LOGIN_CONFIGURATION_KEY,
  type GoogleLoginRuntimeConfig,
} from "./config.ts";
import {
  clientNetworkHmac,
  decodeLoginTransactionCookie,
  decryptPkceVerifier,
  deriveCsrfCredential,
  encodeLoginTransactionCookie,
  encryptPkceVerifier,
  hashProof,
  isCanonicalProof,
  issueOpaqueProof,
  proofHashMatches,
} from "./crypto.ts";
import {
  classifyGoogleAuthorizationErrorCode,
  googleOidcClient,
  GoogleOidcProviderRejectedError,
  GoogleOidcProviderUnavailableError,
  type GoogleOidcClient,
} from "./oidc.ts";
import type {
  GoogleLoginAccessState,
  GoogleLoginRejectionClass,
  GoogleLoginRepository,
} from "./repository.ts";

export class GoogleLoginServiceError extends Error {
  override readonly name = "GoogleLoginServiceError";
}

export type GoogleLoginInitiationResult =
  | {
      readonly outcome: "REDIRECT";
      readonly authorizationUrl: URL;
      readonly loginCookie: string;
      readonly expiresAt: Date;
    }
  | { readonly outcome: "RATE_LIMITED" | "DENIED" };

export type GoogleLoginCallbackResult =
  | {
      readonly outcome: "NORMAL";
      readonly sessionCredential: string;
      readonly route: "/admin" | "/home";
    }
  | {
      readonly outcome: "ONBOARDING";
      readonly accessState: "UNKNOWN_WORKSPACE";
      readonly onboardingCredential: string;
      readonly allowedOperations: readonly [
        "FIRST_DOMAIN_CLAIM_READ",
        "FIRST_DOMAIN_CLAIM_RESERVE",
        "FIRST_DOMAIN_CLAIM_COMPLETE",
      ];
      readonly expiresAt: Date;
    }
  | {
      readonly outcome: "ONBOARDING";
      readonly accessState:
        | "USER_NOT_PROVISIONED"
        | "ACCESS_MAPPING_CONFLICT"
        | "DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE";
      readonly onboardingCredential: string;
      readonly allowedOperations: readonly [
        "ACCESS_REQUEST_READ",
        "ACCESS_REQUEST_SUBMIT",
      ];
      readonly expiresAt: Date;
    }
  | {
      readonly outcome: "ACCESS_DENIED";
      readonly accessState: GoogleLoginAccessState;
    }
  | {
      readonly outcome:
        | "RATE_LIMITED"
        | "DENIED"
        | "PERSONAL_GOOGLE_ACCOUNT"
        | "PROVIDER_REJECTED"
        | "PROVIDER_UNAVAILABLE";
    };

export interface GoogleLoginService {
  initiate(input: {
    readonly canonicalClientIp: string;
    readonly requestId?: string;
  }): Promise<GoogleLoginInitiationResult>;
  callback(input: {
    readonly canonicalClientIp: string;
    readonly callbackSearch: string;
    readonly loginCookie: string | null | undefined;
    readonly inspectPreexistingBrowserAuthority?: () => Promise<boolean>;
    readonly requestId?: string;
  }): Promise<GoogleLoginCallbackResult>;
}

function requestId(value: string | undefined): string {
  const result = value ?? randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(result)) {
    throw new GoogleLoginServiceError("Request identifier is invalid");
  }
  return result;
}

function credentialHash(rawCredential: string): Uint8Array {
  return Buffer.from(hashCredential(rawCredential), "hex");
}

function structurallyValidCallback(
  callbackSearch: string,
  expectedState: string,
): boolean {
  if (
    callbackSearch.length < 1 ||
    callbackSearch.length > 4_096 ||
    !callbackSearch.startsWith("?")
  ) {
    return false;
  }
  const parameters = new URLSearchParams(callbackSearch.slice(1));
  const states = parameters.getAll("state");
  const codes = parameters.getAll("code");
  const errors = parameters.getAll("error");
  if (states.length !== 1 || states[0] !== expectedState) {
    return false;
  }
  if (codes.length === 1 && codes[0].length >= 1 && codes[0].length <= 4_096) {
    return errors.length === 0;
  }
  return (
    codes.length === 0 &&
    errors.length === 1 &&
    errors[0].length >= 1 &&
    errors[0].length <= 128
  );
}

function callbackProviderErrorCode(callbackSearch: string): string | undefined {
  return new URLSearchParams(callbackSearch.slice(1)).get("error") ?? undefined;
}

async function safelyRejectBound(
  repository: GoogleLoginRepository,
  completionHandleHash: Uint8Array,
  rejectionClass: GoogleLoginRejectionClass,
  operationRequestId: string,
): Promise<void> {
  await repository.rejectBound({
    completionHandleHash,
    rejectionClass,
    requestId: operationRequestId,
  });
}

export function createGoogleLoginService(input: {
  readonly config: GoogleLoginRuntimeConfig;
  readonly repository: GoogleLoginRepository;
  readonly oidc?: GoogleOidcClient;
}): GoogleLoginService {
  const { config, repository } = input;
  const oidc = input.oidc ?? googleOidcClient;
  const implementation: GoogleLoginService = {
    async initiate(operation) {
      const operationRequestId = requestId(operation.requestId);
      const networkHmac = clientNetworkHmac(
        operation.canonicalClientIp,
        config.rateHmacKey,
      );
      let authorization;
      try {
        authorization = await oidc.createAuthorizationTransaction();
      } catch {
        await repository.rejectUnbound({
          networkHmac,
          rejectionClass: "INTERNAL_FAILURE",
          requestId: operationRequestId,
        });
        throw new GoogleLoginServiceError("Google login transaction is unavailable");
      }

      const browserCredential = issueOpaqueProof();
      const stateHash = hashProof(authorization.state);
      const pkceEnvelope = encryptPkceVerifier(authorization.pkceVerifier, {
        environmentId: config.environmentId,
        locatorHash: stateHash,
        keyVersion: config.pkceKeyVersion,
        key: config.pkceEncryptionKey,
      });
      const began = await repository.begin({
        networkHmac,
        stateHash,
        nonceHash: hashProof(authorization.nonce),
        browserBindingHash: hashProof(browserCredential),
        pkceEnvelope,
        requestId: operationRequestId,
      });
      if (began.outcome !== "CREATED") {
        return began;
      }
      let authorizationUrl: URL;
      try {
        // The database admission routine has already consumed the shared A1
        // bucket. Provider discovery must never be an unbounded pre-limiter
        // network call. A failed discovery leaves only this expiring PENDING
        // transaction and issues no browser authority.
        authorizationUrl = await oidc.buildAuthorizationUrl(config, authorization);
      } catch {
        throw new GoogleLoginServiceError("Google login provider is unavailable");
      }
      return {
        outcome: "REDIRECT",
        authorizationUrl,
        loginCookie: encodeLoginTransactionCookie({
          browserCredential,
          nonce: authorization.nonce,
        }),
        expiresAt: began.expiresAt,
      };
    },

    async callback(operation) {
      const operationRequestId = requestId(operation.requestId);
      const networkHmac = clientNetworkHmac(
        operation.canonicalClientIp,
        config.rateHmacKey,
      );
      const cookie = decodeLoginTransactionCookie(operation.loginCookie);
      let callbackState: string | null = null;
      if (
        operation.callbackSearch.length >= 1 &&
        operation.callbackSearch.length <= 4_096 &&
        operation.callbackSearch.startsWith("?")
      ) {
        const states = new URLSearchParams(operation.callbackSearch.slice(1)).getAll(
          "state",
        );
        callbackState = states.length === 1 ? states[0] : null;
      }
      if (
        cookie === null ||
        callbackState === null ||
        !isCanonicalProof(callbackState) ||
        !structurallyValidCallback(operation.callbackSearch, callbackState)
      ) {
        const rejection = await repository.rejectUnbound({
          networkHmac,
          rejectionClass: "PROTOCOL_INVALID",
          requestId: operationRequestId,
        });
        return {
          outcome: rejection === "RATE_LIMITED" ? "RATE_LIMITED" : "DENIED",
        };
      }

      const completionHandle = issueOpaqueProof();
      const completionHandleHash = hashProof(completionHandle);
      const consumed = await repository.consume({
        networkHmac,
        stateHash: hashProof(callbackState),
        browserBindingHash: hashProof(cookie.browserCredential),
        completionHandleHash,
        requestId: operationRequestId,
      });
      if (consumed.outcome !== "RESERVED") {
        return consumed;
      }
      if (
        consumed.configurationKey !== GOOGLE_LOGIN_CONFIGURATION_KEY ||
        consumed.pkceKmsKeyVersion !== config.pkceKeyVersion ||
        !proofHashMatches(cookie.nonce, consumed.expectedNonceHash)
      ) {
        await safelyRejectBound(
          repository,
          completionHandleHash,
          "PROTOCOL_INVALID",
          operationRequestId,
        );
        return { outcome: "DENIED" };
      }
      if (operation.inspectPreexistingBrowserAuthority !== undefined) {
        let preexistingBrowserAuthority: boolean;
        try {
          preexistingBrowserAuthority =
            await operation.inspectPreexistingBrowserAuthority();
        } catch (error) {
          await safelyRejectBound(
            repository,
            completionHandleHash,
            "INTERNAL_FAILURE",
            operationRequestId,
          );
          throw error;
        }
        if (preexistingBrowserAuthority) {
          await safelyRejectBound(
            repository,
            completionHandleHash,
            "PROTOCOL_INVALID",
            operationRequestId,
          );
          return { outcome: "DENIED" };
        }
      }
      const providerCallbackError = callbackProviderErrorCode(
        operation.callbackSearch,
      );
      if (providerCallbackError !== undefined) {
        const classifiedError = classifyGoogleAuthorizationErrorCode(
          providerCallbackError,
        );
        const rejectionClass: GoogleLoginRejectionClass =
          classifiedError instanceof GoogleOidcProviderUnavailableError
            ? "PROVIDER_UNAVAILABLE"
            : classifiedError instanceof GoogleOidcProviderRejectedError
              ? "PROVIDER_REJECTED"
              : "CLAIMS_INVALID";
        await safelyRejectBound(
          repository,
          completionHandleHash,
          rejectionClass,
          operationRequestId,
        );
        return {
          outcome:
            rejectionClass === "PROVIDER_UNAVAILABLE"
              ? "PROVIDER_UNAVAILABLE"
              : rejectionClass === "PROVIDER_REJECTED"
                ? "PROVIDER_REJECTED"
                : "DENIED",
        };
      }

      let pkceVerifier: string;
      try {
        pkceVerifier = decryptPkceVerifier(
          consumed.pkceEnvelope,
          {
            environmentId: config.environmentId,
            locatorHash: hashProof(callbackState),
            keyVersion: consumed.pkceKmsKeyVersion,
            key: config.pkceEncryptionKey,
          },
          consumed.pkceAssociatedData,
        );
      } catch {
        await safelyRejectBound(
          repository,
          completionHandleHash,
          "INTERNAL_FAILURE",
          operationRequestId,
        );
        throw new GoogleLoginServiceError("Google login transaction is invalid");
      }

      let claims;
      try {
        const idTokenClaims = await oidc.exchangeAuthorizationCode({
          config,
          callbackSearch: operation.callbackSearch,
          state: callbackState,
          nonce: cookie.nonce,
          pkceVerifier,
        });
        claims = verifyGoogleWorkspaceClaims({
          claims: idTokenClaims,
          expectedClientId: config.clientId,
          expectedNonce: cookie.nonce,
        });
      } catch (error) {
        const rejectionClass: GoogleLoginRejectionClass =
          error instanceof GoogleOidcProviderUnavailableError
            ? "PROVIDER_UNAVAILABLE"
            : error instanceof GoogleOidcProviderRejectedError
              ? "PROVIDER_REJECTED"
            : "CLAIMS_INVALID";
        if (rejectionClass === "PROVIDER_UNAVAILABLE") {
          const errName = error instanceof Error ? error.name : "UnknownError";
          const causeCode =
            error instanceof Error &&
            error.cause !== null &&
            typeof error.cause === "object" &&
            "code" in error.cause &&
            typeof error.cause.code === "string"
              ? error.cause.code
              : null;
          console.error(
            JSON.stringify({
              event: "GOOGLE_LOGIN_OIDC_UNAVAILABLE",
              request_id: operationRequestId,
              error_name: errName,
              cause_code: causeCode,
            }),
          );
        }
        await safelyRejectBound(
          repository,
          completionHandleHash,
          rejectionClass,
          operationRequestId,
        );
        return {
          outcome:
            error instanceof GoogleWorkspaceAccountRequiredError
              ? "PERSONAL_GOOGLE_ACCOUNT"
              : rejectionClass === "PROVIDER_UNAVAILABLE"
                ? "PROVIDER_UNAVAILABLE"
                : rejectionClass === "PROVIDER_REJECTED"
                  ? "PROVIDER_REJECTED"
                  : "DENIED",
        };
      }

      const session = issueSessionCredential();
      const csrf = deriveCsrfCredential(session.raw_token, config.sessionPepper);
      const onboardingCredential = issueOpaqueProof();
      const completed = await repository.complete({
        completionHandleHash,
        claims,
        sessionTokenHash: Buffer.from(session.token_hash, "hex"),
        csrfTokenHash: credentialHash(csrf),
        onboardingTokenHash: hashProof(onboardingCredential),
        requestId: operationRequestId,
      });
      if (
        (completed.outcome === "NORMAL" || completed.outcome === "ONBOARDING") &&
        repository.syncProfileClaims !== undefined &&
        (claims.displayName !== null || claims.pictureUrl !== null)
      ) {
        const tokenHashToSync =
          completed.outcome === "NORMAL"
            ? Buffer.from(session.token_hash, "hex")
            : hashProof(onboardingCredential);
        try {
          await repository.syncProfileClaims({
            credentialHash: tokenHashToSync,
            displayName: claims.displayName,
            pictureUrl: claims.pictureUrl,
          });
        } catch {
          // Non-fatal metadata enrichment: keep login resilient if the optional
          // profile-claim sync routine is unavailable.
        }
      }
      if (completed.outcome === "NORMAL") {
        return {
          outcome: "NORMAL",
          sessionCredential: session.raw_token,
          route: completed.route,
        };
      }
      if (completed.outcome === "ONBOARDING") {
        if (completed.accessState === "UNKNOWN_WORKSPACE") {
          return {
            outcome: "ONBOARDING",
            accessState: completed.accessState,
            onboardingCredential,
            allowedOperations: completed.allowedOperations,
            expiresAt: completed.expiresAt,
          };
        }
        return {
          outcome: "ONBOARDING",
          accessState: completed.accessState,
          onboardingCredential,
          allowedOperations: completed.allowedOperations,
          expiresAt: completed.expiresAt,
        };
      }
      return {
        outcome: "ACCESS_DENIED",
        accessState: completed.accessState,
      };
    },
  };
  return Object.freeze(implementation);
}
