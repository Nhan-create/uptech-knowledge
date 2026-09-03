import assert from "node:assert/strict";
import test from "node:test";

import type { SecretAdapter, SecretReference } from "../secrets/core.ts";
import type { DatabasePool, NormalSessionContext } from "../db/core.ts";
import {
  connectGoogleDirectory,
  createPostgresDirectoryConnectionRepository,
  DirectoryConnectionDeniedError,
  type DirectoryConnectionRepository,
} from "./directory-connection.ts";

const DIRECTORY_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
] as const;

function harness(outcome: "ACTIVATED" | "DENIED" = "ACTIVATED") {
  const secretCalls: Array<{ operation: string; value?: Uint8Array; reference?: string }> = [];
  const activations: Parameters<DirectoryConnectionRepository["activate"]>[0][] = [];
  const reference = "secret://directory/tenant-a" as SecretReference;
  const secrets: SecretAdapter = {
    async create(value) {
      secretCalls.push({ operation: "create", value: Uint8Array.from(value) });
      return reference;
    },
    async read() { throw new Error("not used"); },
    async replace() { throw new Error("not used"); },
    async destroy(secretReference) {
      secretCalls.push({ operation: "destroy", reference: secretReference });
    },
  };
  const repository: DirectoryConnectionRepository = {
    async activate(input) {
      activations.push(input);
      return outcome === "ACTIVATED"
        ? { outcome, previousCredentialReference: null }
        : { outcome };
    },
  };
  return { secrets, repository, secretCalls, activations, reference };
}

const BASE_INPUT = {
  setup: {
    workspaceId: "tenant-a",
    connectorId: "directory-a",
    identityId: "identity-a",
    role: "OWNER" as const,
    requestId: "00000000-0000-4000-8000-000000000001",
    serviceIdentity: "uptech-api",
  },
  google: {
    customerId: "C0123abc",
    providerSubject: "tenant-a-google-subject",
    hostedDomain: "tenant-a.example",
    refreshToken: Uint8Array.from([1, 2, 3, 4]),
    grantedScopes: DIRECTORY_SCOPES,
    isAdmin: false,
    isDelegatedAdmin: true,
    readProbes: {
      customer: true,
      users: true,
      groups: true,
      groupMembers: true,
      orgUnits: true,
    },
  },
};

test("Directory connection stores only a secret reference after tenant admin and Google admin checks", async () => {
  const state = harness();
  const result = await connectGoogleDirectory({ ...BASE_INPUT, secretAdapter: state.secrets, repository: state.repository });

  assert.deepEqual(result, { kind: "connected", workspaceId: "tenant-a", connectorId: "directory-a", customerId: "C0123abc" });
  assert.deepEqual(state.secretCalls, [{ operation: "create", value: Uint8Array.from([1, 2, 3, 4]) }]);
  assert.equal(state.activations.length, 1);
  assert.deepEqual(state.activations[0], {
    workspaceId: "tenant-a",
    connectorId: "directory-a",
    identityId: "identity-a",
    providerCustomerId: "C0123abc",
    providerSubject: "tenant-a-google-subject",
    hostedDomain: "tenant-a.example",
    credentialReference: state.reference,
    authorizedScopes: DIRECTORY_SCOPES,
    requestId: "00000000-0000-4000-8000-000000000001",
  });
  assert.deepEqual(BASE_INPUT.google.refreshToken, Uint8Array.from([1, 2, 3, 4]));
});

test("Google admin signals permit setup but are never sent as application role authority", async () => {
  for (const signals of [
    { isAdmin: true, isDelegatedAdmin: false },
    { isAdmin: false, isDelegatedAdmin: true },
  ]) {
    const state = harness();
    await connectGoogleDirectory({
      ...BASE_INPUT,
      google: { ...BASE_INPUT.google, ...signals },
      secretAdapter: state.secrets,
      repository: state.repository,
    });
    assert.equal("role" in state.activations[0], false);
    assert.equal("isAdmin" in state.activations[0], false);
    assert.equal("isDelegatedAdmin" in state.activations[0], false);
  }
});

