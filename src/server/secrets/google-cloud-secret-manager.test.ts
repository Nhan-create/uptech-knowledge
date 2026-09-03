import assert from "node:assert/strict";
import test from "node:test";

import {
  GoogleCloudSecretManagerAdapter,
  SecretOperationError,
  createGoogleCloudSecretManagerRegistration,
  createVercelGoogleCloudAccessTokenProvider,
  type GoogleCloudSecretManagerDependencies,
} from "./google-cloud-secret-manager.ts";
import type { SecretOperationMetadata, SecretReference } from "./core.ts";

const metadata: SecretOperationMetadata = {
  workspaceId: "workspace-1",
  serviceIdentity: "directory-sync",
  purpose: "GOOGLE_DIRECTORY",
  requestId: "request-1",
};

const configuration = {
  projectId: "uptech-secrets-prod",
  workloadIdentityProvider:
    "https://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel",
  serviceAccountEmail: "secret-runtime@uptech-secrets-prod.iam.gserviceaccount.com",
};

type RecordedRequest = { readonly url: string; readonly init: RequestInit };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function dependencies(
  responses: Array<Response | Error>,
): GoogleCloudSecretManagerDependencies & { readonly requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    accessTokenProvider: async () => "temporary-access-token",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      const next = responses.shift();
      if (next === undefined) {
        throw new Error("unexpected provider call");
      }
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
  };
}

