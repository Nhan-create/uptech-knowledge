import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";

export class DatabaseConfigurationError extends Error {
  override readonly name = "DatabaseConfigurationError";
}

export class DatabaseBoundaryError extends Error {
  override readonly name = "DatabaseBoundaryError";
}

export type DatabasePool = Pick<Pool, "connect" | "query">;
export type DatabaseClient = Pick<PoolClient, "query" | "release">;

export interface RequestTransactionContext {
  readonly kind: "request";
  readonly workspaceId: string;
  readonly actorId: string;
  readonly membershipId: string;
  readonly sessionId: string;
  readonly tokenId: string;
  readonly clientType: "WEB" | "NATIVE";
  readonly tokenKind: "WEB_SESSION" | "NATIVE_ACCESS";
  readonly userSecurityVersion: string;
  readonly identitySecurityVersion: string;
  readonly workspaceSecurityVersion: string;
  readonly membershipAuthzVersion: string;
  readonly sessionSecurityVersion: string;
  readonly credentialHash: Uint8Array;
}

export interface WorkerTransactionContext {
  readonly kind: "worker";
  readonly workspaceId: string;
  readonly jobId: string;
  readonly serviceActor: string;
  readonly connectorId: string;
  readonly sourceId: string | null;
  readonly leaseFence: string;
}

export type TransactionContext =
  | RequestTransactionContext
  | WorkerTransactionContext;

export type TransactionWork<T> = (client: DatabaseClient) => Promise<T>;

export interface NormalSessionContext {
  readonly kind: "session";
  readonly identityId: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly membershipId: string;
  readonly sessionId: string;
  readonly tokenId: string;
  readonly clientType: "WEB" | "NATIVE";
  readonly tokenKind: "WEB_SESSION" | "NATIVE_ACCESS";
  readonly workspaceRole: "OWNER" | "ADMIN" | "MEMBER";
  readonly userSecurityVersion: string;
  readonly identitySecurityVersion: string;
  readonly workspaceSecurityVersion: string;
  readonly membershipAuthzVersion: string;
  readonly sessionSecurityVersion: string;
  readonly csrfTokenHash: string | null;
  readonly contextExpiresAt: Date;
}

export interface OnboardingSessionContext {
  readonly kind: "onboarding";
  readonly identityId: string;
  readonly actorId: string;
  readonly allowedOperations: readonly string[];
  readonly contextExpiresAt: Date;
}

export type AuthenticatedSessionContext =
  | NormalSessionContext
  | OnboardingSessionContext;

export function requestTransactionContextFromSession(
  context: NormalSessionContext,
  credentialHash: Uint8Array,
): RequestTransactionContext {
  return Object.freeze({
    kind: "request",
    workspaceId: context.workspaceId,
    actorId: context.actorId,
    membershipId: context.membershipId,
    sessionId: context.sessionId,
    tokenId: context.tokenId,
    clientType: context.clientType,
    tokenKind: context.tokenKind,
    userSecurityVersion: context.userSecurityVersion,
    identitySecurityVersion: context.identitySecurityVersion,
    workspaceSecurityVersion: context.workspaceSecurityVersion,
    membershipAuthzVersion: context.membershipAuthzVersion,
    sessionSecurityVersion: context.sessionSecurityVersion,
    credentialHash: Buffer.from(requireCredentialDigest(credentialHash)),
  });
}

interface AuthenticateSessionRow extends QueryResultRow {
  readonly context_kind: unknown;
  readonly workspace_id?: unknown;
  readonly user_id?: unknown;
  readonly membership_id?: unknown;
  readonly identity_id?: unknown;
  readonly session_id?: unknown;
  readonly token_id?: unknown;
  readonly client_type?: unknown;
  readonly token_kind?: unknown;
  readonly workspace_role?: unknown;
  readonly user_security_version?: unknown;
  readonly identity_security_version?: unknown;
  readonly workspace_security_version?: unknown;
  readonly membership_authz_version?: unknown;
  readonly session_security_version?: unknown;
  readonly csrf_token_hash?: unknown;
  readonly allowed_operations?: unknown;
  readonly context_expires_at?: unknown;
}

const AUTHENTICATE_SESSION_SQL =
  "SELECT * FROM uptech.authenticate_session($1::bytea)";

// set_config(..., true) is PostgreSQL's parameter-safe SET LOCAL equivalent.
// All values are set on the same checked-out client and are transaction-local.
const SET_TRANSACTION_CONTEXT_SQL = `
SELECT
  set_config('app.workspace_id', $1, true),
  set_config('app.actor_id', $2, true),
  set_config('app.membership_id', $3, true),
  set_config('app.session_id', $4, true),
  set_config('app.job_id', $5, true),
  set_config('app.connector_id', $6, true),
  set_config('app.source_id', $7, true),
  set_config('app.lease_fence', $8, true)
`;