test("Directory connection denies non-admin callers, missing Google admin signals, incomplete probes, or widened scopes before secret storage", async () => {
  const invalid = [
    { setup: { ...BASE_INPUT.setup, role: "MEMBER" as const } },
    { google: { ...BASE_INPUT.google, isAdmin: false, isDelegatedAdmin: false } },
    { google: { ...BASE_INPUT.google, readProbes: { ...BASE_INPUT.google.readProbes, orgUnits: false } } },
    { google: { ...BASE_INPUT.google, grantedScopes: [...DIRECTORY_SCOPES, "https://www.googleapis.com/auth/admin.directory.user"] } },
  ];

  for (const override of invalid) {
    const state = harness();
    await assert.rejects(
      connectGoogleDirectory({
        ...BASE_INPUT,
        ...override,
        secretAdapter: state.secrets,
        repository: state.repository,
      } as never),
      DirectoryConnectionDeniedError,
    );
    assert.deepEqual(state.secretCalls, []);
    assert.deepEqual(state.activations, []);
  }
});

test("Directory connection requires an explicit successful Group Members probe", async () => {
  const state = harness();
  await assert.rejects(
    connectGoogleDirectory({
      ...BASE_INPUT,
      google: {
        ...BASE_INPUT.google,
        readProbes: {
          customer: true,
          users: true,
          groups: true,
          orgUnits: true,
        } as never,
      },
      secretAdapter: state.secrets,
      repository: state.repository,
    }),
    DirectoryConnectionDeniedError,
  );
  assert.deepEqual(state.secretCalls, []);
});

test("Directory connection destroys the newly-created credential when activation denies", async () => {
  const state = harness("DENIED");
  await assert.rejects(
    connectGoogleDirectory({ ...BASE_INPUT, secretAdapter: state.secrets, repository: state.repository }),
    DirectoryConnectionDeniedError,
  );
  assert.deepEqual(state.secretCalls.map((call) => call.operation), ["create", "destroy"]);
  assert.equal(state.secretCalls[1].reference, state.reference);
});

test("Directory reauthorization destroys the prior credential only after the new reference commits", async () => {
  const events: string[] = [];
  const newReference = "secret://directory/new" as SecretReference;
  const priorReference = "secret://directory/prior" as SecretReference;
  const secretAdapter: SecretAdapter = {
    async create() {
      events.push("create-new");
      return newReference;
    },
    async read() { throw new Error("not used"); },
    async replace() { throw new Error("not used"); },
    async destroy(reference) {
      events.push(reference === priorReference ? "destroy-prior" : "destroy-new");
    },
  };
  const repository = {
    async activate(input: Parameters<DirectoryConnectionRepository["activate"]>[0]) {
      assert.equal(input.credentialReference, newReference);
      events.push("commit-new-reference");
      return {
        outcome: "ACTIVATED" as const,
        previousCredentialReference: priorReference,
      };
    },
  } as unknown as DirectoryConnectionRepository;

  const result = await connectGoogleDirectory({
    ...BASE_INPUT,
    secretAdapter,
    repository,
  });

  assert.equal(result.kind, "connected");
  assert.deepEqual(events, [
    "create-new",
    "commit-new-reference",
    "destroy-prior",
  ]);
});

test("Directory reauthorization fails closed without destroying the committed credential when prior cleanup fails", async () => {
  const destroyed: SecretReference[] = [];
  const newReference = "secret://directory/new" as SecretReference;
  const priorReference = "secret://directory/prior" as SecretReference;
  const secretAdapter: SecretAdapter = {
    async create() { return newReference; },
    async read() { throw new Error("not used"); },
    async replace() { throw new Error("not used"); },
    async destroy(reference) {
      destroyed.push(reference);
      throw new Error("provider cleanup failed with sensitive details");
    },
  };
  const repository = {
    async activate() {
      return {
        outcome: "ACTIVATED" as const,
        previousCredentialReference: priorReference,
      };
    },
  } as unknown as DirectoryConnectionRepository;

  await assert.rejects(
    connectGoogleDirectory({
      ...BASE_INPUT,
      secretAdapter,
      repository,
    }),
    (error: unknown) =>
      error instanceof DirectoryConnectionDeniedError &&
      error.message === "Directory connection is denied",
  );
  assert.deepEqual(destroyed, [priorReference]);
});

