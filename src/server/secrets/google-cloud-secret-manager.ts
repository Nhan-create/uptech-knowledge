import { createHash, randomUUID } from "node:crypto";

import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";

import {
  SecretOperationError,
  type ApprovedSecretProviderRegistration,
  type SecretAdapter,
  type SecretOperationMetadata,
  type SecretReference,
} from "./core.ts";

const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const SECRET_MANAGER_BASE_URL = "https://secretmanager.googleapis.com/v1";
const OPAQUE_REFERENCE_PREFIX = "gcp-sm:v1:";
const PROVIDER_ID = "google-cloud-secret-manager";
const REQUEST_TIMEOUT_MS = 10_000;

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const WORKLOAD_IDENTITY_PROVIDER =
  /^https:\/\/iam\.googleapis\.com\/projects\/\d{6,20}\/locations\/global\/workloadIdentityPools\/[a-z0-9-]{4,63}\/providers\/[a-z0-9-]{4,63}$/;
const SERVICE_ACCOUNT_EMAIL =
  /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
const SECRET_ID = /^uptech-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface GoogleCloudSecretManagerConfiguration {
  readonly projectId: string;
  readonly workloadIdentityProvider: string;
  readonly serviceAccountEmail: string;
}

export interface GoogleCloudSecretManagerDependencies {
  readonly fetch?: typeof globalThis.fetch;
  readonly accessTokenProvider?: () => Promise<string>;
}

interface GoogleAccessTokenClient {
  getAccessToken(): Promise<{ token?: string | null }>;
}

export interface VercelGoogleCloudExternalAccountOptions {
  readonly type: "external_account";
  readonly audience: string;
  readonly subject_token_type: "urn:ietf:params:oauth:token-type:jwt";
  readonly token_url: "https://sts.googleapis.com/v1/token";
  readonly service_account_impersonation_url: string;
  readonly scopes: string[];
  readonly subject_token_supplier: {
    getSubjectToken(): Promise<string>;
  };
}

export interface VercelGoogleCloudAccessTokenDependencies {
  readonly getVercelOidcToken?: (options: {
    readonly audience: string;
    readonly expirationBufferMs: number;
  }) => Promise<string>;
  readonly createExternalAccountClient?: (
    options: VercelGoogleCloudExternalAccountOptions,
  ) => GoogleAccessTokenClient | null;
}

function unavailable(): SecretOperationError {
  return new SecretOperationError("Secret provider operation failed");
}

function validateConfiguration(
  configuration: GoogleCloudSecretManagerConfiguration,
): GoogleCloudSecretManagerConfiguration {
  if (
    typeof configuration !== "object" ||
    configuration === null ||
    Object.keys(configuration).length !== 3 ||
    !Object.hasOwn(configuration, "projectId") ||
    !Object.hasOwn(configuration, "workloadIdentityProvider") ||
    !Object.hasOwn(configuration, "serviceAccountEmail") ||
    !PROJECT_ID.test(configuration.projectId) ||
    !WORKLOAD_IDENTITY_PROVIDER.test(configuration.workloadIdentityProvider) ||
    !SERVICE_ACCOUNT_EMAIL.test(configuration.serviceAccountEmail)
  ) {
    throw new SecretOperationError("Secret provider configuration is invalid");
  }

  return Object.freeze({
    projectId: configuration.projectId,
    workloadIdentityProvider: configuration.workloadIdentityProvider,
    serviceAccountEmail: configuration.serviceAccountEmail,
  });
}

function requireMetadata(metadata: SecretOperationMetadata): SecretOperationMetadata {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    ![metadata.workspaceId, metadata.serviceIdentity, metadata.purpose, metadata.requestId].every(
      (value) =>
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 512 &&
        !value.includes("\0"),
    )
  ) {
    throw unavailable();
  }

  return metadata;
}

function requireValue(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw unavailable();
  }

  return Uint8Array.from(value);
}

function opaqueReferenceFor(secretId: string): SecretReference {
  return `${OPAQUE_REFERENCE_PREFIX}${secretId}` as SecretReference;
}

function secretIdFromReference(reference: SecretReference): string {
  if (typeof reference !== "string" || !reference.startsWith(OPAQUE_REFERENCE_PREFIX)) {
    throw unavailable();
  }

  const secretId = reference.slice(OPAQUE_REFERENCE_PREFIX.length);
  if (!SECRET_ID.test(secretId)) {
    throw unavailable();
  }

  return secretId;
}

function encodeValue(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function decodeValue(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length === 0 || !BASE64.test(value)) {
    throw unavailable();
  }

  const decoded = Uint8Array.from(Buffer.from(value, "base64"));
  if (decoded.byteLength === 0) {
    throw unavailable();
  }

  return decoded;
}

