import assert from "node:assert/strict";
import test from "node:test";

import type { SecretAdapter, SecretReference } from "../secrets/core.ts";
import { createGoogleDirectoryRefreshTokenAccessProvider } from "./google-directory-token.ts";

const lease = {
  jobId: "job-a",
  jobKind: "DIRECTORY_SYNC" as const,
  workspaceId: "workspace-a",
  serviceActor: "directory-worker",
  connectorId: "connector-a",
  sourceId: null,
  leaseFence: "123e4567-e89b-42d3-a456-426614174000",
  leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
};

test("Directory token provider exchanges only the stored server-side refresh credential", async () => {
  const reference = "secret://directory/workspace-a" as SecretReference;
  const reads: Array<{ reference: SecretReference; metadata: unknown }> = [];
  const refreshCredential = Uint8Array.from(
    Buffer.from("directory-refresh-token", "utf8"),
  );
  const secrets: SecretAdapter = {
    async create() { throw new Error("not used"); },
    async read(receivedReference, metadata) {
      reads.push({ reference: receivedReference, metadata });
      return refreshCredential;
    },
    async replace() { throw new Error("not used"); },
    async destroy() { throw new Error("not used"); },
  };
  const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const provider = createGoogleDirectoryRefreshTokenAccessProvider({
    secretAdapter: secrets,
    credentialReferenceForLease: async () => reference,
    oauthClient: {
      clientId: "directory-client.apps.googleusercontent.com",
      clientSecret: "server-only-client-secret",
    },
    fetch: async (url, init) => {
      requests.push({ url: requestUrl(url), init });
      return new Response(JSON.stringify({
        access_token: "directory-access-token",
        expires_in: 3600,
        scope: [
          "https://www.googleapis.com/auth/admin.directory.customer.readonly",
          "https://www.googleapis.com/auth/admin.directory.group.readonly",
          "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
          "https://www.googleapis.com/auth/admin.directory.user.readonly",
        ].join(" "),
        token_type: "Bearer",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(await provider.getAccessToken(lease), "directory-access-token");
  assert.deepEqual(reads, [{
    reference,
    metadata: {
      workspaceId: "workspace-a",
      serviceIdentity: "directory-worker",
      purpose: "GOOGLE_WORKSPACE_DIRECTORY_REFRESH_TOKEN",
      requestId: "job-a",
    },
  }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.href, "https://oauth2.googleapis.com/token");
  assert.equal(requests[0].init?.method, "POST");
  assert.equal(requests[0].init?.headers instanceof Headers ? requests[0].init.headers.get("content-type") : undefined, "application/x-www-form-urlencoded");
  assert.equal(requests[0].init?.cache, "no-store");
  assert.equal(requests[0].init?.redirect, "error");
  assert.equal(requests[0].init?.credentials, "omit");
  assert.equal(requests[0].init?.referrerPolicy, "no-referrer");
  assert.ok(requests[0].init?.signal instanceof AbortSignal);
  assert.deepEqual(
    Object.fromEntries(new URLSearchParams(requests[0].init?.body as string)),
    {
      grant_type: "refresh_token",
      client_id: "directory-client.apps.googleusercontent.com",
      client_secret: "server-only-client-secret",
      refresh_token: "directory-refresh-token",
    },
  );
  assert.deepEqual(
    [...refreshCredential],
    Array.from({ length: refreshCredential.byteLength }, () => 0),
  );
});

test("Directory token provider aborts a bounded token exchange and masks credentials", { timeout: 250 }, async () => {
  const refreshCredential = Uint8Array.from(Buffer.from("timeout-refresh-token"));
  let observedSignal: AbortSignal | null = null;
  const provider = createGoogleDirectoryRefreshTokenAccessProvider({
    secretAdapter: {
      async create() { throw new Error("not used"); },
      async read() { return refreshCredential; },
      async replace() { throw new Error("not used"); },
      async destroy() { throw new Error("not used"); },
    },
    credentialReferenceForLease: async () =>
      "secret://directory/workspace-a" as SecretReference,
    oauthClient: {
      clientId: "directory-client.apps.googleusercontent.com",
      clientSecret: "server-only-client-secret",
    },
    timeoutMs: 5,
    fetch: async (_url, init) => {
      observedSignal = init?.signal instanceof AbortSignal ? init.signal : null;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("timeout-refresh-token server-only-client-secret"));
        }, { once: true });
      });
    },
  });

  await assert.rejects(provider.getAccessToken(lease), (error: unknown) => {
    const rendered = error instanceof Error ? (error.stack ?? error.message) : String(error);
    assert.equal(error instanceof Error ? error.message : String(error),
      "Google Directory access token could not be resolved");
    assert.doesNotMatch(rendered, /timeout-refresh-token|server-only-client-secret/u);
    return true;
  });
  const finalSignal = observedSignal as AbortSignal | null;
  assert.ok(finalSignal instanceof AbortSignal);
  assert.equal(finalSignal?.aborted, true);
  assert.deepEqual([...refreshCredential], Array(refreshCredential.byteLength).fill(0));
});

test("Directory token provider fails closed before network access when the secret provider is unavailable", async () => {
  let fetchCalls = 0;
  const provider = createGoogleDirectoryRefreshTokenAccessProvider({
    secretAdapter: {
      async create() { throw new Error("not used"); },
      async read() {
        throw new Error("provider detail containing directory-refresh-token");
      },
      async replace() { throw new Error("not used"); },
      async destroy() { throw new Error("not used"); },
    },
    credentialReferenceForLease: async () =>
      "secret://directory/workspace-a" as SecretReference,
    oauthClient: {
      clientId: "directory-client.apps.googleusercontent.com",
      clientSecret: "server-only-client-secret",
    },
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("must not call token endpoint");
    },
  });

  await assert.rejects(
    provider.getAccessToken(lease),
    (error: unknown) => {
      assert.equal(
        error instanceof Error ? error.message : String(error),
        "Google Directory access token could not be resolved",
      );
      assert.doesNotMatch(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        /directory-refresh-token|server-only-client-secret/u,
      );
      return true;
    },
  );
  assert.equal(fetchCalls, 0);
});

test("Directory token provider sanitizes token endpoint failures and clears refresh credential bytes", async () => {
  const refreshCredential = Uint8Array.from(
    Buffer.from("sensitive-refresh-credential", "utf8"),
  );
  const provider = createGoogleDirectoryRefreshTokenAccessProvider({
    secretAdapter: {
      async create() { throw new Error("not used"); },
      async read() { return refreshCredential; },
      async replace() { throw new Error("not used"); },
      async destroy() { throw new Error("not used"); },
    },
    credentialReferenceForLease: async () =>
      "secret://directory/workspace-a" as SecretReference,
    oauthClient: {
      clientId: "directory-client.apps.googleusercontent.com",
      clientSecret: "server-only-client-secret",
    },
    fetch: async () => new Response(
      JSON.stringify({
        error: "invalid_grant",
        error_description: "sensitive-refresh-credential was revoked",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    ),
  });

  await assert.rejects(
    provider.getAccessToken(lease),
    (error: unknown) => {
      assert.equal(
        error instanceof Error ? error.message : String(error),
        "Google Directory access token could not be resolved",
      );
      assert.doesNotMatch(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        /sensitive-refresh-credential|invalid_grant|server-only-client-secret/u,
      );
      return true;
    },
  );
  assert.deepEqual(
    [...refreshCredential],
    Array.from({ length: refreshCredential.byteLength }, () => 0),
  );
});

function requestUrl(value: URL | RequestInfo): URL {
  return new URL(value instanceof Request ? value.url : value);
}
