import type { QueryResultRow } from "pg";
import type { DatabasePool } from "../../db/core.ts";
import type { WebPkceEnvelope } from "../google/crypto.ts";
import type {
  MobileAuthUiCategory,
  MobileGoogleRepository,
} from "./google-service.ts";

function one(rows: QueryResultRow[]) { if (rows.length !== 1) throw new Error("Invalid mobile Google result"); return rows[0]; }
function bytes(value: unknown, length?: number) {
  if (!(value instanceof Uint8Array) || (length !== undefined && value.byteLength !== length)) throw new Error("Invalid mobile Google bytes");
  return Uint8Array.from(value);
}
function envelope(row: QueryResultRow): WebPkceEnvelope {
  if (row.envelope_version !== 1 || row.algorithm !== "AES-256-GCM") throw new Error("Invalid mobile Google envelope");
  return { envelopeVersion: 1, algorithm: "AES-256-GCM", nonce: bytes(row.nonce, 12),
    ciphertext: bytes(row.ciphertext), tag: bytes(row.tag, 16) };
}
const SAFE_CATEGORIES = new Set<MobileAuthUiCategory>([
  "PERSONAL_GOOGLE_ACCOUNT", "UNKNOWN_WORKSPACE", "USER_NOT_PROVISIONED",
  "USER_SUSPENDED", "WORKSPACE_SUSPENDED", "POLICY_OR_DEVICE_BLOCKED",
  "GOOGLE_CANCELLED", "PROVIDER_UNAVAILABLE", "AUTH_ERROR",
]);
function safeCategory(value: unknown): MobileAuthUiCategory {
  if (typeof value !== "string" || !SAFE_CATEGORIES.has(value as MobileAuthUiCategory)) {
    throw new Error("Invalid mobile callback category");
  }
  return value as MobileAuthUiCategory;
}

function callbackCompletion(row: QueryResultRow):
  | { readonly outcome: "NORMAL"; readonly appReturnUri: string }
  | { readonly outcome: "DENIAL_HANDOFF"; readonly appReturnUri: string;
      readonly category: MobileAuthUiCategory }
  | { readonly outcome: "DENIED" } {
  if (row.outcome === "NORMAL" && typeof row.app_return_uri === "string") {
    return { outcome: "NORMAL", appReturnUri: row.app_return_uri };
  }
  if (row.outcome === "DENIED" && row.app_return_uri === null) {
    return { outcome: "DENIED" };
  }
  if (row.outcome === "DENIED" && typeof row.app_return_uri === "string") {
    return {
      outcome: "DENIAL_HANDOFF",
      appReturnUri: row.app_return_uri,
      category: safeCategory(row.denial_category),
    };
  }
  throw new Error("Invalid mobile completion outcome");
}

