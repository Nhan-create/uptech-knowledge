import type { QueryResultRow } from "pg";

import type { DatabasePool } from "../../db/core.ts";
import type {
  MobileMembershipSummary,
  MobileSessionRepository,
} from "./session-service.ts";
import type { MobileAuthUiCategory } from "./google-service.ts";

export class MobileSessionRepositoryError extends Error {
  override readonly name = "MobileSessionRepositoryError";
}

const EXCHANGE_SQL = `
SELECT result.outcome::text AS outcome, result.session_id,
  result.access_expires_at, result.refresh_expires_at,
  result.active_workspace_id, result.memberships,
  result.denial_category::text AS denial_category
FROM uptech.exchange_mobile_handoff_directory_v1(
  $1::uptech.google_auth_hash32_v1, $2::uptech.google_auth_hash32_v1,
  $3::uptech.google_auth_hash32_v1, $4::uptech.google_auth_hash32_v1,
  $5::uptech.google_auth_hash32_v1, $6::uptech.google_auth_hash32_v1, $7::uuid
) AS result`;

const REFRESH_SQL = `
SELECT result.outcome::text AS outcome, result.replay_capsule,
  result.access_expires_at, result.refresh_expires_at
FROM uptech.rotate_mobile_refresh_directory_v1(
  $1::uptech.google_auth_hash32_v1, $2::uptech.google_auth_hash32_v1,
  $3::uptech.google_auth_hash32_v1, $4::uptech.google_auth_hash32_v1,
  $5::bytea, $6::uptech.google_auth_ascii_identifier_v1, $7::uuid
) AS result`;

const AUTHENTICATE_SQL = `
SELECT result.outcome::text AS outcome, result.session_id, result.user_id,
  result.identity_id, result.workspace_id, result.membership_id,
  result.workspace_role::text AS role
FROM uptech.authenticate_mobile_access_directory_v1(
  $1::uptech.google_auth_hash32_v1
) AS result`;

const LIST_SQL = `
SELECT result.outcome::text AS outcome, result.memberships
FROM uptech.list_mobile_workspaces_directory_v1(
  $1::uptech.google_auth_hash32_v1
) AS result`;

const SWITCH_SQL = `
SELECT result.outcome::text AS outcome, result.access_expires_at,
  result.refresh_expires_at, result.replay_capsule
FROM uptech.switch_mobile_workspace_directory_v1(
  $1::uptech.google_auth_hash32_v1, $2::uuid,
  $3::uptech.google_auth_hash32_v1, $4::uptech.google_auth_hash32_v1,
  $5::uptech.google_auth_hash32_v1, $6::bytea,
  $7::uptech.google_auth_ascii_identifier_v1, $8::uuid
) AS result`;

const REVOKE_SQL = `SELECT uptech.revoke_mobile_session_v1(
  $1::uptech.google_auth_hash32_v1, $2::uuid
)::text AS outcome`;

function one<Row extends QueryResultRow>(rows: Row[]): Row {
  if (rows.length !== 1) throw new MobileSessionRepositoryError("Invalid routine result");
  return rows[0];
}

function date(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new MobileSessionRepositoryError("Invalid routine date");
  }
  return new Date(value);
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new MobileSessionRepositoryError("Invalid routine identifier");
  }
  return value;
}

function memberships(value: unknown): readonly MobileMembershipSummary[] {
  if (!Array.isArray(value)) throw new MobileSessionRepositoryError("Invalid memberships");
  return Object.freeze(value.map((entry) => {
    if (
      typeof entry !== "object" || entry === null || Array.isArray(entry) ||
      !("workspace_id" in entry) || !("membership_id" in entry) || !("role" in entry) ||
      (entry.role !== "OWNER" && entry.role !== "ADMIN" && entry.role !== "MEMBER")
    ) throw new MobileSessionRepositoryError("Invalid membership");
    return Object.freeze({
      workspaceId: identifier(entry.workspace_id),
      membershipId: identifier(entry.membership_id),
      role: entry.role,
    });
  }));
}

function values(...items: readonly unknown[]) {
  return items.map((item) => item instanceof Uint8Array ? Buffer.from(item) : item);
}

const MOBILE_LOGIN_DENIAL_CATEGORIES = new Set<MobileAuthUiCategory>([
  "PERSONAL_GOOGLE_ACCOUNT",
  "UNKNOWN_WORKSPACE",
  "USER_NOT_PROVISIONED",
  "USER_SUSPENDED",
  "WORKSPACE_SUSPENDED",
  "POLICY_OR_DEVICE_BLOCKED",
  "GOOGLE_CANCELLED",
  "PROVIDER_UNAVAILABLE",
  "AUTH_ERROR",
]);

export function parseMobileLoginDenialCategory(value: unknown): MobileAuthUiCategory {
  if (
    typeof value !== "string" ||
    !MOBILE_LOGIN_DENIAL_CATEGORIES.has(value as MobileAuthUiCategory)
  ) {
    throw new MobileSessionRepositoryError("Invalid mobile denial category");
  }
  return value as MobileAuthUiCategory;
}

