import type { QueryResultRow } from "pg";

import type { DatabasePool } from "../../db/core.ts";
import type { VerifiedGoogleClaims } from "./claims.ts";
import type { WebPkceEnvelope } from "./crypto.ts";

export type GoogleLoginRejectionClass =
  | "PROTOCOL_INVALID"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REJECTED"
  | "CLAIMS_INVALID"
  | "IDENTITY_INELIGIBLE"
  | "INTERNAL_FAILURE";

export type GoogleLoginBeginResult =
  | { readonly outcome: "CREATED"; readonly expiresAt: Date }
  | { readonly outcome: "RATE_LIMITED" | "DENIED" };

export type GoogleLoginConsumeResult =
  | {
      readonly outcome: "RESERVED";
      readonly configurationKey: "GOOGLE_WEB_LOGIN_V1";
      readonly expectedNonceHash: Uint8Array;
      readonly pkceEnvelope: WebPkceEnvelope;
      readonly pkceKmsKeyVersion: string;
      readonly pkceAssociatedData: Uint8Array;
      readonly completionExpiresAt: Date;
    }
  | { readonly outcome: "RATE_LIMITED" | "DENIED" };

export type GoogleLoginCompletionResult =
  | { readonly outcome: "NORMAL" }
  | {
      readonly outcome: "ONBOARDING";
      readonly allowedOperations: readonly string[];
      readonly expiresAt: Date;
    }
  | { readonly outcome: "DENIED" };

export interface BeginGoogleLoginInput {
  readonly networkHmac: Uint8Array;
  readonly stateHash: Uint8Array;
  readonly nonceHash: Uint8Array;
  readonly browserBindingHash: Uint8Array;
  readonly pkceEnvelope: WebPkceEnvelope;
  readonly requestId: string;
}

export interface ConsumeGoogleLoginInput {
  readonly networkHmac: Uint8Array;
  readonly stateHash: Uint8Array;
  readonly browserBindingHash: Uint8Array;
  readonly completionHandleHash: Uint8Array;
  readonly requestId: string;
}

export interface CompleteGoogleLoginInput {
  readonly completionHandleHash: Uint8Array;
  readonly claims: VerifiedGoogleClaims;
  readonly sessionTokenHash: Uint8Array;
  readonly csrfTokenHash: Uint8Array;
  readonly onboardingTokenHash: Uint8Array;
  readonly requestId: string;
}

export interface GoogleLoginRepository {
  begin(input: BeginGoogleLoginInput): Promise<GoogleLoginBeginResult>;
  consume(input: ConsumeGoogleLoginInput): Promise<GoogleLoginConsumeResult>;
  complete(input: CompleteGoogleLoginInput): Promise<GoogleLoginCompletionResult>;
  rejectUnbound(input: {
    readonly networkHmac: Uint8Array;
    readonly rejectionClass: GoogleLoginRejectionClass;
    readonly requestId: string;
  }): Promise<"RECORDED" | "RATE_LIMITED">;
  rejectBound(input: {
    readonly completionHandleHash: Uint8Array;
    readonly rejectionClass: GoogleLoginRejectionClass;
    readonly requestId: string;
  }): Promise<"RECORDED" | "RATE_LIMITED">;
}

export class GoogleLoginRepositoryError extends Error {
  override readonly name = "GoogleLoginRepositoryError";
}

interface BeginRow extends QueryResultRow {
  readonly outcome: unknown;
  readonly expires_at: unknown;
}

interface ConsumeRow extends QueryResultRow {
  readonly outcome: unknown;
  readonly configuration_key: unknown;
  readonly expected_nonce_hash: unknown;
  readonly envelope_version: unknown;
  readonly algorithm: unknown;
  readonly nonce: unknown;
  readonly ciphertext: unknown;
  readonly tag: unknown;
  readonly pkce_kms_key_version: unknown;
  readonly pkce_associated_data: unknown;
  readonly completion_expires_at: unknown;
}

interface CompletionRow extends QueryResultRow {
  readonly outcome: unknown;
  readonly allowed_operations: unknown;
  readonly expires_at: unknown;
}

interface RejectionRow extends QueryResultRow {
  readonly outcome: unknown;
}

const BEGIN_SQL = `
SELECT result.outcome::text AS outcome, result.expires_at
FROM uptech.begin_google_login_transaction_v1(
  'WEB_LOGIN'::uptech.google_login_purpose_v1,
  $1::uptech.google_auth_hash32_v1,
  $2::uptech.google_auth_hash32_v1,
  $3::uptech.google_auth_hash32_v1,
  $4::uptech.google_auth_hash32_v1,
  ROW(
    $5::smallint,
    $6::uptech.google_auth_pkce_algorithm_v1,
    $7::uptech.google_auth_nonce12_v1,
    $8::uptech.google_auth_pkce_ciphertext_v1,
    $9::uptech.google_auth_tag16_v1
  )::uptech.google_web_pkce_envelope_v1,
  $10::uuid
) AS result
`;

