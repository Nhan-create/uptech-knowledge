import type { AuthenticatedWebSession } from "../auth/web-session.ts";
import {
  requestTransactionContextFromSession,
  type DatabasePool,
  withRequestTransaction,
} from "../db/core.ts";
import type { PreparedDirectoryConsent } from "./directory-consent.ts";

const PREPARE_DIRECTORY_CONSENT_SQL =
  "SELECT * FROM uptech.prepare_directory_consent_v1($1::uuid)";
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DOMAIN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;

interface PreparationRow {
  readonly outcome?: unknown;
  readonly connector_id?: unknown;
  readonly provider_subject?: unknown;
  readonly provider_email?: unknown;
  readonly hosted_domain?: unknown;
}

export class DirectoryConsentRepositoryError extends Error {
  override readonly name = "DirectoryConsentRepositoryError";
}

function denied(): never {
  throw new DirectoryConsentRepositoryError("Directory consent is denied");
}

function prepared(row: PreparationRow | undefined): PreparedDirectoryConsent {
  if (
    row?.outcome !== "PREPARED" ||
    typeof row.connector_id !== "string" ||
    !UUID_V4.test(row.connector_id) ||
    typeof row.provider_subject !== "string" ||
    row.provider_subject.length < 1 ||
    row.provider_subject.length > 512 ||
    row.provider_subject.includes("\0") ||
    typeof row.provider_email !== "string" ||
    row.provider_email !== row.provider_email.toLowerCase() ||
    !/^[^\s@]+@[^\s@]+$/u.test(row.provider_email) ||
    typeof row.hosted_domain !== "string" ||
    row.hosted_domain !== row.hosted_domain.toLowerCase() ||
    !DOMAIN.test(row.hosted_domain)
  ) return denied();
  return Object.freeze({
    connectorId: row.connector_id,
    providerSubject: row.provider_subject,
    normalizedEmail: row.provider_email,
    hostedDomain: row.hosted_domain,
  });
}

export function createPostgresDirectoryConsentRepository(
  pool: Pick<DatabasePool, "connect">,
) {
  return Object.freeze({
    async prepare(input: {
      readonly session: AuthenticatedWebSession;
      readonly requestId: string;
    }): Promise<PreparedDirectoryConsent> {
      if (!UUID_V4.test(input.requestId)) return denied();
      try {
        return await withRequestTransaction(
          requestTransactionContextFromSession(
            input.session.context,
            input.session.credentialHash,
          ),
          async (client) => {
            const result = await client.query<PreparationRow>(
              PREPARE_DIRECTORY_CONSENT_SQL,
              [input.requestId],
            );
            return result.rows.length === 1
              ? prepared(result.rows[0])
              : denied();
          },
          pool,
        );
      } catch {
        return denied();
      }
    },
  });
}