function correlationReason(metadata: SecretOperationMetadata): string {
  const material = [
    metadata.workspaceId,
    metadata.serviceIdentity,
    metadata.purpose,
    metadata.requestId,
  ].join("\0");
  return `uptech-secret-${createHash("sha256").update(material, "utf8").digest("hex")}`;
}

function secretResource(configuration: GoogleCloudSecretManagerConfiguration, secretId: string): string {
  return `projects/${configuration.projectId}/secrets/${secretId}`;
}

function requireSecretResource(value: unknown, expected: string): void {
  if (value !== expected) {
    throw unavailable();
  }
}

function versionNumber(value: unknown, secret: string): bigint {
  if (typeof value !== "string") {
    throw unavailable();
  }

  const prefix = `${secret}/versions/`;
  const candidate = value.slice(prefix.length);
  if (!value.startsWith(prefix) || !/^[1-9]\d*$/.test(candidate)) {
    throw unavailable();
  }

  return BigInt(candidate);
}

export function createVercelGoogleCloudAccessTokenProvider(
  configuration: GoogleCloudSecretManagerConfiguration,
  dependencies: VercelGoogleCloudAccessTokenDependencies = {},
): () => Promise<string> {
  const safeConfiguration = validateConfiguration(configuration);
  const getSubjectToken = dependencies.getVercelOidcToken ?? getVercelOidcToken;
  const createClient = dependencies.createExternalAccountClient ??
    ((options: VercelGoogleCloudExternalAccountOptions) =>
      ExternalAccountClient.fromJSON(options));
  let client: GoogleAccessTokenClient | undefined;

  return async () => {
    try {
      if (client === undefined) {
        const configured = createClient({
          type: "external_account",
          // Google STS requires the canonical full resource name without the
          // HTTPS scheme. The Vercel subject token below intentionally uses
          // the HTTPS provider URL as its anti-confused-deputy audience.
          audience: safeConfiguration.workloadIdentityProvider.replace(
            /^https:/u,
            "",
          ),
          subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
          token_url: "https://sts.googleapis.com/v1/token",
          service_account_impersonation_url:
            `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(safeConfiguration.serviceAccountEmail)}:generateAccessToken`,
          scopes: [GOOGLE_CLOUD_PLATFORM_SCOPE],
          subject_token_supplier: {
            getSubjectToken: async () =>
              getSubjectToken({
                audience: safeConfiguration.workloadIdentityProvider,
                expirationBufferMs: 60_000,
              }),
          },
        });
        if (configured === null) {
          throw unavailable();
        }
        client = configured;
      }

      const { token } = await client.getAccessToken();
      if (typeof token !== "string" || token.length === 0) {
        throw unavailable();
      }
      return token;
    } catch {
      throw unavailable();
    }
  };
}

export class GoogleCloudSecretManagerAdapter implements SecretAdapter {
  private readonly configuration: GoogleCloudSecretManagerConfiguration;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly accessTokenProvider: () => Promise<string>;
  private readonly newUuid: () => string;

  constructor(
    configuration: GoogleCloudSecretManagerConfiguration,
    dependencies: GoogleCloudSecretManagerDependencies = {},
    newUuid: () => string = randomUUID,
  ) {
    this.configuration = validateConfiguration(configuration);
    this.fetcher = dependencies.fetch ?? globalThis.fetch;
    this.accessTokenProvider =
      dependencies.accessTokenProvider ??
      createVercelGoogleCloudAccessTokenProvider(this.configuration);
    this.newUuid = newUuid;
  }

  async create(value: Uint8Array, metadata: SecretOperationMetadata): Promise<SecretReference> {
    let secretValue: Uint8Array | undefined;
    try {
      secretValue = requireValue(value);
      const operationMetadata = requireMetadata(metadata);
      const secretId = `uptech-${this.newUuid()}`;
      if (!SECRET_ID.test(secretId)) {
        throw unavailable();
      }
      const secret = secretResource(this.configuration, secretId);
      let secretPossiblyCreated = false;

      try {
        secretPossiblyCreated = true;
        const created = await this.requestJson(
          "POST",
          `projects/${this.configuration.projectId}/secrets?secretId=${secretId}`,
          { replication: { automatic: {} } },
          operationMetadata,
        );
        requireSecretResource(created.name, secret);
        await this.addVersion(secret, secretValue, operationMetadata);
      } catch {
        if (secretPossiblyCreated) {
          await this.deleteSecretQuietly(secret, operationMetadata);
        }
        throw unavailable();
      }

      return opaqueReferenceFor(secretId);
    } catch {
      throw unavailable();
    } finally {
      secretValue?.fill(0);
    }
  }

