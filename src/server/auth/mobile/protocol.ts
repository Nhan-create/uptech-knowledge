import { createHash, randomBytes } from "node:crypto";

export class MobileProtocolError extends Error {
  override readonly name = "MobileProtocolError";
}

export type MobilePlatform = "ANDROID" | "IOS";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function canonicalProof(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new MobileProtocolError("Invalid mobile proof");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== value) {
    throw new MobileProtocolError("Invalid mobile proof");
  }
  return value;
}

function proofBytes(value: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(canonicalProof(value), "base64url"));
}

function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  ) {
    throw new MobileProtocolError("Invalid request identifier");
  }
  return value;
}

export function parseMobileTransactionBody(value: unknown): {
  readonly platform: MobilePlatform;
  readonly appExchangeChallenge: Uint8Array;
  readonly installationBinding: Uint8Array;
  readonly requestId: string;
} {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "platform",
      "app_exchange_challenge",
      "installation_binding",
      "request_id",
    ]) ||
    (value.platform !== "ANDROID" && value.platform !== "IOS")
  ) {
    throw new MobileProtocolError("Invalid mobile transaction request");
  }
  return {
    platform: value.platform,
    appExchangeChallenge: proofBytes(value.app_exchange_challenge),
    installationBinding: proofBytes(value.installation_binding),
    requestId: uuid(value.request_id),
  };
}

export function parseHandoffExchangeBody(value: unknown): {
  readonly handoffCode: string;
  readonly appExchangeVerifier: string;
  readonly installationSecret: string;
} {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "handoff_code",
      "app_exchange_verifier",
      "installation_secret",
    ])
  ) {
    throw new MobileProtocolError("Invalid handoff exchange request");
  }
  return {
    handoffCode: canonicalProof(value.handoff_code),
    appExchangeVerifier: canonicalProof(value.app_exchange_verifier),
    installationSecret: canonicalProof(value.installation_secret),
  };
}

export function parseRefreshBody(value: unknown): {
  readonly refreshToken: string;
} {
  if (!isRecord(value) || !hasExactKeys(value, ["refresh_token"])) {
    throw new MobileProtocolError("Invalid refresh request");
  }
  return { refreshToken: canonicalProof(value.refresh_token) };
}

export function parseWorkspaceSwitchBody(value: unknown): {
  readonly targetWorkspaceId: string;
  readonly installationSecret: string;
} {
  if (!isRecord(value) || !hasExactKeys(value, [
    "target_workspace_id", "installation_secret",
  ])) {
    throw new MobileProtocolError("Invalid workspace switch request");
  }
  return {
    targetWorkspaceId: uuid(value.target_workspace_id),
    installationSecret: canonicalProof(value.installation_secret),
  };
}

export function hashMobileProof(value: string): Uint8Array {
  return Uint8Array.from(
    createHash("sha256").update(canonicalProof(value), "ascii").digest(),
  );
}

export interface MobileCredential {
  readonly raw: string;
  readonly hash: Uint8Array;
}

function issueCredential(): MobileCredential {
  const raw = randomBytes(32).toString("base64url");
  const credential = { hash: hashMobileProof(raw) } as {
    raw: string;
    hash: Uint8Array;
  };
  Object.defineProperty(credential, "raw", {
    configurable: false,
    enumerable: false,
    value: raw,
    writable: false,
  });
  return Object.freeze(credential);
}

export function issueMobileCredentialPair(): {
  readonly access: MobileCredential;
  readonly refresh: MobileCredential;
} {
  return Object.freeze({ access: issueCredential(), refresh: issueCredential() });
}
