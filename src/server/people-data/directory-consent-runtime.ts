import { loadGoogleLoginRuntimeConfig } from "../auth/google/config.ts";
import { getRuntimeDatabasePool } from "../db/runtime-pool.ts";
import { createGoogleDirectoryConsentService } from "./directory-consent.ts";
import {
  openDirectoryConsentCookie,
  sealDirectoryConsentCookie,
} from "./directory-consent-crypto.ts";
import { createPostgresDirectoryConsentRepository } from "./directory-consent-repository.ts";
import {
  createConfiguredAuthenticatedGoogleDirectoryConnection,
  sealServerVerifiedGoogleDirectoryGrant,
} from "./directory-production.ts";
import { createGoogleDirectoryConsentProvider } from "./google-directory-consent-provider.ts";

export const GOOGLE_DIRECTORY_CONSENT_CALLBACK_PATH =
  "/api/v1/admin/connectors/google-directory/callback";

export function createConfiguredGoogleDirectoryConsentRuntime(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const config = loadGoogleLoginRuntimeConfig(environment);
  const pool = getRuntimeDatabasePool(config.databaseUrl);
  const cookieKey = Object.freeze({
    environmentId: config.environmentId,
    keyVersion: config.pkceKeyVersion,
    key: config.pkceEncryptionKey,
  });
  const provider = createGoogleDirectoryConsentProvider({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: new URL(
      GOOGLE_DIRECTORY_CONSENT_CALLBACK_PATH,
      config.appOrigin,
    ).href,
  });

  return Object.freeze({
    config,
    pool,
    service: createGoogleDirectoryConsentService({
      now: () => new Date(),
      consentCookie: {
        seal: (value) => sealDirectoryConsentCookie(value, cookieKey),
        open: (value) => openDirectoryConsentCookie(value, {
          ...cookieKey,
          now: new Date(),
        }),
      },
      repository: createPostgresDirectoryConsentRepository(pool),
      provider,
      sealGrant: sealServerVerifiedGoogleDirectoryGrant,
      connection:
        createConfiguredAuthenticatedGoogleDirectoryConnection(environment),
    }),
  });
}