export function createMobileGoogleRepository(pool: Pick<DatabasePool, "query">): MobileGoogleRepository {
  const implementation: MobileGoogleRepository = {
    async begin(input) {
      const e = input.envelope;
      const row = one((await pool.query(`SELECT result.outcome::text outcome FROM uptech.begin_google_login_transaction_v1(
        $1::uptech.mobile_platform_v1,$2::uptech.google_auth_hash32_v1,$3::uptech.google_auth_hash32_v1,
        $4::uptech.google_auth_hash32_v1,$5::uptech.google_auth_hash32_v1,$6::uptech.google_auth_hash32_v1,
        ROW($7::smallint,$8::uptech.google_auth_pkce_algorithm_v1,$9::uptech.google_auth_nonce12_v1,
          $10::uptech.google_auth_pkce_ciphertext_v1,$11::uptech.google_auth_tag16_v1)::uptech.google_web_pkce_envelope_v1,$12::uuid) result`, [
        input.platform,Buffer.from(input.networkHmac),Buffer.from(input.stateHash),Buffer.from(input.nonceHash),
        Buffer.from(input.installationBinding),Buffer.from(input.appExchangeChallenge),e.envelopeVersion,e.algorithm,
        Buffer.from(e.nonce),Buffer.from(e.ciphertext),Buffer.from(e.tag),input.requestId])).rows as QueryResultRow[]);
      if (!["CREATED","RATE_LIMITED","DENIED"].includes(row.outcome)) throw new Error("Invalid mobile begin outcome");
      return { outcome: row.outcome as "CREATED"|"RATE_LIMITED"|"DENIED" };
    },
    async consume(input) {
      const row = one((await pool.query(`SELECT result.outcome::text outcome,result.platform::text platform,
        result.configuration_key::text configuration_key,
        result.expected_nonce_hash,(result.pkce_envelope).envelope_version,(result.pkce_envelope).algorithm::text algorithm,
        (result.pkce_envelope).nonce,(result.pkce_envelope).ciphertext,(result.pkce_envelope).tag,
        result.pkce_kms_key_version::text pkce_key_version,result.pkce_associated_data
        FROM uptech.consume_google_login_transaction_v1($1::uptech.google_auth_hash32_v1,
          $2::uptech.google_auth_hash32_v1,$3::uptech.google_auth_hash32_v1,$4::uuid) result`,[
        Buffer.from(input.networkHmac),Buffer.from(input.stateHash),Buffer.from(input.completionHandleHash),input.requestId])).rows as QueryResultRow[]);
      if (row.outcome === "DENIED" || row.outcome === "RATE_LIMITED") return { outcome: row.outcome };
      if (row.outcome !== "RESERVED" || (row.platform !== "ANDROID" && row.platform !== "IOS") ||
        (row.configuration_key !== "GOOGLE_MOBILE_ANDROID_V1" && row.configuration_key !== "GOOGLE_MOBILE_IOS_V1") ||
        typeof row.pkce_key_version !== "string") throw new Error("Invalid mobile consume outcome");
      return { outcome:"RESERVED",platform:row.platform,configurationKey:row.configuration_key,
        expectedNonceHash:bytes(row.expected_nonce_hash,32),
        envelope:envelope(row),pkceKeyVersion:row.pkce_key_version,associatedData:bytes(row.pkce_associated_data) };
    },
    async complete(input) {
      const c=input.claims;
      const row=one((await pool.query(`SELECT result.outcome::text outcome,result.app_return_uri::text app_return_uri,
        result.denial_category::text denial_category
        FROM uptech.complete_mobile_google_callback_directory_v2($1::uptech.google_auth_hash32_v1,
        ROW($2::uptech.google_auth_issuer_v1,$3::uptech.google_provider_subject_v1,$4::uptech.google_normalized_email_v1,
          $5::boolean,$6::uptech.google_normalized_domain_v1,$7::timestamptz,$8::timestamptz,
          $9::uptech.google_auth_configuration_key_v1,$10::uptech.google_auth_configuration_key_v1,
          $11::uptech.google_auth_hash32_v1)::uptech.google_verified_claims_assertion_v1,
        $12::uptech.google_auth_hash32_v1,$13::uuid) result`,[
        Buffer.from(input.completionHandleHash),c.issuer,c.providerSubject,c.normalizedEmail,c.emailVerified,c.hostedDomain,
        new Date(c.issuedAtEpochSeconds*1000),new Date(c.expiresAtEpochSeconds*1000),c.audienceConfigurationKey,
        c.authorizedPartyConfigurationKey,Buffer.from(c.nonceHash),Buffer.from(input.handoffHash),input.requestId])).rows as QueryResultRow[]);
      return callbackCompletion(row);
    },
    async completeDenial(input) {
      const row = one((await pool.query(`SELECT result.outcome::text outcome,
        result.app_return_uri::text app_return_uri,
        result.denial_category::text denial_category
        FROM uptech.complete_mobile_google_denial_v1(
          $1::uptech.google_auth_hash32_v1,$2::uptech.google_auth_hash32_v1,
          $3::uptech.google_auth_rejection_class_v1,
          $4::uptech.mobile_auth_ui_category_v1,$5::uuid) result`, [
        Buffer.from(input.completionHandleHash), Buffer.from(input.handoffHash),
        input.rejectionClass, input.category, input.requestId,
      ])).rows as QueryResultRow[]);
      const completion = callbackCompletion(row);
      if (completion.outcome === "NORMAL") {
        throw new Error("Invalid mobile denial completion outcome");
      }
      return completion;
    },
    async reject(input) {
      const row=one((await pool.query(`SELECT uptech.record_google_login_rejection_v1($1::uptech.mobile_platform_v1,
        $2::uptech.google_auth_hash32_v1,$3::uptech.google_auth_hash32_v1,
        $4::uptech.google_auth_rejection_class_v1,$5::uuid)::text outcome`,[
        input.platform,Buffer.from(input.networkHmac),input.completionHandleHash === null
          ? null : Buffer.from(input.completionHandleHash),input.rejectionClass,input.requestId])).rows as QueryResultRow[]);
      if(row.outcome!=="RECORDED"&&row.outcome!=="RATE_LIMITED") throw new Error("Invalid mobile rejection outcome");
      return row.outcome;
    },
  };
  return Object.freeze(implementation);
}
