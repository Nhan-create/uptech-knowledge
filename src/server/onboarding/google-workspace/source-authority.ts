import type { QueryResultRow } from "pg";

import type { DatabasePool } from "../../db/core.ts";
import type { GoogleWorkspaceBootstrapIdentity } from "./service.ts";

const REQUIRED_OPERATION = "FIRST_DOMAIN_CLAIM_RESERVE";
const SOURCE_SQL = `SELECT
  source.identity_id::text AS identity_id,
  source.provider_subject::text AS provider_subject,
  source.normalized_email::text AS normalized_email,
  source.hosted_domain::text AS hosted_domain,
  source.identity_active,
  source.user_active
FROM uptech.authenticate_google_workspace_bootstrap_source_v1(
  $1::uptech.google_auth_hash32_v1
) AS source`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SUBJECT = /^[\x21-\x7e]{1,255}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+$/u;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const ROW_KEYS = [
  "hosted_domain", "identity_active", "identity_id", "normalized_email",
  "provider_subject", "user_active",
] as const;

export class GoogleWorkspaceSourceAuthorityUnavailableError extends Error {
  override readonly name = "GoogleWorkspaceSourceAuthorityUnavailableError";
  constructor() { super("Google Workspace source authority is unavailable"); }
}

function unavailable(): never {
  throw new GoogleWorkspaceSourceAuthorityUnavailableError();
}

function parse(row: QueryResultRow): GoogleWorkspaceBootstrapIdentity {
  if (Object.keys(row).sort().join("\u0000") !== [...ROW_KEYS].sort().join("\u0000") ||
      typeof row.identity_id !== "string" || !UUID.test(row.identity_id) ||
      typeof row.provider_subject !== "string" || !SUBJECT.test(row.provider_subject) ||
      typeof row.normalized_email !== "string" || row.normalized_email.length > 320 ||
      row.normalized_email !== row.normalized_email.toLowerCase() || !EMAIL.test(row.normalized_email) ||
      typeof row.hosted_domain !== "string" || row.hosted_domain.length > 253 ||
      !DOMAIN.test(row.hosted_domain) || !row.normalized_email.endsWith(`@${row.hosted_domain}`) ||
      row.identity_active !== true || row.user_active !== true) {
    return unavailable();
  }
  return Object.freeze({
    identityId: row.identity_id,
    providerSubject: row.provider_subject,
    normalizedEmail: row.normalized_email,
    hostedDomain: row.hosted_domain,
    identityActive: true,
    userActive: true,
  });
}

export function createGoogleWorkspaceBootstrapSourceAuthority(
  pool: Pick<DatabasePool, "query">,
): {
  authenticate(input: {
    readonly credentialHash: Uint8Array;
    readonly requiredOperation: typeof REQUIRED_OPERATION;
  }): Promise<GoogleWorkspaceBootstrapIdentity | null>;
} {
  return Object.freeze({
    async authenticate(input) {
      if (input?.requiredOperation !== REQUIRED_OPERATION ||
          !(input.credentialHash instanceof Uint8Array) || input.credentialHash.byteLength !== 32) {
        return unavailable();
      }
      try {
        const result = await pool.query<QueryResultRow>(SOURCE_SQL, [Buffer.from(input.credentialHash)]);
        if (result.rows.length === 0) return null;
        if (result.rows.length !== 1) return unavailable();
        return parse(result.rows[0]!);
      } catch (error) {
        if (error instanceof GoogleWorkspaceSourceAuthorityUnavailableError) throw error;
        return unavailable();
      }
    },
  });
}
