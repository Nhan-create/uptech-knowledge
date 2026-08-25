import assert from "node:assert/strict";
import test from "node:test";

import {
  SecretOperationError,
  SecretProviderUnavailableError,
  loadApprovedSecretAdapter,
  type SecretAdapter,
  type SecretOperationMetadata,
  type SecretReference,
} from "./core.ts";

// This fake intentionally exists only in a test module.
class InMemorySecretAdapter implements SecretAdapter {
  readonly values = new Map<SecretReference, Uint8Array>();
  readonly operations: string[] = [];
  private nextId = 1;

  async create(
    value: Uint8Array,
  ): Promise<SecretReference> {
    const reference = `test-secret-${this.nextId++}` as SecretReference;
    this.values.set(reference, Uint8Array.from(value));
    this.operations.push("create");
    return reference;
  }

  async read(
    reference: SecretReference,
  ): Promise<Uint8Array> {
    this.operations.push("read");
    const value = this.values.get(reference);
    if (value === undefined) {
      throw new Error("not found");
    }
    return Uint8Array.from(value);
  }

  async replace(
    reference: SecretReference,
    value: Uint8Array,
  ): Promise<void> {
    this.operations.push("replace");
    this.values.set(reference, Uint8Array.from(value));
  }

  async destroy(
    reference: SecretReference,
  ): Promise<void> {
    this.operations.push("destroy");
    this.values.delete(reference);
  }
}

const metadata: SecretOperationMetadata = {
  workspaceId: "workspace-1",
  serviceIdentity: "connector-service",
  purpose: "GOOGLE_DRIVE",
  requestId: "request-1",
};

test("secret provider loading refuses absent or unconfigured providers", () => {
  assert.throws(
    () => loadApprovedSecretAdapter(undefined),
    SecretProviderUnavailableError,
  );
  assert.throws(
    () =>
      loadApprovedSecretAdapter({
        providerId: "approved-kms",
        configurationPresent: false,
        createAdapter: () => new InMemorySecretAdapter(),
      }),
    SecretProviderUnavailableError,
  );
  assert.throws(
    () =>
      loadApprovedSecretAdapter({
        providerId: "",
        configurationPresent: true,
        createAdapter: () => new InMemorySecretAdapter(),
      }),
    SecretProviderUnavailableError,
  );
});

test("secret provider loading masks initialization errors and rejects partial adapters", () => {
  assert.throws(
    () =>
      loadApprovedSecretAdapter({
        providerId: "approved-kms",
        configurationPresent: true,
        createAdapter() {
          throw new Error("plaintext provider response must not escape");
        },
      }),
    (error: unknown) => {
      assert.equal(error instanceof SecretProviderUnavailableError, true);
      assert.doesNotMatch((error as Error).message, /plaintext provider response/);
      return true;
    },
  );

  assert.throws(
    () =>
      loadApprovedSecretAdapter({
        providerId: "approved-kms",
        configurationPresent: true,
        createAdapter: () => ({ create() {} }) as never,
      }),
    SecretProviderUnavailableError,
  );
});

test("approved adapter exposes only the required create/read/replace/destroy contract", async () => {
  const fake = new InMemorySecretAdapter();
  const adapter = loadApprovedSecretAdapter({
    providerId: "approved-kms",
    configurationPresent: true,
    createAdapter: () => fake,
  });

  assert.deepEqual(Object.keys(adapter).sort(), [
    "create",
    "destroy",
    "read",
    "replace",
  ]);
  assert.equal(Object.isFrozen(adapter), true);

  const initial = Uint8Array.from([1, 2, 3]);
  const reference = await adapter.create(initial, metadata);
  initial.fill(9);
  assert.deepEqual(await adapter.read(reference, metadata), Uint8Array.from([1, 2, 3]));

  await adapter.replace(reference, Uint8Array.from([4, 5]), metadata);
  assert.deepEqual(await adapter.read(reference, metadata), Uint8Array.from([4, 5]));
  await adapter.destroy(reference, metadata);
  assert.equal(fake.values.has(reference), false);
  assert.deepEqual(fake.operations, ["create", "read", "replace", "read", "destroy"]);
});

test("secret operation boundary rejects empty values and masks provider failures", async () => {
  const adapter = loadApprovedSecretAdapter({
    providerId: "approved-kms",
    configurationPresent: true,
    createAdapter: () => ({
      async create() {
        throw new Error("provider body contained raw credentials");
      },
      async read() {
        throw new Error("provider body contained raw credentials");
      },
      async replace() {
        throw new Error("provider body contained raw credentials");
      },
      async destroy() {
        throw new Error("provider body contained raw credentials");
      },
    }),
  });

  await assert.rejects(
    adapter.create(new Uint8Array(), metadata),
    SecretOperationError,
  );
  await assert.rejects(
    adapter.create(Uint8Array.from([1]), metadata),
    (error: unknown) => {
      assert.equal(error instanceof SecretOperationError, true);
      assert.doesNotMatch((error as Error).message, /raw credentials/);
      return true;
    },
  );
});
