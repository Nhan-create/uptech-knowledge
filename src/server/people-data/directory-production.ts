import { randomUUID } from "node:crypto";

import { loadGoogleLoginRuntimeConfig } from "../auth/google/config.ts";
import type { AuthenticatedWebSession } from "../auth/web-session.ts";
import type { DatabasePool } from "../db/core.ts";
import { getRuntimeDatabasePool } from "../db/runtime-pool.ts";
import {
  createPostgresDirectoryConnectionRepository,
  type ConnectGoogleDirectoryInput,
} from "./directory-connection.ts";
import {
  createConfiguredGoogleCloudDirectoryRuntime,
  type DirectoryRuntime,
} from "./directory-runtime.ts";

const DIRECTORY_API_SERVICE_IDENTITY = "uptech-api";
const SERVER_VERIFIED_GOOGLE_DIRECTORY_GRANT = Symbol(
  "server-verified-google-directory-grant",
);

export interface ServerVerifiedGoogleDirectoryGrant {
  readonly [SERVER_VERIFIED_GOOGLE_DIRECTORY_GRANT]: true;
}

const serverVerifiedGrantEvidence = new WeakMap<
  ServerVerifiedGoogleDirectoryGrant,
  ConnectGoogleDirectoryInput["google"]
>();

/**
 * Called only by the server-side Google consent/probe boundary. The unexported
 * symbol means a JSON body cannot masquerade as verified provider evidence.
 */
export function sealServerVerifiedGoogleDirectoryGrant(
  evidence: ConnectGoogleDirectoryInput["google"],
): ServerVerifiedGoogleDirectoryGrant {
  if (!(evidence.refreshToken instanceof Uint8Array)) {
    throw new TypeError("A server-verified Google Directory grant is required");
  }
  try {
    const sealedEvidence = Object.freeze({
      customerId: evidence.customerId,
      providerSubject: evidence.providerSubject,
      hostedDomain: evidence.hostedDomain,
      refreshToken: Uint8Array.from(evidence.refreshToken),
      grantedScopes: Object.freeze([...evidence.grantedScopes]),
      isAdmin: evidence.isAdmin,
      isDelegatedAdmin: evidence.isDelegatedAdmin,
      readProbes: Object.freeze({ ...evidence.readProbes }),
    });
    const grant = Object.freeze({
      [SERVER_VERIFIED_GOOGLE_DIRECTORY_GRANT]: true as const,
    });
    serverVerifiedGrantEvidence.set(grant, sealedEvidence);
    return grant;
  } finally {
    evidence.refreshToken.fill(0);
  }
}

function takeServerVerifiedGoogleDirectoryGrant(
  value: ServerVerifiedGoogleDirectoryGrant,
): ConnectGoogleDirectoryInput["google"] {
  const evidence = typeof value === "object" && value !== null
    ? serverVerifiedGrantEvidence.get(value)
    : undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    value[SERVER_VERIFIED_GOOGLE_DIRECTORY_GRANT] !== true ||
    evidence === undefined
  ) {
    throw new TypeError("A server-verified Google Directory grant is required");
  }
  serverVerifiedGrantEvidence.delete(value);
  return evidence;
}

export interface AuthenticatedGoogleDirectoryConnectionInput {
  /** Authority is taken only from this already-authenticated server session. */
  readonly session: AuthenticatedWebSession;
  /** A connector identifier is not authority; PostgreSQL binds it to the session tenant. */
  readonly connectorId: string;
  /** Opaque evidence produced by the server-side consent/probe boundary. */
  readonly providerGrant: ServerVerifiedGoogleDirectoryGrant;
}

export interface AuthenticatedGoogleDirectoryConnectionDependencies {
  readonly runtime: Pick<DirectoryRuntime, "connect">;
  readonly pool: Pick<DatabasePool, "connect">;
  readonly nextId: () => string;
}

/**
 * Production connection boundary. It intentionally has no workspace, identity,
 * membership, role, customer-authority, or service-actor input supplied by a
 * browser. PostgreSQL revalidates the complete session and tenant/customer bind
 * before storing the opaque SecretAdapter reference.
 */
export function createAuthenticatedGoogleDirectoryConnection(
  dependencies: AuthenticatedGoogleDirectoryConnectionDependencies,
) {
  return Object.freeze({
    async connect(input: AuthenticatedGoogleDirectoryConnectionInput) {
      const { context } = input.session;
      const google = takeServerVerifiedGoogleDirectoryGrant(input.providerGrant);
      try {
        return await dependencies.runtime.connect({
          setup: {
            workspaceId: context.workspaceId,
            connectorId: input.connectorId,
            identityId: context.identityId,
            role: context.workspaceRole,
            requestId: dependencies.nextId(),
            serviceIdentity: DIRECTORY_API_SERVICE_IDENTITY,
          },
          google,
          repository: createPostgresDirectoryConnectionRepository(
            input.session,
            dependencies.pool,
          ),
        });
      } finally {
        google.refreshToken.fill(0);
      }
    },
  });
}

/**
 * Composes the authenticated connection boundary with the approved GCP Secret
 * Manager registration and the existing API-runtime PostgreSQL pool.
 */
export function createConfiguredAuthenticatedGoogleDirectoryConnection(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const config = loadGoogleLoginRuntimeConfig(environment);
  const runtime = createConfiguredGoogleCloudDirectoryRuntime(
    {
      oauthClient: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      },
      nextId: randomUUID,
    },
    environment,
  );
  return createAuthenticatedGoogleDirectoryConnection({
    runtime,
    pool: getRuntimeDatabasePool(config.databaseUrl),
    nextId: randomUUID,
  });
}