test("Directory reauthorization fails closed without destroying a reference returned as both prior and current", async () => {
  const destroyed: SecretReference[] = [];
  const reference = "secret://directory/same" as SecretReference;
  const secretAdapter: SecretAdapter = {
    async create() { return reference; },
    async read() { throw new Error("not used"); },
    async replace() { throw new Error("not used"); },
    async destroy(destroyedReference) {
      destroyed.push(destroyedReference);
    },
  };
  const repository = {
    async activate() {
      return {
        outcome: "ACTIVATED" as const,
        previousCredentialReference: reference,
      };
    },
  } as unknown as DirectoryConnectionRepository;

  await assert.rejects(
    connectGoogleDirectory({
      ...BASE_INPUT,
      secretAdapter,
      repository,
    }),
    DirectoryConnectionDeniedError,
  );
  assert.deepEqual(destroyed, []);
});

const SESSION_CONTEXT: NormalSessionContext = {
  kind: "session",
  identityId: "identity-a",
  workspaceId: "tenant-a",
  actorId: "user-a",
  membershipId: "membership-a",
  sessionId: "session-a",
  tokenId: "token-a",
  clientType: "WEB",
  tokenKind: "WEB_SESSION",
  workspaceRole: "OWNER",
  userSecurityVersion: "1",
  identitySecurityVersion: "1",
  workspaceSecurityVersion: "1",
  membershipAuthzVersion: "1",
  sessionSecurityVersion: "1",
  csrfTokenHash: "0".repeat(64),
  contextExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
};