const CONSUME_SQL = `
SELECT
  result.outcome::text AS outcome,
  result.configuration_key::text AS configuration_key,
  result.expected_nonce_hash,
  (result.pkce_envelope).envelope_version AS envelope_version,
  (result.pkce_envelope).algorithm::text AS algorithm,
  (result.pkce_envelope).nonce AS nonce,
  (result.pkce_envelope).ciphertext AS ciphertext,
  (result.pkce_envelope).tag AS tag,
  result.pkce_kms_key_version::text AS pkce_kms_key_version,
  result.pkce_associated_data,
  result.completion_expires_at
FROM uptech.consume_google_login_transaction_v1(
  'WEB_LOGIN'::uptech.google_login_purpose_v1,
  $1::uptech.google_auth_hash32_v1,
  $2::uptech.google_auth_hash32_v1,
  $3::uptech.google_auth_hash32_v1,
  $4::uptech.google_auth_hash32_v1,
  $5::uuid
) AS result
`;

const COMPLETE_SQL = `
SELECT result.outcome::text AS outcome,
       result.allowed_operations,
       result.expires_at
FROM uptech.complete_web_google_login_v1(
  $1::uptech.google_auth_hash32_v1,
  ROW(
    $2::uptech.google_auth_issuer_v1,
    $3::uptech.google_provider_subject_v1,
    $4::uptech.google_normalized_email_v1,
    $5::boolean,
    $6::uptech.google_normalized_domain_v1,
    $7::timestamptz,
    $8::timestamptz,
    $9::uptech.google_auth_configuration_key_v1,
    $10::uptech.google_auth_configuration_key_v1,
    $11::uptech.google_auth_hash32_v1
  )::uptech.google_verified_claims_assertion_v1,
  $12::uptech.google_auth_hash32_v1,
  $13::uptech.google_auth_hash32_v1,
  $14::uptech.google_auth_hash32_v1,
  $15::uuid
) AS result
`;

const REJECT_UNBOUND_SQL = `
SELECT uptech.record_google_login_rejection_v1(
  'WEB_LOGIN'::uptech.google_login_purpose_v1,
  $1::uptech.google_auth_hash32_v1,
  $2::uptech.google_auth_rejection_class_v1,
  $3::uuid
)::text AS outcome
`;

const REJECT_BOUND_SQL = `
SELECT uptech.record_google_login_rejection_v1(
  $1::uptech.google_auth_hash32_v1,
  $2::uptech.google_auth_rejection_class_v1,
  $3::uuid
)::text AS outcome
`;

function requireSingleRow<T extends QueryResultRow>(rows: T[]): T {
  if (rows.length !== 1) {
    throw new GoogleLoginRepositoryError("Google login routine result is invalid");
  }
  return rows[0];
}

function requireDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new GoogleLoginRepositoryError("Google login routine date is invalid");
  }
  return new Date(value.getTime());
}

function requireBytes(value: unknown, length?: number): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    (length !== undefined && value.byteLength !== length)
  ) {
    throw new GoogleLoginRepositoryError("Google login routine bytes are invalid");
  }
  return Uint8Array.from(value);
}

function requireKeyVersion(value: unknown): string {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,128}$/u.test(value)) {
    throw new GoogleLoginRepositoryError(
      "Google login PKCE key version is invalid",
    );
  }
  return value;
}

function requireEnvelope(row: ConsumeRow): WebPkceEnvelope {
  if (
    row.envelope_version !== 1 ||
    row.algorithm !== "AES-256-GCM"
  ) {
    throw new GoogleLoginRepositoryError("Google login PKCE envelope is invalid");
  }
  const ciphertext = requireBytes(row.ciphertext);
  if (ciphertext.byteLength < 36 || ciphertext.byteLength > 228) {
    throw new GoogleLoginRepositoryError("Google login PKCE envelope is invalid");
  }
  return Object.freeze({
    envelopeVersion: 1,
    algorithm: "AES-256-GCM",
    nonce: requireBytes(row.nonce, 12),
    ciphertext,
    tag: requireBytes(row.tag, 16),
  });
}

function byteParameters(...values: readonly Uint8Array[]): Buffer[] {
  return values.map((value) => Buffer.from(value));
}

