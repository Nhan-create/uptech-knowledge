import type { LeasedJob } from "../jobs/core.ts";
import type { SecretAdapter, SecretReference } from "../secrets/core.ts";
import type { GoogleDirectoryAccessTokenProvider } from "./google-directory-http.ts";

export class GoogleDirectoryRefreshTokenError extends Error {
  override readonly name = "GoogleDirectoryRefreshTokenError";
}

export interface GoogleDirectoryOAuthClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface GoogleDirectoryRefreshTokenDependencies {
  readonly secretAdapter: SecretAdapter;
  /** Resolves a reference only from an already-authorized DIRECTORY_SYNC lease. */
  readonly credentialReferenceForLease: (lease: LeasedJob) => Promise<SecretReference>;
  readonly oauthClient: GoogleDirectoryOAuthClient;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

const GOOGLE_TOKEN_ENDPOINT = new URL("https://oauth2.googleapis.com/token");
const DIRECTORY_REFRESH_TOKEN_PURPOSE = "GOOGLE_WORKSPACE_DIRECTORY_REFRESH_TOKEN";
const DEFAULT_TOKEN_TIMEOUT_MS = 10_000;
const MAX_TOKEN_TIMEOUT_MS = 30_000;

function requireText(label: string, value: unknown, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximumLength ||
    value.includes("\0")
  ) {
    throw new GoogleDirectoryRefreshTokenError(`${label} is invalid`);
  }
  return value;
}

function requireDirectoryLease(lease: LeasedJob): LeasedJob {
  if (lease.jobKind !== "DIRECTORY_SYNC" || lease.sourceId !== null) {
    throw new GoogleDirectoryRefreshTokenError(
      "Directory refresh requires a DIRECTORY_SYNC lease",
    );
  }
  requireText("workspaceId", lease.workspaceId, 512);
  requireText("serviceActor", lease.serviceActor, 512);
  requireText("jobId", lease.jobId, 512);
  return lease;
}

function providerFailure(): GoogleDirectoryRefreshTokenError {
  return new GoogleDirectoryRefreshTokenError(
    "Google Directory access token could not be resolved",
  );
}

/**
 * Exchanges the DIRECTORY connector's refresh credential inside the worker.
 * The refresh credential and access token never leave this server-side boundary.
 */
export function createGoogleDirectoryRefreshTokenAccessProvider(
  dependencies: GoogleDirectoryRefreshTokenDependencies,
): GoogleDirectoryAccessTokenProvider {
  const fetch = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetch !== "function") {
    throw new GoogleDirectoryRefreshTokenError(
      "Google Directory token transport is not configured",
    );
  }
  const clientId = requireText("Google OAuth clientId", dependencies.oauthClient.clientId, 2_048);
  const clientSecret = requireText("Google OAuth clientSecret", dependencies.oauthClient.clientSecret, 2_048);
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TOKEN_TIMEOUT_MS
  ) {
    throw new GoogleDirectoryRefreshTokenError(
      "Google Directory token transport is not configured",
    );
  }

  return Object.freeze({
    async getAccessToken(lease: LeasedJob): Promise<string> {
      const directoryLease = requireDirectoryLease(lease);
      let refreshCredential: Uint8Array | undefined;
      try {
        const reference = await dependencies.credentialReferenceForLease(directoryLease);
        refreshCredential = await dependencies.secretAdapter.read(reference, {
          workspaceId: directoryLease.workspaceId,
          serviceIdentity: directoryLease.serviceActor,
          purpose: DIRECTORY_REFRESH_TOKEN_PURPOSE,
          requestId: directoryLease.jobId,
        });
        const refreshToken = requireText(
          "Google Directory refresh credential",
          new TextDecoder("utf-8", { fatal: true }).decode(refreshCredential),
          4_096,
        );
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
            method: "POST",
            headers: new Headers({
              "content-type": "application/x-www-form-urlencoded",
            }),
            body: new URLSearchParams({
              grant_type: "refresh_token",
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: refreshToken,
            }).toString(),
            cache: "no-store",
            redirect: "error",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!response.ok || response.redirected) {
          throw providerFailure();
        }
        const payload: unknown = await response.json();
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
          throw providerFailure();
        }
        return requireText(
          "Google Directory access token",
          (payload as Record<string, unknown>).access_token,
          8_192,
        );
      } catch (error) {
        if (error instanceof GoogleDirectoryRefreshTokenError) {
          throw error;
        }
        throw providerFailure();
      } finally {
        refreshCredential?.fill(0);
      }
    },
  });
}
