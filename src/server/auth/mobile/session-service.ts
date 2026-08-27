import {
  hashMobileProof,
  issueMobileCredentialPair,
  type MobilePlatform,
} from "./protocol.ts";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { clientNetworkHmac } from "../google/crypto.ts";

export class MobileSessionServiceError extends Error {
  override readonly name = "MobileSessionServiceError";
  readonly code:
    | "UNAUTHENTICATED"
    | "ACCESS_TOKEN_EXPIRED"
    | "SESSION_REVOKED"
    | "SESSION_EXPIRED";

  constructor(
    message: string,
    code:
      | "UNAUTHENTICATED"
      | "ACCESS_TOKEN_EXPIRED"
      | "SESSION_REVOKED"
      | "SESSION_EXPIRED" = "UNAUTHENTICATED",
  ) {
    super(message);
    this.code = code;
  }
}

export interface MobileMembershipSummary {
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly role: "OWNER" | "ADMIN" | "MEMBER";
}

export interface MobileSessionContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly identityId: string;
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly role: "OWNER" | "ADMIN" | "MEMBER";
}

export interface MobileSessionRepository {
  exchangeHandoff(input: {
    readonly networkHmac: Uint8Array;
    readonly handoffHash: Uint8Array;
    readonly appExchangeChallenge: Uint8Array;
    readonly installationBinding: Uint8Array;
    readonly accessTokenHash: Uint8Array;
    readonly refreshTokenHash: Uint8Array;
    readonly requestId: string;
  }): Promise<
    | {
        readonly outcome: "ISSUED";
        readonly sessionId: string;
        readonly accessExpiresAt: Date;
        readonly refreshExpiresAt: Date;
        readonly activeWorkspaceId: string;
        readonly memberships: readonly MobileMembershipSummary[];
      }
    | { readonly outcome: "RATE_LIMITED" | "DENIED" }
  >;
  refresh(input: {
    readonly predecessorRefreshHash: Uint8Array;
    readonly installationBinding: Uint8Array;
    readonly accessTokenHash: Uint8Array;
    readonly refreshTokenHash: Uint8Array;
    readonly replayCapsule: Uint8Array;
    readonly idempotencyKey: string;
    readonly requestId: string;
  }): Promise<
    | {
        readonly outcome: "ROTATED";
        readonly accessExpiresAt: Date;
        readonly refreshExpiresAt: Date;
      }
    | {
        readonly outcome: "REPLAY";
        readonly replayCapsule: Uint8Array;
        readonly accessExpiresAt: Date;
        readonly refreshExpiresAt: Date;
      }
    | { readonly outcome: "DENIED" | "FAMILY_REVOKED" | "SESSION_REVOKED" | "SESSION_EXPIRED" }
  >;
  authenticate(input: {
    readonly accessTokenHash: Uint8Array;
  }): Promise<
    | ({ readonly outcome: "AUTHORIZED" } & MobileSessionContext)
    | { readonly outcome: "DENIED" | "ACCESS_TOKEN_EXPIRED" | "SESSION_REVOKED" | "SESSION_EXPIRED" }
  >;
  listWorkspaces(input: {
    readonly accessTokenHash: Uint8Array;
  }): Promise<
    | {
        readonly outcome: "AUTHORIZED";
        readonly memberships: readonly MobileMembershipSummary[];
      }
    | { readonly outcome: "DENIED" | "ACCESS_TOKEN_EXPIRED" | "SESSION_REVOKED" | "SESSION_EXPIRED" }
  >;
  switchWorkspace(input: {
    readonly accessTokenHash: Uint8Array;
    readonly targetWorkspaceId: string;
    readonly installationBinding: Uint8Array;
    readonly accessTokenHashCandidate: Uint8Array;
    readonly refreshTokenHashCandidate: Uint8Array;
    readonly replayCapsule: Uint8Array;
    readonly idempotencyKey: string;
    readonly requestId: string;
  }): Promise<
    | {
        readonly outcome: "ROTATED";
        readonly accessExpiresAt: Date;
        readonly refreshExpiresAt: Date;
      }
    | { readonly outcome: "REPLAY"; readonly replayCapsule: Uint8Array;
        readonly accessExpiresAt: Date; readonly refreshExpiresAt: Date }
    | { readonly outcome: "DENIED" }
  >;
  revoke(input: {
    readonly accessTokenHash: Uint8Array;
    readonly requestId: string;
  }): Promise<"REVOKED" | "DENIED">;
}