test("create produces an opaque reference and stores bytes only in a secret version", async () => {
  const fake = dependencies([
    response({
      name: "projects/uptech-secrets-prod/secrets/uptech-123e4567-e89b-12d3-a456-426614174000",
    }),
    response({
      name: "projects/uptech-secrets-prod/secrets/uptech-123e4567-e89b-12d3-a456-426614174000/versions/1",
    }),
  ]);
  const adapter = new GoogleCloudSecretManagerAdapter(configuration, fake, () =>
    "123e4567-e89b-12d3-a456-426614174000",
  );

  const reference = await adapter.create(Uint8Array.from([1, 2, 3]), metadata);

  assert.equal(reference, "gcp-sm:v1:uptech-123e4567-e89b-12d3-a456-426614174000");
  assert.doesNotMatch(reference, /uptech-secrets-prod|projects\//);
  assert.equal(fake.requests.length, 2);
  assert.match(fake.requests[0].url, /\/v1\/projects\/uptech-secrets-prod\/secrets\?secretId=uptech-123e4567-e89b-12d3-a456-426614174000$/);
  assert.equal(fake.requests[0].init.headers instanceof Headers, true);
  assert.equal((fake.requests[0].init.headers as Headers).get("authorization"), "Bearer temporary-access-token");
  const requestReason = (fake.requests[0].init.headers as Headers).get("x-goog-request-reason");
  assert.match(requestReason ?? "", /^uptech-secret-[a-f0-9]{64}$/);
  assert.doesNotMatch(requestReason ?? "", /workspace-1|directory-sync|GOOGLE_DIRECTORY|AQID/);
  assert.deepEqual(JSON.parse(String(fake.requests[1].init.body)), {
    payload: { data: "AQID" },
  });
});

test("read decodes the current provider version only when its resource matches the opaque reference", async () => {
  const fake = dependencies([
    response({
      name: "projects/uptech-secrets-prod/secrets/uptech-123e4567-e89b-12d3-a456-426614174000/versions/2",
      payload: { data: "BAU=" },
    }),
  ]);
  const adapter = new GoogleCloudSecretManagerAdapter(configuration, fake);

  const value = await adapter.read(
    "gcp-sm:v1:uptech-123e4567-e89b-12d3-a456-426614174000" as SecretReference,
    metadata,
  );

  assert.deepEqual(value, Uint8Array.from([4, 5]));
  assert.match(fake.requests[0].url, /\/versions\/latest:access$/);
});

test("replace destroys every prior accessible version before adding a new version", async () => {
  const fake = dependencies([
    response({
      versions: [
        {
          name: "projects/uptech-secrets-prod/secrets/uptech-123e4567-e89b-12d3-a456-426614174000/versions/1",
          state: "ENABLED",
        },
        {
          name: "projects/uptech-secrets-prod/secrets/uptech-123e4567-e89b-12d3-a456-426614174000/versions/2",
          state: "DISABLED",
        },
      ],
    }),
    response({}),
    response({}),
    response({
      name: "projects/uptech-secrets-prod/secrets/uptech-123e4567-e89b-12d3-a456-426614174000/versions/3",
    }),
    response({}),
  ]);
  const adapter = new GoogleCloudSecretManagerAdapter(configuration, fake);
  const reference = "gcp-sm:v1:uptech-123e4567-e89b-12d3-a456-426614174000" as SecretReference;

  await adapter.replace(reference, Uint8Array.from([6]), metadata);
  await adapter.destroy(reference, metadata);

  assert.match(fake.requests[0].url, /\/secrets\/uptech-123e4567-e89b-12d3-a456-426614174000\/versions$/);
  assert.match(fake.requests[1].url, /\/versions\/1:destroy$/);
  assert.match(fake.requests[2].url, /\/versions\/2:destroy$/);
  assert.match(fake.requests[3].url, /\/secrets\/uptech-123e4567-e89b-12d3-a456-426614174000:addVersion$/);
  assert.deepEqual(JSON.parse(String(fake.requests[3].init.body)), {
    payload: { data: "Bg==" },
  });
  assert.equal(fake.requests[4].init.method, "DELETE");
  assert.match(fake.requests[4].url, /\/secrets\/uptech-123e4567-e89b-12d3-a456-426614174000$/);
});

test("create deletes its empty secret when version creation fails", async () => {
  const fake = dependencies([
    response({
      name: "projects/uptech-secrets-prod/secrets/uptech-123e4567-e89b-12d3-a456-426614174000",
    }),
    response({ error: { message: "provider-private-detail" } }, 403),
    response({}),
  ]);
  const adapter = new GoogleCloudSecretManagerAdapter(configuration, fake, () =>
    "123e4567-e89b-12d3-a456-426614174000",
  );

  await assert.rejects(adapter.create(Uint8Array.from([1]), metadata), SecretOperationError);

  assert.equal(fake.requests[2].init.method, "DELETE");
  assert.match(fake.requests[2].url, /\/secrets\/uptech-123e4567-e89b-12d3-a456-426614174000$/);
});

test("create deletes the known random secret when create transport outcome is uncertain", async () => {
  const fake = dependencies([
    new Error("connection closed after the provider may have created the secret"),
    response({}),
  ]);
  const adapter = new GoogleCloudSecretManagerAdapter(configuration, fake, () =>
    "123e4567-e89b-12d3-a456-426614174000",
  );

  await assert.rejects(adapter.create(Uint8Array.from([1]), metadata), SecretOperationError);

  assert.equal(fake.requests.length, 2);
  assert.equal(fake.requests[1].init.method, "DELETE");
  assert.match(fake.requests[1].url, /\/secrets\/uptech-123e4567-e89b-12d3-a456-426614174000$/);
});

test("replace does not add a version when prior-version cleanup fails", async () => {
  const fake = dependencies([
    response({
      versions: [
        {
          name: "projects/uptech-secrets-prod/secrets/uptech-123e4567-e89b-12d3-a456-426614174000/versions/1",
          state: "ENABLED",
        },
      ],
    }),
    new Error("provider-private-cleanup-failure"),
  ]);
  const adapter = new GoogleCloudSecretManagerAdapter(configuration, fake);

  await assert.rejects(
    adapter.replace(
      "gcp-sm:v1:uptech-123e4567-e89b-12d3-a456-426614174000" as SecretReference,
      Uint8Array.from([6]),
      metadata,
    ),
    (error: unknown) => {
      assert.equal(error instanceof SecretOperationError, true);
      assert.doesNotMatch((error as Error).message, /provider-private-cleanup-failure/);
      return true;
    },
  );
  assert.equal(fake.requests.length, 2);
  assert.equal(fake.requests.some(({ url }) => url.includes(":addVersion")), false);
});

test("replace leaves no prior accessible version when adding the new version fails", async () => {
  const fake = dependencies([
    response({
      versions: [
        {
          name: "projects/uptech-secrets-prod/secrets/uptech-123e4567-e89b-12d3-a456-426614174000/versions/1",
          state: "ENABLED",
        },
      ],
    }),
    response({}),
    response({ error: { message: "provider-private-add-failure" } }, 403),
  ]);
  const adapter = new GoogleCloudSecretManagerAdapter(configuration, fake);

  await assert.rejects(
    adapter.replace(
      "gcp-sm:v1:uptech-123e4567-e89b-12d3-a456-426614174000" as SecretReference,
      Uint8Array.from([6]),
      metadata,
    ),
    SecretOperationError,
  );
  assert.match(fake.requests[0].url, /\/versions$/);
  assert.match(fake.requests[1].url, /\/versions\/1:destroy$/);
  assert.match(fake.requests[2].url, /:addVersion$/);
  assert.equal(fake.requests.length, 3);
});

test("rejects malformed metadata and non-opaque references before provider access", async () => {
  const fake = dependencies([]);
  const adapter = new GoogleCloudSecretManagerAdapter(configuration, fake);

  await assert.rejects(
    adapter.read(
      "projects/uptech-secrets-prod/secrets/other/versions/latest" as SecretReference,
      metadata,
    ),
    SecretOperationError,
  );
  await assert.rejects(
    adapter.create(Uint8Array.from([1]), { ...metadata, workspaceId: "" }),
    SecretOperationError,
  );
  assert.equal(fake.requests.length, 0);
});

test("masks provider failures and never exposes access tokens or provider response bodies", async () => {
  const fake = dependencies([
    response({ error: { message: "temporary-access-token provider-private-detail" } }, 403),
  ]);
  const adapter = new GoogleCloudSecretManagerAdapter(configuration, fake);

  await assert.rejects(
    adapter.destroy(
      "gcp-sm:v1:uptech-123e4567-e89b-12d3-a456-426614174000" as SecretReference,
      metadata,
    ),
    (error: unknown) => {
      assert.equal(error instanceof SecretOperationError, true);
      assert.doesNotMatch((error as Error).message, /temporary-access-token|provider-private-detail/);
      return true;
    },
  );
});

test("fails closed when the registration configuration is missing or invalid", () => {
  assert.throws(
    () => createGoogleCloudSecretManagerRegistration({} as never),
    /configuration/i,
  );
  assert.throws(
    () =>
      createGoogleCloudSecretManagerRegistration({
        ...configuration,
        serviceAccountEmail: "secret-runtime-@uptech-secrets-prod.iam.gserviceaccount.com",
      }),
    /configuration/i,
  );
  assert.throws(
    () =>
      createGoogleCloudSecretManagerRegistration({
        ...configuration,
        serviceAccountEmail: "service-account-key.json",
      }),
    /configuration/i,
  );
  assert.throws(
    () =>
      createGoogleCloudSecretManagerRegistration({
        ...configuration,
        workloadIdentityProvider:
          "//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel",
      }),
    /configuration/i,
  );
  assert.throws(
    () =>
      createGoogleCloudSecretManagerRegistration({
        ...configuration,
        privateKey: "long-lived-service-account-key",
      } as never),
    /configuration/i,
  );
});

test("registration identifies Google Cloud and constructs a working adapter without credentials", () => {
  const registration = createGoogleCloudSecretManagerRegistration(configuration);

  assert.equal(registration.providerId, "google-cloud-secret-manager");
  assert.equal(registration.configurationPresent, true);
  assert.equal(registration.createAdapter() instanceof GoogleCloudSecretManagerAdapter, true);
});

test("Vercel OIDC uses the provider URL for the subject token and the canonical resource name for Google STS", async () => {
  let externalAccountOptions:
    | {
        audience: string;
        subject_token_type: string;
        subject_token_supplier: { getSubjectToken(): Promise<string> };
      }
    | undefined;
  let vercelTokenOptions: unknown;
  const accessTokenProvider = createVercelGoogleCloudAccessTokenProvider(
    configuration,
    {
      getVercelOidcToken: async (options) => {
        vercelTokenOptions = options;
        return "vercel-oidc-token";
      },
      createExternalAccountClient(options) {
        externalAccountOptions = options;
        return {
          async getAccessToken() {
            assert.equal(
              await options.subject_token_supplier.getSubjectToken(),
              "vercel-oidc-token",
            );
            return { token: "gcp-short-lived-token" };
          },
        };
      },
    },
  );

  assert.equal(await accessTokenProvider(), "gcp-short-lived-token");
  assert.equal(
    externalAccountOptions?.audience,
    "//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel",
  );
  assert.equal(
    externalAccountOptions?.subject_token_type,
    "urn:ietf:params:oauth:token-type:jwt",
  );
  assert.deepEqual(vercelTokenOptions, {
    audience:
      "https://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel",
    expirationBufferMs: 60_000,
  });
});

test("uses the supplied short-lived token provider for every Secret Manager request", async () => {
  let tokenCalls = 0;
  const fake = dependencies([
    response({
      versions: [
        {
          name: "projects/uptech-secrets-prod/secrets/uptech-123e4567-e89b-12d3-a456-426614174000/versions/1",
          state: "DESTROYED",
        },
      ],
    }),
    response({
      name: "projects/uptech-secrets-prod/secrets/uptech-123e4567-e89b-12d3-a456-426614174000/versions/4",
    }),
  ]);
  const adapter = new GoogleCloudSecretManagerAdapter(configuration, {
    ...fake,
    accessTokenProvider: async () => `access-${++tokenCalls}`,
  });

  await adapter.replace(
    "gcp-sm:v1:uptech-123e4567-e89b-12d3-a456-426614174000" as SecretReference,
    Uint8Array.from([7]),
    metadata,
  );

  assert.equal(tokenCalls, 2);
  assert.equal((fake.requests[0].init.headers as Headers).get("authorization"), "Bearer access-1");
});
