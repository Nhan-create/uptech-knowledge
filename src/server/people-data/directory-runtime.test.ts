import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApprovedSecretProviderRegistration,
  SecretAdapter,
  SecretReference,
} from "../secrets/core.ts";
import { DirectoryConnectionDeniedError, type ConnectGoogleDirectoryInput } from "./directory-connection.ts";
import {
  createConfiguredGoogleCloudDirectoryRuntime,
  createGoogleCloudDirectoryRuntime,
  createDirectoryRuntime,
  loadGoogleCloudDirectoryRuntimeConfiguration,
} from "./directory-runtime.ts";

const DIRECTORY_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
] as const;

const LEASE = {
  jobId: "job-a",
  jobKind: "DIRECTORY_SYNC" as const,
  workspaceId: "tenant-a",
  serviceActor: "directory-worker",
  connectorId: "directory-a",
  sourceId: null,
  leaseFence: "123e4567-e89b-42d3-a456-426614174000",
  leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
};

function connectionInput(): Omit<ConnectGoogleDirectoryInput, "secretAdapter"> {
  return {
    setup: {
      workspaceId: "tenant-a",
      connectorId: "directory-a",
      identityId: "identity-a",
      role: "OWNER",
      requestId: "00000000-0000-4000-8000-000000000001",
      serviceIdentity: "uptech-api",
    },
    google: {
      customerId: "C0123abc",
      providerSubject: "tenant-a-google-subject",
      hostedDomain: "tenant-a.example",
      verifiedDomains: [{ normalizedDomain: "tenant-a.example", kind: "PRIMARY", providerParentDomain: null, verified: true }],
      refreshToken: Uint8Array.from(Buffer.from("refresh-token", "utf8")),
      grantedScopes: DIRECTORY_SCOPES,
      isAdmin: true,
      isDelegatedAdmin: false,
      readProbes: {
        customer: true,
        users: true,
        groups: true,
        groupMembers: true,
        orgUnits: true,
      },
    },
    repository: {
      async activate() {
        return {
          outcome: "ACTIVATED" as const,
          previousCredentialReference: null,
        };
      },
    },
  };
}

function registration(adapter: SecretAdapter): ApprovedSecretProviderRegistration {
  return {
    providerId: "google-cloud-secret-manager",
    configurationPresent: true,
    createAdapter() { return adapter; },
  };
}

test("Google Cloud Directory runtime configuration requires workload identity metadata", () => {
  assert.throws(
    () => loadGoogleCloudDirectoryRuntimeConfiguration({}),
    /Google Cloud Directory secret configuration is missing/i,
  );

  assert.deepEqual(
    loadGoogleCloudDirectoryRuntimeConfiguration({
      UPTECH_GCP_SECRET_MANAGER_PROJECT_ID: " uptech-secrets-prod ",
      UPTECH_GCP_WORKLOAD_IDENTITY_PROVIDER:
        " https://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel ",
      UPTECH_GCP_SECRET_MANAGER_SERVICE_ACCOUNT_EMAIL:
        " secret-runtime@uptech-secrets-prod.iam.gserviceaccount.com ",
    }),
    {
      projectId: "uptech-secrets-prod",
      workloadIdentityProvider:
        "https://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel",
      serviceAccountEmail:
        "secret-runtime@uptech-secrets-prod.iam.gserviceaccount.com",
    },
  );
});

test("Google Cloud Directory runtime constructs its adapter from the registered provider", () => {
  assert.throws(
    () => createGoogleCloudDirectoryRuntime({
      googleCloudSecretManager: {
        projectId: "",
        workloadIdentityProvider:
          "https://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel",
        serviceAccountEmail:
          "secret-runtime@uptech-secrets-prod.iam.gserviceaccount.com",
      },
      oauthClient: { clientId: "client-id", clientSecret: "client-secret" },
      nextId: () => "00000000-0000-4000-8000-000000000001",
    }),
    /configuration/i,
  );
});

