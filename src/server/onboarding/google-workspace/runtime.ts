import { loadGoogleLoginRuntimeConfig, type GoogleLoginRuntimeConfig } from "../../auth/google/config.ts";
import type { DatabasePool } from "../../db/core.ts";
import { getRuntimeDatabasePool } from "../../db/runtime-pool.ts";
import {
  createGoogleDirectoryConsentProvider,
  type GoogleDirectoryConsentProvider,
  type GoogleDirectoryConsentProviderConfig,
} from "../../people-data/google-directory-consent-provider.ts";
import { loadGoogleCloudDirectoryRuntimeConfiguration } from "../../people-data/directory-runtime.ts";
import {
  loadApprovedSecretAdapter,
  type ApprovedSecretProviderRegistration,
} from "../../secrets/core.ts";
import { createGoogleCloudSecretManagerRegistration } from "../../secrets/google-cloud-secret-manager.ts";
import { createConfiguredGoogleDirectoryProductionWorker } from "../../../worker/google-directory-production.ts";
import { createGoogleWorkspaceBootstrapRepository } from "./repository.ts";
import {
  createGoogleWorkspaceBootstrapService,
  type GoogleWorkspaceBootstrapService,
} from "./service.ts";
import { createGoogleWorkspaceBootstrapSourceAuthority } from "./source-authority.ts";

type Environment = Readonly<Record<string, string | undefined>>;

export const GOOGLE_WORKSPACE_BOOTSTRAP_CALLBACK_PATH =
  "/api/v1/onboarding/google-workspace/callback";

interface ZeroInputDirectoryWorker {
  runNext(): Promise<unknown>;
  close(): Promise<void>;
}

export interface GoogleWorkspaceBootstrapRuntime {
  readonly service: GoogleWorkspaceBootstrapService;
  readonly runDirectoryWorker: () => Promise<unknown>;
}

export interface GoogleWorkspaceBootstrapRuntimeComposition {
  readonly loadConfig: (environment: Environment) => GoogleLoginRuntimeConfig;
  readonly getPool: (databaseUrl: string) => DatabasePool;
  readonly createSecretProviderRegistration:
    (environment: Environment) => ApprovedSecretProviderRegistration;
  readonly createProvider:
    (config: GoogleDirectoryConsentProviderConfig) => GoogleDirectoryConsentProvider;
  readonly createDirectoryWorker:
    (environment: Environment) => ZeroInputDirectoryWorker;
  readonly now: () => Date;
}

const productionComposition: GoogleWorkspaceBootstrapRuntimeComposition =
  Object.freeze({
    loadConfig: loadGoogleLoginRuntimeConfig,
    getPool: getRuntimeDatabasePool,
    createSecretProviderRegistration(environment: Environment) {
      return createGoogleCloudSecretManagerRegistration(
        loadGoogleCloudDirectoryRuntimeConfiguration(environment),
      );
    },
    createProvider: createGoogleDirectoryConsentProvider,
    createDirectoryWorker: createConfiguredGoogleDirectoryProductionWorker,
    now: () => new Date(),
  });

/**
 * Production-only composition for pre-tenant Workspace bootstrap. Its public
 * surface exposes neither deployment secrets nor tenant-selecting inputs.
 */
export function createConfiguredGoogleWorkspaceBootstrapRuntime(
  environment: Environment = process.env,
  composition: GoogleWorkspaceBootstrapRuntimeComposition = productionComposition,
): GoogleWorkspaceBootstrapRuntime {
  const config = composition.loadConfig(environment);
  const pool = composition.getPool(config.databaseUrl);
  const secretAdapter = loadApprovedSecretAdapter(
    composition.createSecretProviderRegistration(environment),
  );
  const provider = composition.createProvider({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: new URL(
      GOOGLE_WORKSPACE_BOOTSTRAP_CALLBACK_PATH,
      config.appOrigin,
    ).href,
  });
  const service = createGoogleWorkspaceBootstrapService({
    now: composition.now,
    cookieKey: Object.freeze({
      environmentId: config.environmentId,
      keyVersion: config.pkceKeyVersion,
      key: config.pkceEncryptionKey,
    }),
    sourceAuthority: createGoogleWorkspaceBootstrapSourceAuthority(pool),
    repository: createGoogleWorkspaceBootstrapRepository(pool),
    provider,
    secretAdapter,
  });

  return Object.freeze({
    service,
    async runDirectoryWorker() {
      const worker = composition.createDirectoryWorker(environment);
      try {
        return await worker.runNext();
      } finally {
        await worker.close();
      }
    },
  });
}
