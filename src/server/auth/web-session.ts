import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  authenticateSession,
  type AuthenticatedSessionContext,
  type DatabasePool,
  type NormalSessionContext,
  requestTransactionContextFromSession,
  withRequestTransaction,
} from "../db/core.ts";
import {
  classifyRequestCredential,
  verifyWebCsrf,
} from "../http/request-security.ts";
import {
  hashCredential,
  WEB_SESSION_COOKIE_NAME,
} from "../sessions/session-security.ts";
import { deriveCsrfCredential } from "./google/crypto.ts";

export class WebSessionAuthenticationError extends Error {
  override readonly name: string = "WebSessionAuthenticationError";
}

export class WebSessionCsrfError extends WebSessionAuthenticationError {
  override readonly name = "WebSessionCsrfError";
}

export class WebSessionIntegrityError extends Error {
  override readonly name = "WebSessionIntegrityError";
}

export interface AuthenticatedWebSession {
  readonly rawCredential: string;
  readonly credentialHash: Uint8Array;
  readonly csrfCredential: string;
  readonly context: NormalSessionContext & { readonly csrfTokenHash: string };
}

function credentialDigest(rawCredential: string): Uint8Array {
  try {
    return Buffer.from(hashCredential(rawCredential), "hex");
  } catch {
    throw new WebSessionAuthenticationError("Web session is invalid");
  }
}

function requireNormalWebContext(
  context: AuthenticatedSessionContext | null,
): NormalSessionContext & { readonly csrfTokenHash: string } {
  if (
    context === null ||
    context.kind !== "session" ||
    context.clientType !== "WEB" ||
    context.tokenKind !== "WEB_SESSION" ||
    context.csrfTokenHash === null
  ) {
    throw new WebSessionAuthenticationError("Web session is invalid");
  }
  return context as NormalSessionContext & { readonly csrfTokenHash: string };
}

export async function authenticateWebSession(
  headers: Headers,
  sessionPepper: Uint8Array,
  pool: Pick<DatabasePool, "query">,
): Promise<AuthenticatedWebSession> {
  const credential = classifyRequestCredential(headers);
  if (!credential.ok || credential.kind !== "cookie") {
    throw new WebSessionAuthenticationError("Web session is invalid");
  }
  const digest = credentialDigest(credential.credential);
  const context = requireNormalWebContext(
    await authenticateSession(digest, pool),
  );
  const csrfCredential = deriveCsrfCredential(
    credential.credential,
    sessionPepper,
  );
  const actualCsrfHash = Buffer.from(hashCredential(csrfCredential), "hex");
  const expectedCsrfHash = Buffer.from(context.csrfTokenHash, "hex");
  if (
    expectedCsrfHash.byteLength !== actualCsrfHash.byteLength ||
    !timingSafeEqual(actualCsrfHash, expectedCsrfHash)
  ) {
    throw new WebSessionIntegrityError("Web session binding is invalid");
  }

  return Object.freeze({
    rawCredential: credential.credential,
    credentialHash: digest,
    csrfCredential,
    context,
  });
}

export function requireWebCsrf(input: {
  readonly request: Request;
  readonly appOrigin: string;
  readonly session: AuthenticatedWebSession;
}): void {
  const decision = verifyWebCsrf({
    method: input.request.method,
    credential_kind: "cookie",
    headers: input.request.headers,
    allowed_origin: input.appOrigin,
    expected_csrf_hash: input.session.context.csrfTokenHash ?? "",
  });
  if (!decision.allowed) {
    throw new WebSessionCsrfError("CSRF validation failed");
  }
}

export async function revokeCurrentWebSession(
  session: AuthenticatedWebSession,
  requestId: string,
  pool: Pick<DatabasePool, "connect">,
): Promise<void> {
  if (!/^[0-9a-f-]{36}$/iu.test(requestId)) {
    throw new TypeError("requestId is invalid");
  }
  const context = requestTransactionContextFromSession(
    session.context,
    session.credentialHash,
  );
  await withRequestTransaction(
    context,
    async (client) => {
      await client.query(
        `INSERT INTO uptech.audit_events
           (workspace_id, id, actor_kind, actor_id, membership_id, session_id,
            action, target_type, target_id, outcome, request_id, metadata)
         VALUES
           ($1::uuid, $2::uuid, 'USER', $3::uuid, $4::uuid, $5::uuid,
            'AUTH_LOGOUT', 'SESSION', $5::uuid, 'SUCCEEDED', $6::uuid,
            '{}'::jsonb),
           ($1::uuid, $7::uuid, 'USER', $3::uuid, $4::uuid, $5::uuid,
            'SESSION_REVOKED', 'SESSION', $5::uuid, 'SUCCEEDED', $6::uuid,
            '{}'::jsonb)`,
        [
          session.context.workspaceId,
          randomUUID(),
          session.context.actorId,
          session.context.membershipId,
          session.context.sessionId,
          requestId,
          randomUUID(),
        ],
      );
      await client.query(
        `UPDATE uptech.session_tokens
            SET token_status = 'REVOKED', revoked_at = transaction_timestamp(),
                became_previous_at = NULL, previous_valid_until = NULL
          WHERE workspace_id = $1::uuid
            AND session_id = $2::uuid
            AND token_status IN ('CURRENT', 'PREVIOUS')`,
        [session.context.workspaceId, session.context.sessionId],
      );
      const revoked = await client.query(
        `UPDATE uptech.sessions
            SET status = 'REVOKED', revoked_at = transaction_timestamp(),
                revocation_reason = 'USER_LOGOUT', security_version = security_version + 1
          WHERE workspace_id = $1::uuid
            AND id = $2::uuid
            AND status = 'ACTIVE'
            AND revoked_at IS NULL`,
        [session.context.workspaceId, session.context.sessionId],
      );
      if (revoked.rowCount !== 1) {
        throw new WebSessionAuthenticationError("Web session is no longer active");
      }
    },
    pool,
  );
}

export function clearedWebSessionCookie(): string {
  return `${WEB_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