// Authentication happens outside tenant RLS. Recheck the exact returned
// session/token and version snapshot after SET LOCAL so a revoke, rotation, or
// membership/workspace security change committed in between cannot race the
// protected request.
const REVALIDATE_REQUEST_CONTEXT_SQL = `
SELECT count(*)::integer AS matching_context_count
FROM uptech.authenticate_session($1::bytea) AS current_context
WHERE current_context.context_kind = 'SESSION'
  AND current_context.workspace_id = $2::uuid
  AND current_context.user_id = $3::uuid
  AND current_context.membership_id = $4::uuid
  AND current_context.session_id = $5::uuid
  AND current_context.token_id = $6::uuid
  AND current_context.client_type = $7::text
  AND current_context.token_kind = $8::text
  AND current_context.user_security_version = $9::bigint
  AND current_context.identity_security_version = $10::bigint
  AND current_context.workspace_security_version = $11::bigint
  AND current_context.membership_authz_version = $12::bigint
  AND current_context.session_security_version = $13::bigint
`;

const poolGlobal = globalThis as typeof globalThis & {
  __uptechKnowledgeDatabasePool?: Pool;
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertExplicitPoolConfiguration(config: PoolConfig | undefined): void {
  if (config === undefined) {
    throw new DatabaseConfigurationError(
      "Explicit PostgreSQL configuration is required",
    );
  }

  if (hasNonEmptyString(config.connectionString)) {
    return;
  }

  if (
    hasNonEmptyString(config.host) &&
    hasNonEmptyString(config.database) &&
    hasNonEmptyString(config.user)
  ) {
    return;
  }

  throw new DatabaseConfigurationError(
    "PostgreSQL configuration is incomplete",
  );
}

export function createDatabasePool(config: PoolConfig | undefined): Pool {
  assertExplicitPoolConfiguration(config);
  return new Pool(config);
}

export function initializeDatabasePool(config: PoolConfig | undefined): Pool {
  if (poolGlobal.__uptechKnowledgeDatabasePool !== undefined) {
    throw new DatabaseConfigurationError(
      "PostgreSQL pool has already been initialized",
    );
  }

  const pool = createDatabasePool(config);
  poolGlobal.__uptechKnowledgeDatabasePool = pool;
  return pool;
}

export function getDatabasePool(): Pool {
  const pool = poolGlobal.__uptechKnowledgeDatabasePool;
  if (pool === undefined) {
    throw new DatabaseConfigurationError(
      "PostgreSQL pool is unavailable because it was not initialized",
    );
  }

  return pool;
}

function requireContextValue(label: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes("\0")
  ) {
    throw new DatabaseBoundaryError(`${label} is invalid`);
  }

  return value;
}

function requireCredentialDigest(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) {
    throw new DatabaseBoundaryError(
      "one SHA-256 session credential digest is required",
    );
  }

  return value;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function requireLeaseFence(value: unknown): string {
  if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
    throw new DatabaseBoundaryError("leaseFence is invalid");
  }

  return value;
}

function requireRequestVersion(label: string, value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new DatabaseBoundaryError(`${label} is invalid`);
  }

  return value;
}

function requireRequestClientType(value: unknown): "WEB" | "NATIVE" {
  if (value === "WEB" || value === "NATIVE") {
    return value;
  }

  throw new DatabaseBoundaryError("clientType is invalid");
}

function requireRequestTokenKind(
  value: unknown,
): "WEB_SESSION" | "NATIVE_ACCESS" {
  if (value === "WEB_SESSION" || value === "NATIVE_ACCESS") {
    return value;
  }

  throw new DatabaseBoundaryError("tokenKind is invalid");
}

function transactionContextParameters(
  context: TransactionContext,
): readonly [string, string, string, string, string, string, string, string] {
  const workspaceId = requireContextValue("workspaceId", context.workspaceId);

  if (context.kind === "request") {
    return [
      workspaceId,
      requireContextValue("actorId", context.actorId),
      requireContextValue("membershipId", context.membershipId),
      requireContextValue("sessionId", context.sessionId),
      "",
      "",
      "",
      "",
    ];
  }

  return [
    workspaceId,
    requireContextValue("serviceActor", context.serviceActor),
    "",
    "",
    requireContextValue("jobId", context.jobId),
    requireContextValue("connectorId", context.connectorId),
    context.sourceId === null
      ? ""
      : requireContextValue("sourceId", context.sourceId),
    requireLeaseFence(context.leaseFence),
  ];
}

