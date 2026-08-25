export type SecretReference = string & {
  readonly __secretReference: unique symbol;
};

export interface SecretOperationMetadata {
  readonly workspaceId: string;
  readonly serviceIdentity: string;
  readonly purpose: string;
  readonly requestId: string;
}

export interface SecretAdapter {
  create(
    value: Uint8Array,
    metadata: SecretOperationMetadata,
  ): Promise<SecretReference>;
  read(
    reference: SecretReference,
    metadata: SecretOperationMetadata,
  ): Promise<Uint8Array>;
  replace(
    reference: SecretReference,
    value: Uint8Array,
    metadata: SecretOperationMetadata,
  ): Promise<void>;
  destroy(
    reference: SecretReference,
    metadata: SecretOperationMetadata,
  ): Promise<void>;
}

export interface ApprovedSecretProviderRegistration {
  readonly providerId: string;
  readonly configurationPresent: boolean;
  createAdapter(): SecretAdapter;
}

export class SecretProviderUnavailableError extends Error {
  override readonly name = "SecretProviderUnavailableError";
}

export class SecretOperationError extends Error {
  override readonly name = "SecretOperationError";
}

function hasExactSecretOperations(value: unknown): value is SecretAdapter {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<Record<keyof SecretAdapter, unknown>>;
  return (
    typeof candidate.create === "function" &&
    typeof candidate.read === "function" &&
    typeof candidate.replace === "function" &&
    typeof candidate.destroy === "function"
  );
}

function requireSecretValue(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new SecretOperationError("Secret value is invalid");
  }

  return Uint8Array.from(value);
}

function requireSecretReference(reference: SecretReference): SecretReference {
  if (typeof reference !== "string" || reference.length === 0) {
    throw new SecretOperationError("Secret reference is invalid");
  }

  return reference;
}

function requireMetadataValue(label: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes("\0")
  ) {
    throw new SecretOperationError(`${label} is invalid`);
  }

  return value;
}

function safeMetadata(
  metadata: SecretOperationMetadata,
): SecretOperationMetadata {
  if (typeof metadata !== "object" || metadata === null) {
    throw new SecretOperationError("Secret operation metadata is invalid");
  }

  return Object.freeze({
    workspaceId: requireMetadataValue("workspaceId", metadata.workspaceId),
    serviceIdentity: requireMetadataValue(
      "serviceIdentity",
      metadata.serviceIdentity,
    ),
    purpose: requireMetadataValue("purpose", metadata.purpose),
    requestId: requireMetadataValue("requestId", metadata.requestId),
  });
}

function providerOperationFailed(): SecretOperationError {
  return new SecretOperationError("Secret provider operation failed");
}

export function loadApprovedSecretAdapter(
  registration: ApprovedSecretProviderRegistration | null | undefined,
): SecretAdapter {
  if (
    registration === null ||
    registration === undefined ||
    typeof registration.providerId !== "string" ||
    registration.providerId.trim().length === 0 ||
    registration.configurationPresent !== true ||
    typeof registration.createAdapter !== "function"
  ) {
    throw new SecretProviderUnavailableError(
      "An approved and configured secret provider is required",
    );
  }

  let adapter: unknown;
  try {
    adapter = registration.createAdapter();
  } catch {
    throw new SecretProviderUnavailableError(
      "The approved secret provider could not be initialized",
    );
  }

  if (!hasExactSecretOperations(adapter)) {
    throw new SecretProviderUnavailableError(
      "The approved secret provider adapter is invalid",
    );
  }

  const boundary: SecretAdapter = {
    async create(value, metadata) {
      const safeValue = requireSecretValue(value);
      const operationMetadata = safeMetadata(metadata);
      try {
        const reference = await adapter.create(
          safeValue,
          operationMetadata,
        );
        return requireSecretReference(reference);
      } catch {
        throw providerOperationFailed();
      }
    },
    async read(reference, metadata) {
      const safeReference = requireSecretReference(reference);
      const operationMetadata = safeMetadata(metadata);
      try {
        const value = await adapter.read(
          safeReference,
          operationMetadata,
        );
        return requireSecretValue(value);
      } catch {
        throw providerOperationFailed();
      }
    },
    async replace(reference, value, metadata) {
      const safeReference = requireSecretReference(reference);
      const safeValue = requireSecretValue(value);
      const operationMetadata = safeMetadata(metadata);
      try {
        await adapter.replace(
          safeReference,
          safeValue,
          operationMetadata,
        );
      } catch {
        throw providerOperationFailed();
      }
    },
    async destroy(reference, metadata) {
      const safeReference = requireSecretReference(reference);
      const operationMetadata = safeMetadata(metadata);
      try {
        await adapter.destroy(
          safeReference,
          operationMetadata,
        );
      } catch {
        throw providerOperationFailed();
      }
    },
  };

  return Object.freeze(boundary);
}
