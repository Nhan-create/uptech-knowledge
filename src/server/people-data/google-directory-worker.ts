import type { SecretAdapter } from "../secrets/core.ts";
import {
  runDirectorySync,
  type DirectorySyncDatabaseClient,
  type DirectorySyncWorkerContext,
  type PublishedDirectorySync,
} from "./directory-sync.ts";
import { resolveDirectoryCredentialReference } from "./directory-credentials.ts";
import { createGoogleDirectoryHttpTransport } from "./google-directory-http.ts";
import {
  createGoogleDirectoryRefreshTokenAccessProvider,
  type GoogleDirectoryOAuthClient,
} from "./google-directory-token.ts";

export interface GoogleDirectorySyncWorkerDependencies {
  readonly secretAdapter: SecretAdapter;
  readonly oauthClient: GoogleDirectoryOAuthClient;
  readonly nextId: () => string;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Creates a handler for the existing worker boundary. It derives every
 * credential lookup from the leased worker transaction, then delegates the
 * snapshot staging, publishing, mapping, and authorization revocation to the
 * existing Directory generation routines.
 */
export function createGoogleDirectorySyncJobHandler(
  dependencies: GoogleDirectorySyncWorkerDependencies,
): (context: DirectorySyncWorkerContext) => Promise<PublishedDirectorySync> {
  return async ({ client, lease }) => {
    const accessTokenProvider = createGoogleDirectoryRefreshTokenAccessProvider({
      secretAdapter: dependencies.secretAdapter,
      credentialReferenceForLease: () =>
        resolveDirectoryCredentialReference(
          client as DirectorySyncDatabaseClient,
          lease,
        ),
      oauthClient: dependencies.oauthClient,
      fetch: dependencies.fetch,
    });
    return runDirectorySync({
      client,
      lease,
      transport: createGoogleDirectoryHttpTransport(lease, {
        accessTokenProvider,
        fetch: dependencies.fetch,
      }),
      generationId: dependencies.nextId(),
      requestId: dependencies.nextId(),
    });
  };
}
