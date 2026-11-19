import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  SecretOperationError,
  type ApprovedSecretProviderRegistration,
  type SecretAdapter,
  type SecretReference,
} from "./core.ts";

const LOCAL_SECRET_PREFIX = "local-dev:v1:";
const ENVELOPE_SECRET_PREFIX = "envelope-kms:v1:";
const LOCAL_SECRET_ID =
  /^uptech-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type Environment = Readonly<Record<string, string | undefined>>;

function deriveLocalSecretKey(secretSeed: string): Buffer {
  return createHash("sha256")
    .update("UPTECH_LOCAL_DEV_SECRET_V1\0", "utf8")
    .update(secretSeed, "utf8")
    .digest();
}

function extractSecretId(reference: SecretReference): string {
  if (!reference.startsWith(LOCAL_SECRET_PREFIX)) {
    throw new SecretOperationError("Local secret reference is invalid");
  }
  const secretId = reference.slice(LOCAL_SECRET_PREFIX.length);
  if (!LOCAL_SECRET_ID.test(secretId)) {
    throw new SecretOperationError("Local secret identifier is invalid");
  }
  return secretId;
}

function sealLocalSecret(
  key: Buffer,
  secretId: string,
  plaintext: Uint8Array,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(secretId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: tag.toString("base64url"),
  });
}

function unsealLocalSecret(
  key: Buffer,
  secretId: string,
  encoded: string,
): Uint8Array {
  const parsed = JSON.parse(encoded) as {
    readonly iv: string;
    readonly ciphertext: string;
    readonly tag: string;
  };
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parsed.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(secretId, "utf8"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
  return Uint8Array.from(
    Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, "base64url")),
      decipher.final(),
    ]),
  );
}

/**
 * Resolves an encrypted local-only secret provider solely in local development
 * when Vercel production and GCP Secret Manager are unavailable.
 */
export function resolveLocalDevSecretProviderRegistration(
  environment: Environment = process.env,
): ApprovedSecretProviderRegistration | null {
  if (
    environment.NODE_ENV !== "development" ||
    environment.VERCEL === "1" ||
    environment.VERCEL_ENV === "production"
  ) {
    return null;
  }
  const secretDir = environment.UPTECH_LOCAL_SECRET_DIR?.trim();
  const secretSeed = environment.UPTECH_GOOGLE_LOGIN_PKCE_KEY?.trim();
  if (!secretDir || !secretSeed) {
    return null;
  }

  const key = deriveLocalSecretKey(secretSeed);
  return Object.freeze({
    providerId: "local-dev-secret-manager",
    configurationPresent: true,
    createAdapter(): SecretAdapter {
      const adapter: SecretAdapter = {
        async create(value: Uint8Array) {
          const secretId = `uptech-${randomUUID()}`;
          await mkdir(secretDir, { recursive: true });
          await writeFile(
            join(secretDir, `${secretId}.json`),
            sealLocalSecret(key, secretId, value),
            "utf8",
          );
          return `${LOCAL_SECRET_PREFIX}${secretId}` as SecretReference;
        },
        async read(reference: SecretReference) {
          const secretId = extractSecretId(reference);
          const encoded = await readFile(
            join(secretDir, `${secretId}.json`),
            "utf8",
          );
          return unsealLocalSecret(key, secretId, encoded);
        },
        async replace(reference: SecretReference, value: Uint8Array) {
          const secretId = extractSecretId(reference);
          await mkdir(secretDir, { recursive: true });
          await writeFile(
            join(secretDir, `${secretId}.json`),
            sealLocalSecret(key, secretId, value),
            "utf8",
          );
        },
        async destroy(reference: SecretReference) {
          const secretId = extractSecretId(reference);
          await unlink(join(secretDir, `${secretId}.json`)).catch(() => {});
        },
      };
      return Object.freeze(adapter);
    },
  });
}

function deriveEnvelopeKmsKey(secretSeed: string): Buffer {
  return createHash("sha256")
    .update("UPTECH_ENVELOPE_KMS_SECRET_V1\0", "utf8")
    .update(secretSeed, "utf8")
    .digest();
}

/**
 * Resolves an AES-256-GCM self-contained envelope secret provider using the
 * deployment's 256-bit `UPTECH_GOOGLE_LOGIN_PKCE_KEY` when external Google
 * Cloud Secret Manager Billing/WIF variables are not configured.
 */
export function resolveEncryptedEnvelopeSecretProviderRegistration(
  environment: Environment = process.env,
): ApprovedSecretProviderRegistration | null {
  const hasGcpConfig = Boolean(
    environment.UPTECH_GCP_SECRET_MANAGER_PROJECT_ID?.trim() ||
      environment.UPTECH_GCP_WORKLOAD_IDENTITY_PROVIDER?.trim() ||
      environment.UPTECH_GCP_SECRET_MANAGER_SERVICE_ACCOUNT_EMAIL?.trim(),
  );
  if (hasGcpConfig) {
    return null;
  }

  const secretSeed = environment.UPTECH_GOOGLE_LOGIN_PKCE_KEY?.trim();
  if (!secretSeed || secretSeed.length < 32) {
    return null;
  }

  const key = deriveEnvelopeKmsKey(secretSeed);
  const aadBytes = Buffer.from("UPTECH_DIRECTORY_REFRESH_TOKEN_V1", "utf8");

  return Object.freeze({
    providerId: "envelope-kms-secret-manager",
    configurationPresent: true,
    createAdapter(): SecretAdapter {
      const adapter: SecretAdapter = {
        async create(value: Uint8Array) {
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", key, iv);
          cipher.setAAD(aadBytes);
          const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
          const tag = cipher.getAuthTag();
          return `${ENVELOPE_SECRET_PREFIX}${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}` as SecretReference;
        },
        async read(reference: SecretReference) {
          if (!reference.startsWith(ENVELOPE_SECRET_PREFIX)) {
            throw new SecretOperationError("Envelope secret reference is invalid");
          }
          const parts = reference.slice(ENVELOPE_SECRET_PREFIX.length).split(".");
          if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
            throw new SecretOperationError("Envelope secret payload is malformed");
          }
          const decipher = createDecipheriv(
            "aes-256-gcm",
            key,
            Buffer.from(parts[0], "base64url"),
          );
          decipher.setAAD(aadBytes);
          decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
          return Uint8Array.from(
            Buffer.concat([
              decipher.update(Buffer.from(parts[1], "base64url")),
              decipher.final(),
            ]),
          );
        },
        async replace(reference: SecretReference) {
          if (!reference.startsWith(ENVELOPE_SECRET_PREFIX)) {
            throw new SecretOperationError("Envelope secret reference is invalid");
          }
        },
        async destroy(reference: SecretReference) {
          if (!reference.startsWith(ENVELOPE_SECRET_PREFIX)) {
            throw new SecretOperationError("Envelope secret reference is invalid");
          }
        },
      };
      return Object.freeze(adapter);
    },
  });
}