test("PostgreSQL activation repository revalidates the bound session and calls only the approved routine", async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const client = {
    async query(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      if (text.includes("matching_context_count")) {
        return { rows: [{ matching_context_count: 1 }] };
      }
      if (text.includes("activate_directory_connector_v1")) {
        return {
          rows: [{
            outcome: "ACTIVATED",
            previous_credential_reference: "secret://directory/prior",
          }],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = { connect: async () => client } as unknown as Pick<DatabasePool, "connect">;
  const repository = createPostgresDirectoryConnectionRepository(
    { context: SESSION_CONTEXT, credentialHash: new Uint8Array(32) },
    pool,
  );

  assert.deepEqual(await repository.activate({
    workspaceId: "tenant-a",
    connectorId: "directory-a",
    identityId: "identity-a",
    providerCustomerId: "C0123abc",
    providerSubject: "tenant-a-google-subject",
    hostedDomain: "tenant-a.example",
    credentialReference: "secret://directory/a" as SecretReference,
    authorizedScopes: DIRECTORY_SCOPES,
    requestId: "00000000-0000-4000-8000-000000000001",
  }), {
    outcome: "ACTIVATED",
    previousCredentialReference: "secret://directory/prior",
  });

  const activation = calls.find(({ text }) => text.includes("activate_directory_connector_v1"));
  assert.deepEqual(activation?.values, [
    "directory-a",
    "C0123abc",
    "secret://directory/a",
    "tenant-a-google-subject",
    "tenant-a.example",
    DIRECTORY_SCOPES,
    "00000000-0000-4000-8000-000000000001",
  ]);
  assert.ok(calls.some(({ text }) => text.includes("matching_context_count")));
});

test("reauthorization destroys the prior secret only after the real repository COMMIT", async () => {
  const events: string[] = [];
  const newReference = "secret://directory/new-after-commit" as SecretReference;
  const priorReference = "secret://directory/prior-before-commit" as SecretReference;
  const client = {
    async query(text: string) {
      if (text === "BEGIN") events.push("begin");
      if (text.includes("matching_context_count")) {
        return { rows: [{ matching_context_count: 1 }] };
      }
      if (text.includes("activate_directory_connector_v1")) {
        events.push("activate-new-reference");
        return {
          rows: [{
            outcome: "ACTIVATED",
            previous_credential_reference: priorReference,
          }],
        };
      }
      if (text === "COMMIT") events.push("commit-new-reference");
      return { rows: [] };
    },
    release() {},
  };
  const repository = createPostgresDirectoryConnectionRepository(
    { context: SESSION_CONTEXT, credentialHash: new Uint8Array(32) },
    { connect: async () => client } as unknown as Pick<DatabasePool, "connect">,
  );
  const secretAdapter: SecretAdapter = {
    async create() {
      events.push("create-new-secret");
      return newReference;
    },
    async read() { throw new Error("not used"); },
    async replace() { throw new Error("not used"); },
    async destroy(reference) {
      events.push(reference === priorReference ? "destroy-prior" : "destroy-new");
    },
  };

  await connectGoogleDirectory({ ...BASE_INPUT, secretAdapter, repository });

  assert.ok(events.indexOf("activate-new-reference") < events.indexOf("commit-new-reference"));
  assert.ok(events.indexOf("commit-new-reference") < events.indexOf("destroy-prior"));
  assert.equal(events.includes("destroy-new"), false);
});

test("reauthorization COMMIT failure rolls back and destroys only the uncommitted new secret", async () => {
  const events: string[] = [];
  const newReference = "secret://directory/new-commit-failure" as SecretReference;
  const priorReference = "secret://directory/prior-kept" as SecretReference;
  const client = {
    async query(text: string) {
      if (text.includes("matching_context_count")) {
        return { rows: [{ matching_context_count: 1 }] };
      }
      if (text.includes("activate_directory_connector_v1")) {
        events.push("activate-new-reference");
        return {
          rows: [{
            outcome: "ACTIVATED",
            previous_credential_reference: priorReference,
          }],
        };
      }
      if (text === "COMMIT") {
        events.push("commit-failed");
        throw new Error("simulated commit failure with sensitive details");
      }
      if (text === "ROLLBACK") events.push("rollback");
      return { rows: [] };
    },
    release() {},
  };
  const repository = createPostgresDirectoryConnectionRepository(
    { context: SESSION_CONTEXT, credentialHash: new Uint8Array(32) },
    { connect: async () => client } as unknown as Pick<DatabasePool, "connect">,
  );
  const secretAdapter: SecretAdapter = {
    async create() { return newReference; },
    async read() { throw new Error("not used"); },
    async replace() { throw new Error("not used"); },
    async destroy(reference) {
      events.push(reference === priorReference ? "destroy-prior" : "destroy-new");
    },
  };

  await assert.rejects(
    connectGoogleDirectory({ ...BASE_INPUT, secretAdapter, repository }),
    (error: unknown) =>
      error instanceof DirectoryConnectionDeniedError &&
      error.message === "Directory connection is denied",
  );

  assert.deepEqual(events, [
    "activate-new-reference",
    "commit-failed",
    "rollback",
    "destroy-new",
  ]);
});

test("PostgreSQL activation repository denies caller-controlled tenant or identity substitution before SQL", async () => {
  let connections = 0;
  const repository = createPostgresDirectoryConnectionRepository(
    { context: SESSION_CONTEXT, credentialHash: new Uint8Array(32) },
    { connect: async () => { connections += 1; throw new Error("must not connect"); } } as never,
  );
  const common = {
    connectorId: "directory-a",
    providerCustomerId: "C0123abc",
    providerSubject: "tenant-a-google-subject",
    hostedDomain: "tenant-a.example",
    credentialReference: "secret://directory/a" as SecretReference,
    authorizedScopes: DIRECTORY_SCOPES,
    requestId: "00000000-0000-4000-8000-000000000001",
  };

  assert.deepEqual(await repository.activate({ ...common, workspaceId: "tenant-b", identityId: "identity-a" }), { outcome: "DENIED" });
  assert.deepEqual(await repository.activate({ ...common, workspaceId: "tenant-a", identityId: "identity-b" }), { outcome: "DENIED" });
  assert.equal(connections, 0);
});