test("configured Google Cloud Directory runtime fails closed when deployment metadata is absent", () => {
  assert.throws(
    () => createConfiguredGoogleCloudDirectoryRuntime({
      oauthClient: { clientId: "client-id", clientSecret: "client-secret" },
      nextId: () => "00000000-0000-4000-8000-000000000001",
    }, {}),
    /Google Cloud Directory secret configuration is missing/i,
  );
});

test("Directory runtime uses the approved adapter boundary before activating a connection", async () => {
  let activationAttempts = 0;
  const runtime = createDirectoryRuntime({
    secretProviderRegistration: registration({
      async create() { return "" as SecretReference; },
      async read() { throw new Error("not used"); },
      async replace() { throw new Error("not used"); },
      async destroy() {},
    }),
    oauthClient: { clientId: "client-id", clientSecret: "client-secret" },
    nextId: () => "00000000-0000-4000-8000-000000000002",
  });

  await assert.rejects(
    runtime.connect({
      ...connectionInput(),
      repository: {
        async activate() {
          activationAttempts += 1;
          return {
            outcome: "ACTIVATED" as const,
            previousCredentialReference: null,
          };
        },
      },
    }),
    DirectoryConnectionDeniedError,
  );
  assert.equal(activationAttempts, 0);
});

test("Directory runtime preserves the opaque-reference refresh-token-to-read-only-sync flow", async () => {
  const credentialReference = "secret://directory/tenant-a" as SecretReference;
  let storedRefreshToken: Uint8Array | undefined;
  const runtime = createDirectoryRuntime({
    secretProviderRegistration: registration({
      async create(value) {
        storedRefreshToken = Uint8Array.from(value);
        return credentialReference;
      },
      async read(reference) {
        assert.equal(reference, credentialReference);
        return Uint8Array.from(storedRefreshToken ?? []);
      },
      async replace() { throw new Error("not used"); },
      async destroy() {},
    }),
    oauthClient: { clientId: "client-id", clientSecret: "client-secret" },
    nextId: (() => {
      let next = 2;
      return () => `00000000-0000-4000-8000-00000000000${next++}`;
    })(),
    fetch: async (url) => {
      const request = new URL(url instanceof Request ? url.url : url);
      if (request.href === "https://oauth2.googleapis.com/token") {
        return json({ access_token: "directory-access-token" });
      }
      if (request.pathname.endsWith("/customers/my_customer")) {
        return json({ id: "C0123abc", customerDomain: "tenant-a.example" });
      }
      if (request.pathname.endsWith("/orgunits")) return json({ organizationUnits: [] });
      if (request.pathname.endsWith("/users")) return json({ users: [] });
      if (request.pathname.endsWith("/groups")) return json({ groups: [] });
      throw new Error(`unexpected request ${request.href}`);
    },
  });

  assert.deepEqual(await runtime.connect(connectionInput()), {
    kind: "connected",
    workspaceId: "tenant-a",
    connectorId: "directory-a",
    customerId: "C0123abc",
  });
  assert.deepEqual(storedRefreshToken, Uint8Array.from(Buffer.from("refresh-token", "utf8")));

  const result = await runtime.createSyncJobHandler()({
    lease: LEASE,
    client: {
      async query(text) {
        if (text.includes("resolve_directory_connector_credential_reference")) {
          return { rows: [{ credential_reference: credentialReference }] };
        }
        if (text.includes("begin_people_sync_generation")) {
          return { rows: [{ outcome: "STARTED", connector_id: "directory-a" }] };
        }
        if (text.includes("stage_people_directory_customer")) return { rows: [{ outcome: "STAGED" }] };
        if (text.includes("publish_people_sync_generation")) return { rows: [{ outcome: "PUBLISHED" }] };
        throw new Error(`unexpected SQL ${text}`);
      },
    },
  });

  assert.deepEqual(result, {
    kind: "published",
    workspaceId: "tenant-a",
    generationId: "00000000-0000-4000-8000-000000000002",
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