export function createMobileSessionRepository(
  pool: Pick<DatabasePool, "query">,
): MobileSessionRepository {
  const implementation: MobileSessionRepository = {
    async exchangeHandoff(input) {
      const row = one((await pool.query(EXCHANGE_SQL, values(
        input.networkHmac, input.handoffHash, input.appExchangeChallenge, input.installationBinding,
        input.accessTokenHash, input.refreshTokenHash, input.requestId,
      ))).rows as QueryResultRow[]);
      if (row.outcome === "DENIED" || row.outcome === "RATE_LIMITED") {
        return { outcome: row.outcome };
      }
      if (row.outcome === "ACCESS_DENIED") {
        if (
          row.session_id !== null ||
          row.access_expires_at !== null ||
          row.refresh_expires_at !== null ||
          row.active_workspace_id !== null ||
          row.memberships !== null
        ) {
          throw new MobileSessionRepositoryError("Denial handoff returned session authority");
        }
        return {
          outcome: "ACCESS_DENIED",
          category: parseMobileLoginDenialCategory(row.denial_category),
        };
      }
      if (row.outcome !== "ISSUED") throw new MobileSessionRepositoryError("Invalid exchange outcome");
      return {
        outcome: "ISSUED", sessionId: identifier(row.session_id),
        accessExpiresAt: date(row.access_expires_at),
        refreshExpiresAt: date(row.refresh_expires_at),
        activeWorkspaceId: identifier(row.active_workspace_id),
        memberships: memberships(row.memberships),
      };
    },
    async refresh(input) {
      const row = one((await pool.query(REFRESH_SQL, values(
        input.predecessorRefreshHash, input.installationBinding,
        input.accessTokenHash, input.refreshTokenHash, input.replayCapsule,
        input.idempotencyKey, input.requestId,
      ))).rows as QueryResultRow[]);
      if (["DENIED", "FAMILY_REVOKED", "SESSION_REVOKED", "SESSION_EXPIRED"].includes(row.outcome)) {
        return { outcome: row.outcome as "DENIED" | "FAMILY_REVOKED" | "SESSION_REVOKED" | "SESSION_EXPIRED" };
      }
      if (row.outcome !== "ROTATED" && row.outcome !== "REPLAY") {
        throw new MobileSessionRepositoryError("Invalid refresh outcome");
      }
      const common = {
        accessExpiresAt: date(row.access_expires_at),
        refreshExpiresAt: date(row.refresh_expires_at),
      };
      if (row.outcome === "ROTATED") return { outcome: "ROTATED", ...common };
      if (!(row.replay_capsule instanceof Uint8Array) || row.replay_capsule.byteLength !== 115) {
        throw new MobileSessionRepositoryError("Invalid replay capsule");
      }
      return { outcome: "REPLAY", replayCapsule: Uint8Array.from(row.replay_capsule), ...common };
    },
    async authenticate(input) {
      const row = one((await pool.query(AUTHENTICATE_SQL, values(input.accessTokenHash))).rows as QueryResultRow[]);
      if (["DENIED", "ACCESS_TOKEN_EXPIRED", "SESSION_EXPIRED", "SESSION_REVOKED"].includes(row.outcome)) {
        return { outcome: row.outcome as "DENIED" | "ACCESS_TOKEN_EXPIRED" | "SESSION_EXPIRED" | "SESSION_REVOKED" };
      }
      if (row.outcome !== "AUTHORIZED" || !["OWNER", "ADMIN", "MEMBER"].includes(row.role)) {
        throw new MobileSessionRepositoryError("Invalid authentication outcome");
      }
      return {
        outcome: "AUTHORIZED", sessionId: identifier(row.session_id),
        userId: identifier(row.user_id), identityId: identifier(row.identity_id),
        workspaceId: identifier(row.workspace_id), membershipId: identifier(row.membership_id),
        role: row.role as "OWNER" | "ADMIN" | "MEMBER",
      };
    },
    async listWorkspaces(input) {
      const row = one((await pool.query(LIST_SQL, values(input.accessTokenHash))).rows as QueryResultRow[]);
      if (["DENIED", "ACCESS_TOKEN_EXPIRED", "SESSION_EXPIRED", "SESSION_REVOKED"].includes(row.outcome)) {
        return { outcome: row.outcome as "DENIED" | "ACCESS_TOKEN_EXPIRED" | "SESSION_EXPIRED" | "SESSION_REVOKED" };
      }
      if (row.outcome !== "AUTHORIZED") {
        throw new MobileSessionRepositoryError("Invalid workspace-list outcome");
      }
      return { outcome: "AUTHORIZED", memberships: memberships(row.memberships) };
    },
    async switchWorkspace(input) {
      const row = one((await pool.query(SWITCH_SQL, values(
        input.accessTokenHash, input.targetWorkspaceId, input.installationBinding,
        input.accessTokenHashCandidate, input.refreshTokenHashCandidate,
        input.replayCapsule, input.idempotencyKey, input.requestId,
      ))).rows as QueryResultRow[]);
      if (row.outcome === "DENIED") return { outcome: "DENIED" };
      if (row.outcome !== "ROTATED" && row.outcome !== "REPLAY") {
        throw new MobileSessionRepositoryError("Invalid switch outcome");
      }
      const common = { accessExpiresAt: date(row.access_expires_at),
        refreshExpiresAt: date(row.refresh_expires_at) };
      if (row.outcome === "ROTATED") return { outcome: "ROTATED", ...common };
      if (!(row.replay_capsule instanceof Uint8Array) || row.replay_capsule.byteLength !== 115) {
        throw new MobileSessionRepositoryError("Invalid switch replay capsule");
      }
      return { outcome: "REPLAY", replayCapsule: Uint8Array.from(row.replay_capsule), ...common };
    },
    async revoke(input) {
      const row = one((await pool.query(REVOKE_SQL, values(input.accessTokenHash, input.requestId))).rows as QueryResultRow[]);
      if (row.outcome !== "REVOKED" && row.outcome !== "DENIED") throw new MobileSessionRepositoryError("Invalid revoke outcome");
      return row.outcome;
    },
  };
  return Object.freeze(implementation);
}