export function createGoogleLoginRepository(
  pool: Pick<DatabasePool, "query">,
): GoogleLoginRepository {
  const implementation: GoogleLoginRepository = {
    async begin(input) {
      const result = await pool.query<BeginRow>(BEGIN_SQL, [
        ...byteParameters(
          input.networkHmac,
          input.stateHash,
          input.nonceHash,
          input.browserBindingHash,
        ),
        input.pkceEnvelope.envelopeVersion,
        input.pkceEnvelope.algorithm,
        Buffer.from(input.pkceEnvelope.nonce),
        Buffer.from(input.pkceEnvelope.ciphertext),
        Buffer.from(input.pkceEnvelope.tag),
        input.requestId,
      ]);
      const row = requireSingleRow(result.rows);
      if (row.outcome === "CREATED") {
        return { outcome: "CREATED", expiresAt: requireDate(row.expires_at) };
      }
      if (
        (row.outcome === "RATE_LIMITED" || row.outcome === "DENIED") &&
        row.expires_at === null
      ) {
        return { outcome: row.outcome };
      }
      throw new GoogleLoginRepositoryError("Google login begin result is invalid");
    },

    async consume(input) {
      const result = await pool.query<ConsumeRow>(CONSUME_SQL, [
        ...byteParameters(
          input.networkHmac,
          input.stateHash,
          input.browserBindingHash,
          input.completionHandleHash,
        ),
        input.requestId,
      ]);
      const row = requireSingleRow(result.rows);
      if (row.outcome === "RESERVED") {
        if (row.configuration_key !== "GOOGLE_WEB_LOGIN_V1") {
          throw new GoogleLoginRepositoryError(
            "Google login configuration result is invalid",
          );
        }
        return {
          outcome: "RESERVED",
          configurationKey: row.configuration_key,
          expectedNonceHash: requireBytes(row.expected_nonce_hash, 32),
          pkceEnvelope: requireEnvelope(row),
          pkceKmsKeyVersion: requireKeyVersion(row.pkce_kms_key_version),
          pkceAssociatedData: requireBytes(row.pkce_associated_data),
          completionExpiresAt: requireDate(row.completion_expires_at),
        };
      }
      if (row.outcome === "RATE_LIMITED" || row.outcome === "DENIED") {
        return { outcome: row.outcome };
      }
      throw new GoogleLoginRepositoryError("Google login consume result is invalid");
    },

    async complete(input) {
      const claims = input.claims;
      const result = await pool.query<CompletionRow>(COMPLETE_SQL, [
        Buffer.from(input.completionHandleHash),
        claims.issuer,
        claims.providerSubject,
        claims.normalizedEmail,
        claims.emailVerified,
        claims.hostedDomain,
        new Date(claims.issuedAtEpochSeconds * 1_000),
        new Date(claims.expiresAtEpochSeconds * 1_000),
        claims.audienceConfigurationKey,
        claims.authorizedPartyConfigurationKey,
        Buffer.from(claims.nonceHash),
        Buffer.from(input.sessionTokenHash),
        Buffer.from(input.csrfTokenHash),
        Buffer.from(input.onboardingTokenHash),
        input.requestId,
      ]);
      const row = requireSingleRow(result.rows);
      if (row.outcome === "NORMAL") {
        return { outcome: "NORMAL" };
      }
      if (row.outcome === "ONBOARDING") {
        if (
          !Array.isArray(row.allowed_operations) ||
          row.allowed_operations.length < 1 ||
          !row.allowed_operations.every(
            (operation) => typeof operation === "string" && operation.length > 0,
          )
        ) {
          throw new GoogleLoginRepositoryError(
            "Google login onboarding result is invalid",
          );
        }
        return {
          outcome: "ONBOARDING",
          allowedOperations: Object.freeze([...row.allowed_operations]),
          expiresAt: requireDate(row.expires_at),
        };
      }
      if (row.outcome === "DENIED") {
        return { outcome: "DENIED" };
      }
      throw new GoogleLoginRepositoryError(
        "Google login completion result is invalid",
      );
    },

    async rejectUnbound(input) {
      const result = await pool.query<RejectionRow>(REJECT_UNBOUND_SQL, [
        Buffer.from(input.networkHmac),
        input.rejectionClass,
        input.requestId,
      ]);
      const outcome = requireSingleRow(result.rows).outcome;
      if (outcome !== "RECORDED" && outcome !== "RATE_LIMITED") {
        throw new GoogleLoginRepositoryError("Google rejection result is invalid");
      }
      return outcome;
    },

    async rejectBound(input) {
      const result = await pool.query<RejectionRow>(REJECT_BOUND_SQL, [
        Buffer.from(input.completionHandleHash),
        input.rejectionClass,
        input.requestId,
      ]);
      const outcome = requireSingleRow(result.rows).outcome;
      if (outcome !== "RECORDED" && outcome !== "RATE_LIMITED") {
        throw new GoogleLoginRepositoryError("Google rejection result is invalid");
      }
      return outcome;
    },
  };
  return Object.freeze(implementation);
}
