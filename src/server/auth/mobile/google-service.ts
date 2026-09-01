import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  GoogleWorkspaceAccountRequiredError,
  verifyGoogleWorkspaceClaims,
} from "../google/claims.ts";
import type { GoogleLoginRuntimeConfig } from "../google/config.ts";
import {
  clientNetworkHmac,
  hashProof,
  issueOpaqueProof,
  type WebPkceEnvelope,
} from "../google/crypto.ts";
import {
  googleOidcClient,
  GoogleOidcProviderRejectedError,
  GoogleOidcProviderUnavailableError,
  type GoogleOidcClient,
} from "../google/oidc.ts";
import type { VerifiedGoogleClaims } from "../google/claims.ts";
import type { MobileAuthConfig } from "./config.ts";
import type { MobilePlatform } from "./protocol.ts";

export type MobileGoogleConfigurationKey =
  | "GOOGLE_MOBILE_ANDROID_V1"
  | "GOOGLE_MOBILE_IOS_V1";

export type MobileAuthUiCategory =
  | "PERSONAL_GOOGLE_ACCOUNT"
  | "UNKNOWN_WORKSPACE"
  | "USER_NOT_PROVISIONED"
  | "USER_SUSPENDED"
  | "WORKSPACE_SUSPENDED"
  | "SESSION_REVOKED"
  | "SESSION_EXPIRED"
  | "POLICY_OR_DEVICE_BLOCKED"
  | "GOOGLE_CANCELLED"
  | "PROVIDER_UNAVAILABLE"
  | "OFFLINE"
  | "AUTH_ERROR";

export function mobileGoogleConfigurationKey(
  platform: MobilePlatform,
): MobileGoogleConfigurationKey {
  return platform === "ANDROID"
    ? "GOOGLE_MOBILE_ANDROID_V1"
    : "GOOGLE_MOBILE_IOS_V1";
}

export function mobilePkceAssociatedData(input: {
  readonly environmentId: string;
  readonly platform: MobilePlatform;
  readonly configurationKey: MobileGoogleConfigurationKey;
  readonly stateHash: Uint8Array;
}): Uint8Array {
  if (input.configurationKey !== mobileGoogleConfigurationKey(input.platform)) {
    throw new Error("Mobile platform configuration is invalid");
  }
  return Uint8Array.from(Buffer.from(
    `${input.environmentId}\x1f${input.platform}\x1f${input.configurationKey}\x1f${Buffer.from(input.stateHash).toString("hex")}`,
    "utf8",
  ));
}

export interface MobileGoogleRepository {
  begin(input: {
    readonly platform: MobilePlatform; readonly networkHmac: Uint8Array;
    readonly stateHash: Uint8Array; readonly nonceHash: Uint8Array;
    readonly installationBinding: Uint8Array; readonly appExchangeChallenge: Uint8Array;
    readonly envelope: WebPkceEnvelope; readonly requestId: string;
  }): Promise<{ readonly outcome: "CREATED" | "RATE_LIMITED" | "DENIED" }>;
  consume(input: { readonly networkHmac: Uint8Array; readonly stateHash: Uint8Array;
    readonly completionHandleHash: Uint8Array; readonly requestId: string }): Promise<
      | { readonly outcome: "RESERVED"; readonly platform: MobilePlatform;
          readonly configurationKey: MobileGoogleConfigurationKey;
          readonly expectedNonceHash: Uint8Array; readonly envelope: WebPkceEnvelope;
          readonly pkceKeyVersion: string; readonly associatedData: Uint8Array }
      | { readonly outcome: "RATE_LIMITED" | "DENIED" }>;
  complete(input: { readonly completionHandleHash: Uint8Array;
    readonly claims: VerifiedGoogleClaims; readonly handoffHash: Uint8Array;
    readonly requestId: string }): Promise<
      | { readonly outcome: "NORMAL"; readonly appReturnUri: string }
      | { readonly outcome: "DENIAL_HANDOFF"; readonly appReturnUri: string;
          readonly category: MobileAuthUiCategory }
      | { readonly outcome: "DENIED" }>;
  completeDenial(input: { readonly completionHandleHash: Uint8Array;
    readonly handoffHash: Uint8Array; readonly rejectionClass: string;
    readonly category: MobileAuthUiCategory; readonly requestId: string }): Promise<
      | { readonly outcome: "DENIAL_HANDOFF"; readonly appReturnUri: string;
          readonly category: MobileAuthUiCategory }
      | { readonly outcome: "DENIED" }>;
  reject(input: { readonly platform: MobilePlatform | null; readonly networkHmac: Uint8Array;
    readonly completionHandleHash: Uint8Array | null;
    readonly rejectionClass: string; readonly requestId: string }): Promise<"RECORDED" | "RATE_LIMITED">;
}