function requestContextValidationParameters(
  context: RequestTransactionContext,
): readonly unknown[] {
  return [
    Buffer.from(requireCredentialDigest(context.credentialHash)),
    requireContextValue("workspaceId", context.workspaceId),
    requireContextValue("actorId", context.actorId),
    requireContextValue("membershipId", context.membershipId),
    requireContextValue("sessionId", context.sessionId),
    requireContextValue("tokenId", context.tokenId),
    requireRequestClientType(context.clientType),
    requireRequestTokenKind(context.tokenKind),
    requireRequestVersion("userSecurityVersion", context.userSecurityVersion),
    requireRequestVersion(
      "identitySecurityVersion",
      context.identitySecurityVersion,
    ),
    requireRequestVersion(
      "workspaceSecurityVersion",
      context.workspaceSecurityVersion,
    ),
    requireRequestVersion(
      "membershipAuthzVersion",
      context.membershipAuthzVersion,
    ),
    requireRequestVersion(
      "sessionSecurityVersion",
      context.sessionSecurityVersion,
    ),
  ];
}

interface RequestContextValidationRow extends QueryResultRow {
  readonly matching_context_count: unknown;
}

async function revalidateRequestContext(
  client: DatabaseClient,
  parameters: readonly unknown[],
): Promise<void> {
  const result = await client.query<RequestContextValidationRow>(
    REVALIDATE_REQUEST_CONTEXT_SQL,
    [...parameters],
  );

  if (
    result.rows.length !== 1 ||
    result.rows[0].matching_context_count !== 1
  ) {
    throw new DatabaseBoundaryError("request session context is no longer valid");
  }
}

async function withTransactionContext<T>(
  context: TransactionContext,
  work: TransactionWork<T>,
  pool: Pick<DatabasePool, "connect">,
): Promise<T> {
  const parameters = transactionContextParameters(context);
  const requestValidationParameters =
    context.kind === "request"
      ? requestContextValidationParameters(context)
      : undefined;
  const client = await pool.connect();
  let began = false;
  let discardClient = false;

  try {
    await client.query("BEGIN");
    began = true;
    await client.query(SET_TRANSACTION_CONTEXT_SQL, [...parameters]);
    if (requestValidationParameters !== undefined) {
      await revalidateRequestContext(client, requestValidationParameters);
    }

    const result = await work(client);
    await client.query("COMMIT");
    began = false;
    return result;
  } catch (error) {
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        discardClient = true;
        throw new AggregateError(
          [error, rollbackError],
          "Database transaction and rollback both failed",
        );
      }
    }

    throw error;
  } finally {
    if (discardClient) {
      client.release(true);
    } else {
      client.release();
    }
  }
}

export function withRequestTransaction<T>(
  context: RequestTransactionContext,
  work: TransactionWork<T>,
  pool: Pick<DatabasePool, "connect"> = getDatabasePool(),
): Promise<T> {
  return withTransactionContext(context, work, pool);
}

export function withWorkerTransaction<T>(
  context: WorkerTransactionContext,
  work: TransactionWork<T>,
  pool: Pick<DatabasePool, "connect"> = getDatabasePool(),
): Promise<T> {
  return withTransactionContext(context, work, pool);
}

function requireResultString(label: string, value: unknown): string {
  if (!hasNonEmptyString(value)) {
    throw new DatabaseBoundaryError(
      `authenticate_session returned an invalid ${label}`,
    );
  }

  return value;
}

function requireResultDate(label: string, value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DatabaseBoundaryError(
      `authenticate_session returned an invalid ${label}`,
    );
  }

  return new Date(value.getTime());
}

function requirePositiveVersion(label: string, value: unknown): string {
  if (
    typeof value === "string" &&
    /^[1-9][0-9]*$/u.test(value)
  ) {
    return value;
  }

  if (typeof value === "bigint" && value > BigInt(0)) {
    return value.toString();
  }

  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return String(value);
  }

  throw new DatabaseBoundaryError(
    `authenticate_session returned an invalid ${label}`,
  );
}

function requireClientType(value: unknown): "WEB" | "NATIVE" {
  if (value === "WEB" || value === "NATIVE") {
    return value;
  }

  throw new DatabaseBoundaryError(
    "authenticate_session returned an invalid client_type",
  );
}

function requireWorkspaceRole(
  value: unknown,
): "OWNER" | "ADMIN" | "MEMBER" {
  if (value === "OWNER" || value === "ADMIN" || value === "MEMBER") {
    return value;
  }

  throw new DatabaseBoundaryError(
    "authenticate_session returned an invalid workspace_role",
  );
}

