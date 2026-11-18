import {
  loadApprovedSecretAdapter,
  type ApprovedSecretProviderRegistration,
} from "../secrets/core.ts";
import {
  createGoogleCloudSecretManagerRegistration,
  type GoogleCloudSecretManagerConfiguration,
} from "../secrets/google-cloud-secret-manager.ts";
import { resolveLocalDevSecretProviderRegistration } from "../secrets/local-dev-secret-manager.ts";
import {
  connectGoogleDirectory,
  type ConnectGoogleDirectoryInput,
} from "./directory-connection.ts";
import {
  createGoogleDirectorySyncJobHandler,
  type GoogleDirectorySyncWorkerDependencies,
} from "./google-directory-worker.ts";

type Environment = Readonly<Record<string, string | undefined>>;

export interface GoogleCloudDirectoryRuntimeConfiguration {
  readonly projectId: string;
  readonly workloadIdentityProvider: string;
  readonly serviceAccountEmail: string;
}

export class GoogleCloudDirectoryRuntimeConfigurationError extends Error {
  override readonly name = "GoogleCloudDirectoryRuntimeConfigurationError";
}

function requireConfigurationValue(
  environment: Environment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new GoogleCloudDirectoryRuntimeConfigurationError(
      "Google Cloud Directory secret configuration is missing",
    );
  }
  return value;
}

/** Loads non-secret Google Cloud workload identity metadata for Directory sync. */
export function loadGoogleCloudDirectoryRuntimeConfiguration(
  environment: Environment = process.env,
): GoogleCloudDirectoryRuntimeConfiguration {
  return Object.freeze({
    projectId: requireConfigurationValue(
      environment,
      "UPTECH_GCP_SECRET_MANAGER_PROJECT_ID",
    ),
    workloadIdentityProvider: requireConfigurationValue(
      environment,
      "UPTECH_GCP_WORKLOAD_IDENTITY_PROVIDER",
    ),
    serviceAccountEmail: requireConfigurationValue(
      environment,
      "UPTECH_GCP_SECRET_MANAGER_SERVICE_ACCOUNT_EMAIL",
    ),
  });
}

export interface DirectoryRuntimeDependencies extends Omit<
  GoogleDirectorySyncWorkerDependencies,
  "secretAdapter"
> {
  readonly secretProviderRegistration: ApprovedSecretProviderRegistration;
}

export interface DirectoryRuntime {
  connect(
    input: Omit<ConnectGoogleDirectoryInput, "secretAdapter">,
  ): ReturnType<typeof connectGoogleDirectory>;
  createSyncJobHandler(): ReturnType<typeof createGoogleDirectorySyncJobHandler>;
}

export interface GoogleCloudDirectoryRuntimeDependencies extends Omit<
  DirectoryRuntimeDependencies,
  "secretProviderRegistration"
> {
  readonly googleCloudSecretManager: GoogleCloudSecretManagerConfiguration;
}

/**
 * Binds Directory setup and sync to the approved Google Cloud provider
 * registration. The provider itself owns workload identity and secret I/O.
 */
export function createGoogleCloudDirectoryRuntime(
  dependencies: GoogleCloudDirectoryRuntimeDependencies,
): DirectoryRuntime {
  return createDirectoryRuntime({
    ...dependencies,
    secretProviderRegistration: createGoogleCloudSecretManagerRegistration(
      dependencies.googleCloudSecretManager,
    ),
  });
}

/** Builds the Google Cloud Directory runtime from non-secret deployment metadata. */
export function createConfiguredGoogleCloudDirectoryRuntime(
  dependencies: Omit<
    GoogleCloudDirectoryRuntimeDependencies,
    "googleCloudSecretManager"
  >,
  environment: Environment = process.env,
): DirectoryRuntime {
  const localDevRegistration =
    resolveLocalDevSecretProviderRegistration(environment);
  if (localDevRegistration !== null) {
    return createDirectoryRuntime({
      ...dependencies,
      secretProviderRegistration: localDevRegistration,
    });
  }

  return createGoogleCloudDirectoryRuntime({
    ...dependencies,
    googleCloudSecretManager: loadGoogleCloudDirectoryRuntimeConfiguration(
      environment,
    ),
  });
}

/**
 * The production composition boundary for Google Directory credentials.
 * It admits only an approved, configured secret-provider registration and
 * shares its validated adapter with connection setup and lease-bound syncs.
 */
export function createDirectoryRuntime(
  dependencies: DirectoryRuntimeDependencies,
): DirectoryRuntime {
  const secretAdapter = loadApprovedSecretAdapter(
    dependencies.secretProviderRegistration,
  );
  const workerDependencies = {
    secretAdapter,
    oauthClient: dependencies.oauthClient,
    nextId: dependencies.nextId,
    fetch: dependencies.fetch,
  };

  return Object.freeze({
    connect(input: Omit<ConnectGoogleDirectoryInput, "secretAdapter">) {
      return connectGoogleDirectory({ ...input, secretAdapter });
    },
    createSyncJobHandler() {
      return createGoogleDirectorySyncJobHandler(workerDependencies);
    },
  });
}