function oidcConfig(config: MobileAuthConfig): GoogleLoginRuntimeConfig {
  return {
    appOrigin: new URL(config.callbackUri).origin,
    redirectUri: config.callbackUri,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    environmentId: config.environmentId,
    databaseUrl: config.databaseUrl,
    rateHmacKey: config.rateHmacKey,
    pkceEncryptionKey: config.pkceEncryptionKey,
    pkceKeyVersion: config.pkceKeyVersion,
    sessionPepper: config.sessionPepper,
  };
}

function sealTransaction(
  pkceVerifier: string,
  nonce: string,
  key: Uint8Array,
  aad: Uint8Array,
): WebPkceEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ pkceVerifier, nonce }), "utf8"),
    cipher.final(),
  ]);
  return { envelopeVersion: 1, algorithm: "AES-256-GCM", nonce: iv,
    ciphertext, tag: cipher.getAuthTag() };
}

function openTransaction(envelope: WebPkceEnvelope, key: Uint8Array, aad: Uint8Array) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, envelope.nonce);
    decipher.setAAD(aad); decipher.setAuthTag(envelope.tag);
    const parsed = JSON.parse(Buffer.concat([
      decipher.update(envelope.ciphertext), decipher.final(),
    ]).toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("pkceVerifier" in parsed) ||
      !("nonce" in parsed) || typeof parsed.pkceVerifier !== "string" || typeof parsed.nonce !== "string") {
      throw new Error("shape");
    }
    return { pkceVerifier: parsed.pkceVerifier, nonce: parsed.nonce };
  } catch { throw new Error("Invalid mobile transaction envelope"); }
}