  async read(reference: SecretReference, metadata: SecretOperationMetadata): Promise<Uint8Array> {
    try {
      const secret = secretResource(this.configuration, secretIdFromReference(reference));
      const result = await this.requestJson(
        "GET",
        `${secret}/versions/latest:access`,
        undefined,
        requireMetadata(metadata),
      );
      versionNumber(result.name, secret);
      return decodeValue((result.payload as Record<string, unknown> | undefined)?.data);
    } catch {
      throw unavailable();
    }
  }

  async replace(
    reference: SecretReference,
    value: Uint8Array,
    metadata: SecretOperationMetadata,
  ): Promise<void> {
    let secretValue: Uint8Array | undefined;
    try {
      const secret = secretResource(this.configuration, secretIdFromReference(reference));
      const operationMetadata = requireMetadata(metadata);
      secretValue = requireValue(value);
      await this.destroyPriorAccessibleVersions(secret, operationMetadata);
      await this.addVersion(secret, secretValue, operationMetadata);
    } catch {
      throw unavailable();
    } finally {
      secretValue?.fill(0);
    }
  }

  async destroy(reference: SecretReference, metadata: SecretOperationMetadata): Promise<void> {
    try {
      const secret = secretResource(this.configuration, secretIdFromReference(reference));
      await this.requestJson("DELETE", secret, undefined, requireMetadata(metadata));
    } catch {
      throw unavailable();
    }
  }

  private async addVersion(
    secret: string,
    value: Uint8Array,
    metadata: SecretOperationMetadata,
  ): Promise<void> {
    const result = await this.requestJson(
      "POST",
      `${secret}:addVersion`,
      { payload: { data: encodeValue(value) } },
      metadata,
    );
    versionNumber(result.name, secret);
  }

  private async destroyPriorAccessibleVersions(
    secret: string,
    metadata: SecretOperationMetadata,
  ): Promise<void> {
    let pageToken: string | undefined;
    do {
      const query = pageToken === undefined ? "" : `?pageToken=${encodeURIComponent(pageToken)}`;
      const result = await this.requestJson("GET", `${secret}/versions${query}`, undefined, metadata);
      if (!Array.isArray(result.versions)) {
        throw unavailable();
      }

      for (const version of result.versions) {
        if (typeof version !== "object" || version === null) {
          throw unavailable();
        }
        const record = version as Record<string, unknown>;
        const candidate = versionNumber(record.name, secret);
        if (
          record.state !== "ENABLED" &&
          record.state !== "DISABLED" &&
          record.state !== "DESTROYED"
        ) {
          throw unavailable();
        }
        if (record.state !== "DESTROYED") {
          await this.requestJson("POST", `${secret}/versions/${candidate}:destroy`, {}, metadata);
        }
      }

      pageToken = typeof result.nextPageToken === "string" && result.nextPageToken.length > 0
        ? result.nextPageToken
        : undefined;
    } while (pageToken !== undefined);
  }

  private async deleteSecretQuietly(
    secret: string,
    metadata: SecretOperationMetadata,
  ): Promise<void> {
    try {
      await this.requestJson("DELETE", secret, undefined, metadata);
    } catch {
      // The original operation error is intentionally preserved and no provider detail is logged.
    }
  }

  private async requestJson(
    method: "DELETE" | "GET" | "POST",
    resource: string,
    body: unknown,
    metadata: SecretOperationMetadata,
  ): Promise<Record<string, unknown>> {
    const accessToken = await this.accessTokenProvider();
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw unavailable();
    }
    const headers = new Headers({
      authorization: `Bearer ${accessToken}`,
      "x-goog-request-reason": correlationReason(metadata),
    });
    if (body !== undefined) {
      headers.set("content-type", "application/json");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetcher(`${SECRET_MANAGER_BASE_URL}/${resource}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (response.redirected) {
        throw unavailable();
      }
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw unavailable();
    }

    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      throw unavailable();
    }
    return result as Record<string, unknown>;
  }
}

export function createGoogleCloudSecretManagerRegistration(
  configuration: GoogleCloudSecretManagerConfiguration,
): ApprovedSecretProviderRegistration {
  const safeConfiguration = validateConfiguration(configuration);
  return Object.freeze({
    providerId: PROVIDER_ID,
    configurationPresent: true,
    createAdapter: () => new GoogleCloudSecretManagerAdapter(safeConfiguration),
  });
}

export { SecretOperationError };