function sessionCredentialContext(row: AuthenticateSessionRow): Readonly<{
  clientType: "WEB" | "NATIVE";
  tokenKind: "WEB_SESSION" | "NATIVE_ACCESS";
  csrfTokenHash: string | null;
}> {
  const clientType = requireClientType(row.client_type);

  if (clientType === "WEB") {
    if (row.token_kind !== "WEB_SESSION") {
      throw new DatabaseBoundaryError(
        "authenticate_session returned an invalid WEB token_kind",
      );
    }
    if (
      !(row.csrf_token_hash instanceof Uint8Array) ||
      row.csrf_token_hash.byteLength !== 32
    ) {
      throw new DatabaseBoundaryError(
        "authenticate_session returned an invalid WEB csrf_token_hash",
      );
    }

    return {
      clientType,
      tokenKind: "WEB_SESSION",
      csrfTokenHash: Buffer.from(row.csrf_token_hash).toString("hex"),
    };
  }

  if (row.token_kind !== "NATIVE_ACCESS" || row.csrf_token_hash !== null) {
    throw new DatabaseBoundaryError(
      "authenticate_session returned an invalid NATIVE credential context",
    );
  }

  return {
    clientType,
    tokenKind: "NATIVE_ACCESS",
    csrfTokenHash: null,
  };
}

function parseSessionContext(
  row: AuthenticateSessionRow,
): AuthenticatedSessionContext {
  if (row.context_kind === "SESSION") {
    const credentialContext = sessionCredentialContext(row);
    return {
      kind: "session",
      identityId: requireResultString("identity_id", row.identity_id),
      workspaceId: requireResultString("workspace_id", row.workspace_id),
      actorId: requireResultString("user_id", row.user_id),
      membershipId: requireResultString(
        "membership_id",
        row.membership_id,
      ),
      sessionId: requireResultString("session_id", row.session_id),
      tokenId: requireResultString("token_id", row.token_id),
      clientType: credentialContext.clientType,
      tokenKind: credentialContext.tokenKind,
      workspaceRole: requireWorkspaceRole(row.workspace_role),
      userSecurityVersion: requirePositiveVersion(
        "user_security_version",
        row.user_security_version,
      ),
      identitySecurityVersion: requirePositiveVersion(
        "identity_security_version",
        row.identity_security_version,
      ),
      workspaceSecurityVersion: requirePositiveVersion(
        "workspace_security_version",
        row.workspace_security_version,
      ),
      membershipAuthzVersion: requirePositiveVersion(
        "membership_authz_version",
        row.membership_authz_version,
      ),
      sessionSecurityVersion: requirePositiveVersion(
        "session_security_version",
        row.session_security_version,
      ),
      csrfTokenHash: credentialContext.csrfTokenHash,
      contextExpiresAt: requireResultDate(
        "context_expires_at",
        row.context_expires_at,
      ),
    };
  }

  if (row.context_kind === "ONBOARDING") {
    if (
      row.workspace_id !== null ||
      row.membership_id !== null ||
      row.session_id !== null ||
      row.client_type !== null ||
      row.workspace_role !== null ||
      row.workspace_security_version !== null ||
      row.membership_authz_version !== null ||
      row.session_security_version !== null ||
      row.csrf_token_hash !== null
    ) {
      throw new DatabaseBoundaryError(
        "authenticate_session returned tenant or session authority for onboarding",
      );
    }

    if (
      !Array.isArray(row.allowed_operations) ||
      !row.allowed_operations.every(hasNonEmptyString)
    ) {
      throw new DatabaseBoundaryError(
        "authenticate_session returned invalid onboarding operations",
      );
    }

    return {
      kind: "onboarding",
      identityId: requireResultString("identity_id", row.identity_id),
      actorId: requireResultString("user_id", row.user_id),
      allowedOperations: Object.freeze([...row.allowed_operations]),
      contextExpiresAt: requireResultDate(
        "context_expires_at",
        row.context_expires_at,
      ),
    };
  }

  throw new DatabaseBoundaryError(
    "authenticate_session returned an unknown context kind",
  );
}

export async function authenticateSession(
  credentialHash: Uint8Array,
  pool: Pick<DatabasePool, "query"> = getDatabasePool(),
): Promise<AuthenticatedSessionContext | null> {
  requireCredentialDigest(credentialHash);

  const result = await pool.query<AuthenticateSessionRow>(
    AUTHENTICATE_SESSION_SQL,
    [Buffer.from(credentialHash)],
  );

  if (result.rows.length === 0) {
    return null;
  }

  if (result.rows.length !== 1) {
    throw new DatabaseBoundaryError(
      "authenticate_session returned a non-scalar result",
    );
  }

  return parseSessionContext(result.rows[0]);
}