export function createMobileGoogleService(dependencies: {
  readonly config: MobileAuthConfig;
  readonly repository: MobileGoogleRepository;
  readonly oidc?: GoogleOidcClient;
}) {
  const { config, repository } = dependencies;
  const oidc = dependencies.oidc ?? googleOidcClient;
  const providerConfig = oidcConfig(config);
  return Object.freeze({
    async rejectMalformedIngress(input: {
      readonly canonicalClientIp: string;
      readonly requestId: string;
    }) {
      return repository.reject({
        platform: null,
        networkHmac: clientNetworkHmac(input.canonicalClientIp, config.rateHmacKey),
        completionHandleHash: null,
        rejectionClass: "PROTOCOL_INVALID",
        requestId: input.requestId,
      });
    },

    async initiate(input: { readonly platform: MobilePlatform;
      readonly appExchangeChallenge: Uint8Array; readonly installationBinding: Uint8Array;
      readonly canonicalClientIp: string; readonly requestId: string }) {
      const networkHmac = clientNetworkHmac(input.canonicalClientIp, config.rateHmacKey);
      let transaction;
      try {
        transaction = await oidc.createAuthorizationTransaction();
      } catch (error) {
        await repository.reject({ platform: input.platform, networkHmac,
          completionHandleHash: null, rejectionClass: "INTERNAL_FAILURE",
          requestId: input.requestId });
        throw error;
      }
      const stateHash = hashProof(transaction.state);
      const aad = mobilePkceAssociatedData({
        environmentId: config.environmentId,
        platform: input.platform,
        configurationKey: mobileGoogleConfigurationKey(input.platform),
        stateHash,
      });
      const result = await repository.begin({ platform: input.platform, networkHmac,
        stateHash, nonceHash: hashProof(transaction.nonce),
        installationBinding: input.installationBinding,
        appExchangeChallenge: input.appExchangeChallenge,
        envelope: sealTransaction(transaction.pkceVerifier, transaction.nonce,
          config.pkceEncryptionKey, aad), requestId: input.requestId });
      if (result.outcome !== "CREATED") return result;
      return { outcome: "REDIRECT" as const,
        authorizationUrl: await oidc.buildAuthorizationUrl(providerConfig, transaction) };
    },

    async callback(input: { readonly callbackSearch: string;
      readonly canonicalClientIp: string; readonly requestId: string }) {
      const params = new URLSearchParams(input.callbackSearch.startsWith("?")
        ? input.callbackSearch.slice(1) : "");
      const states = params.getAll("state");
      const state = states.length === 1 ? states[0] : null;
      const networkHmac = clientNetworkHmac(input.canonicalClientIp, config.rateHmacKey);
      if (state === null || !/^[A-Za-z0-9_-]{43}$/u.test(state)) {
        const rejection = await repository.reject({
          platform: null,
          networkHmac,
          completionHandleHash: null,
          rejectionClass: "PROTOCOL_INVALID",
          requestId: input.requestId,
        });
        return { outcome: rejection === "RATE_LIMITED" ? "RATE_LIMITED" as const : "DENIED" as const };
      }
      const completionHandle = issueOpaqueProof();
      const completionHandleHash = hashProof(completionHandle);
      const consumed = await repository.consume({ networkHmac, stateHash: hashProof(state),
        completionHandleHash, requestId: input.requestId });
      if (consumed.outcome !== "RESERVED") return consumed;
      const completeBoundDenial = async (
        rejectionClass: string,
        category: MobileAuthUiCategory = "AUTH_ERROR",
      ) => {
        const handoffCode = issueOpaqueProof();
        const completed = await repository.completeDenial({
          completionHandleHash,
          handoffHash: hashProof(handoffCode),
          rejectionClass,
          category,
          requestId: input.requestId,
        });
        if (
          completed.outcome !== "DENIAL_HANDOFF" ||
          completed.appReturnUri !== config.appReturnUri
        ) {
          return { outcome: "DENIED" as const };
        }
        return {
          outcome: "HANDOFF" as const,
          handoffCode,
          appReturnUri: completed.appReturnUri,
        };
      };
      if (consumed.pkceKeyVersion !== config.pkceKeyVersion) {
        return completeBoundDenial("PROTOCOL_INVALID");
      }
      let canonicalAad: Uint8Array;
      try {
        canonicalAad = mobilePkceAssociatedData({
          environmentId: config.environmentId,
          platform: consumed.platform,
          configurationKey: consumed.configurationKey,
          stateHash: hashProof(state),
        });
      } catch {
        return completeBoundDenial("PROTOCOL_INVALID");
      }
      if (!Buffer.from(canonicalAad).equals(Buffer.from(consumed.associatedData))) {
        return completeBoundDenial("PROTOCOL_INVALID");
      }
      let material: { readonly pkceVerifier: string; readonly nonce: string };
      try {
        material = openTransaction(
          consumed.envelope,
          config.pkceEncryptionKey,
          canonicalAad,
        );
      } catch {
        return completeBoundDenial("PROTOCOL_INVALID");
      }
      if (!Buffer.from(hashProof(material.nonce)).equals(Buffer.from(consumed.expectedNonceHash))) {
        return completeBoundDenial("PROTOCOL_INVALID");
      }
      let claims: VerifiedGoogleClaims;
      try {
        const idToken = await oidc.exchangeAuthorizationCode({ config: providerConfig,
          callbackSearch: input.callbackSearch, state, nonce: material.nonce,
          pkceVerifier: material.pkceVerifier });
        claims = verifyGoogleWorkspaceClaims({ claims: idToken,
          expectedClientId: config.clientId, expectedNonce: material.nonce });
      } catch (error) {
        const rejectionClass = error instanceof GoogleOidcProviderUnavailableError
          ? "PROVIDER_UNAVAILABLE"
          : error instanceof GoogleOidcProviderRejectedError
            ? "PROVIDER_REJECTED"
            : "CLAIMS_INVALID";
        return completeBoundDenial(
          rejectionClass,
          error instanceof GoogleWorkspaceAccountRequiredError
            ? "PERSONAL_GOOGLE_ACCOUNT"
            : error instanceof GoogleOidcProviderRejectedError
              ? "GOOGLE_CANCELLED"
              : error instanceof GoogleOidcProviderUnavailableError
                ? "PROVIDER_UNAVAILABLE"
                : "AUTH_ERROR",
        );
      }
      const handoffCode = issueOpaqueProof();
      const completed = await repository.complete({ completionHandleHash, claims,
        handoffHash: hashProof(handoffCode), requestId: input.requestId });
      if (
        completed.outcome === "DENIED" ||
        completed.appReturnUri !== config.appReturnUri
      ) {
        return { outcome: "DENIED" as const };
      }
      return { outcome: "HANDOFF" as const, handoffCode,
        appReturnUri: completed.appReturnUri };
    },
  });
}