function idempotencyKey(value: string): string {
  if (!/^[A-Za-z0-9._~-]{1,128}$/u.test(value)) {
    throw new MobileSessionServiceError("Invalid idempotency key");
  }
  return value;
}

function bearerCredential(value: string | null): string {
  const match = value?.match(/^Bearer ([A-Za-z0-9_-]{43})$/u);
  if (match === null || match === undefined) {
    throw new MobileSessionServiceError("Invalid bearer credential");
  }
  return match[1];
}

export function createMobileSessionService(dependencies: {
  readonly repository: MobileSessionRepository;
  readonly replayKey: Uint8Array;
  readonly rateHmacKey: Uint8Array;
}) {
  const { repository, replayKey, rateHmacKey } = dependencies;
  if (replayKey.byteLength !== 32) {
    throw new MobileSessionServiceError("Invalid refresh replay key");
  }

  const replayAad = (
    predecessor: Uint8Array,
    installationBinding: Uint8Array,
    key: string,
  ) => Buffer.concat([
    Buffer.from("UPTECH_MOBILE_REFRESH_REPLAY_V1\0", "ascii"),
    Buffer.from(predecessor),
    Buffer.from(installationBinding),
    Buffer.from(key, "ascii"),
  ]);

  const sealReplay = (
    accessToken: string,
    refreshToken: string,
    aad: Uint8Array,
  ): Uint8Array => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", replayKey, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(`${accessToken}.${refreshToken}`, "ascii"),
      cipher.final(),
    ]);
    return Uint8Array.from(Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]));
  };

  const openReplay = (capsule: Uint8Array, aad: Uint8Array) => {
    if (capsule.byteLength !== 115) {
      throw new MobileSessionServiceError("Invalid refresh replay capsule");
    }
    try {
      const bytes = Buffer.from(capsule);
      const decipher = createDecipheriv("aes-256-gcm", replayKey, bytes.subarray(0, 12));
      decipher.setAAD(aad);
      decipher.setAuthTag(bytes.subarray(12, 28));
      const plaintext = Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("ascii");
      const [accessToken, refreshToken, extra] = plaintext.split(".");
      if (extra !== undefined || accessToken.length !== 43 || refreshToken.length !== 43) {
        throw new Error("shape");
      }
      return { accessToken, refreshToken };
    } catch {
      throw new MobileSessionServiceError("Invalid refresh replay capsule");
    }
  };
  return Object.freeze({
    async exchangeHandoff(input: {
      readonly handoffCode: string;
      readonly appExchangeVerifier: string;
      readonly installationSecret: string;
      readonly canonicalClientIp: string;
      readonly requestId: string;
    }) {
      const pair = issueMobileCredentialPair();
      const result = await repository.exchangeHandoff({
        networkHmac: clientNetworkHmac(input.canonicalClientIp, rateHmacKey),
        handoffHash: hashMobileProof(input.handoffCode),
        appExchangeChallenge: hashMobileProof(input.appExchangeVerifier),
        installationBinding: hashMobileProof(input.installationSecret),
        accessTokenHash: pair.access.hash,
        refreshTokenHash: pair.refresh.hash,
        requestId: input.requestId,
      });
      if (result.outcome !== "ISSUED") return result;
      return {
        ...result,
        accessToken: pair.access.raw,
        refreshToken: pair.refresh.raw,
      } as const;
    },

    async refresh(input: {
      readonly refreshToken: string;
      readonly installationSecret: string;
      readonly idempotencyKey: string;
      readonly requestId: string;
    }) {
      const pair = issueMobileCredentialPair();
      const predecessorRefreshHash = hashMobileProof(input.refreshToken);
      const installationBinding = hashMobileProof(input.installationSecret);
      const boundedIdempotencyKey = idempotencyKey(input.idempotencyKey);
      const aad = replayAad(
        predecessorRefreshHash,
        installationBinding,
        boundedIdempotencyKey,
      );
      const result = await repository.refresh({
        predecessorRefreshHash,
        installationBinding,
        accessTokenHash: pair.access.hash,
        refreshTokenHash: pair.refresh.hash,
        replayCapsule: sealReplay(pair.access.raw, pair.refresh.raw, aad),
        idempotencyKey: boundedIdempotencyKey,
        requestId: input.requestId,
      });
      if (result.outcome === "REPLAY") {
        const { replayCapsule, accessExpiresAt, refreshExpiresAt } = result;
        return {
          outcome: "REPLAY" as const,
          accessExpiresAt,
          refreshExpiresAt,
          ...openReplay(replayCapsule, aad),
        } as const;
      }
      if (result.outcome !== "ROTATED") return result;
      return {
        ...result,
        accessToken: pair.access.raw,
        refreshToken: pair.refresh.raw,
      } as const;
    },

    async authenticateBearer(authorization: string | null) {
      const result = await repository.authenticate({
        accessTokenHash: hashMobileProof(bearerCredential(authorization)),
      });
      if (result.outcome !== "AUTHORIZED") {
        throw new MobileSessionServiceError(
          "Mobile session is not authorized",
          result.outcome === "DENIED" ? "SESSION_REVOKED" : result.outcome,
        );
      }
      return {
        sessionId: result.sessionId,
        userId: result.userId,
        identityId: result.identityId,
        workspaceId: result.workspaceId,
        membershipId: result.membershipId,
        role: result.role,
      };
    },

    async listWorkspaces(authorization: string | null) {
      const result = await repository.listWorkspaces({
        accessTokenHash: hashMobileProof(bearerCredential(authorization)),
      });
      if (result.outcome !== "AUTHORIZED") {
        throw new MobileSessionServiceError(
          "Mobile session is not authorized",
          result.outcome === "DENIED" ? "SESSION_REVOKED" : result.outcome,
        );
      }
      return result.memberships;
    },

    async switchWorkspace(input: {
      readonly authorization: string | null;
      readonly targetWorkspaceId: string;
      readonly installationSecret: string;
      readonly idempotencyKey: string;
      readonly requestId: string;
    }) {
      const pair = issueMobileCredentialPair();
      const predecessorAccessHash = hashMobileProof(bearerCredential(input.authorization));
      const installationBinding = hashMobileProof(input.installationSecret);
      const boundedIdempotencyKey = idempotencyKey(input.idempotencyKey);
      const aad = Buffer.concat([
        Buffer.from("UPTECH_MOBILE_SWITCH_REPLAY_V1\0", "ascii"),
        Buffer.from(predecessorAccessHash),
        Buffer.from(installationBinding),
        Buffer.from(input.targetWorkspaceId, "ascii"),
        Buffer.from(boundedIdempotencyKey, "ascii"),
      ]);
      const result = await repository.switchWorkspace({
        accessTokenHash: predecessorAccessHash,
        targetWorkspaceId: input.targetWorkspaceId,
        installationBinding,
        accessTokenHashCandidate: pair.access.hash,
        refreshTokenHashCandidate: pair.refresh.hash,
        replayCapsule: sealReplay(pair.access.raw, pair.refresh.raw, aad),
        idempotencyKey: boundedIdempotencyKey,
        requestId: input.requestId,
      });
      if (result.outcome === "REPLAY") {
        return { outcome: "REPLAY" as const,
          accessExpiresAt: result.accessExpiresAt,
          refreshExpiresAt: result.refreshExpiresAt,
          ...openReplay(result.replayCapsule, aad) } as const;
      }
      if (result.outcome !== "ROTATED") return result;
      return {
        ...result,
        accessToken: pair.access.raw,
        refreshToken: pair.refresh.raw,
      } as const;
    },

    async revoke(authorization: string | null, requestId: string) {
      return repository.revoke({
        accessTokenHash: hashMobileProof(bearerCredential(authorization)),
        requestId,
      });
    },
  });
}

export type { MobilePlatform };
