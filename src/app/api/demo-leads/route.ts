import { createHash, randomUUID } from "node:crypto";

import {
  isHoneypotSubmission,
  validateDemoLeadRequest,
  type DemoLeadFieldErrors,
} from "@/lib/demo-lead-validation";
import { DemoEmailError, sendNewDemoLead } from "@/lib/demo-lead-email";
import {
  verifyGoogleWorkspaceEmail,
  WorkEmailVerificationError,
} from "@/lib/google-workspace-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_STORE_MAX_ENTRIES = 2_048;

type ApiErrorCode =
  | "INVALID_ORIGIN"
  | "INVALID_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "SUBMISSION_FAILED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "VALIDATION_ERROR";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class RequestBodyError extends Error {
  constructor(
    readonly code: Extract<
      ApiErrorCode,
      "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE"
    >,
    readonly status: number,
  ) {
    super(code);
    this.name = "RequestBodyError";
  }
}

// Best-effort only: this bounded in-memory store is isolated per server instance
// and resets whenever the instance restarts. Use a shared limiter for stronger
// guarantees when this endpoint is deployed across multiple instances.
const rateLimitStore = new Map<string, RateLimitEntry>();

function jsonResponse(
  body: unknown,
  status: number,
  correlationId: string,
  additionalHeaders?: HeadersInit,
) {
  const headers = new Headers(additionalHeaders);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Request-Id", correlationId);

  return Response.json(body, { status, headers });
}

function errorResponse(
  code: ApiErrorCode,
  message: string,
  status: number,
  correlationId: string,
  fieldErrors?: DemoLeadFieldErrors,
  additionalHeaders?: HeadersInit,
) {
  return jsonResponse(
    {
      ok: false,
      error: {
        code,
        message,
        requestId: correlationId,
        ...(fieldErrors ? { fieldErrors } : {}),
      },
    },
    status,
    correlationId,
    additionalHeaders,
  );
}

function isSameOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function getClientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    forwardedFor ||
    "unknown";

  return createHash("sha256").update(address.slice(0, 128)).digest("base64url");
}

function checkRateLimit(request: Request) {
  const now = Date.now();

  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt <= now) rateLimitStore.delete(key);
  }

  while (rateLimitStore.size >= RATE_LIMIT_STORE_MAX_ENTRIES) {
    const oldestKey = rateLimitStore.keys().next().value;
    if (typeof oldestKey !== "string") break;
    rateLimitStore.delete(oldestKey);
  }

  const clientKey = getClientKey(request);
  const current = rateLimitStore.get(clientKey);

  if (!current) {
    rateLimitStore.set(clientKey, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return { allowed: true as const, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }

  current.count += 1;
  return {
    allowed: true as const,
    remaining: RATE_LIMIT_MAX_REQUESTS - current.count,
  };
}

async function readJsonBody(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new RequestBodyError("UNSUPPORTED_MEDIA_TYPE", 415);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new RequestBodyError("PAYLOAD_TOO_LARGE", 413);
  }

  if (!request.body) {
    throw new RequestBodyError("INVALID_REQUEST", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    byteLength += value.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyError("PAYLOAD_TOO_LARGE", 413);
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(body) as unknown;
  } catch {
    throw new RequestBodyError("INVALID_REQUEST", 400);
  }
}

function honeypotSuccess(correlationId: string) {
  return jsonResponse({ ok: true, requestId: randomUUID() }, 201, correlationId);
}

function logSafeFailure(event: string, correlationId: string) {
  console.error(JSON.stringify({ event, requestId: correlationId }));
}

export async function POST(request: Request) {
  const correlationId = randomUUID();

  if (!isSameOrigin(request)) {
    return errorResponse(
      "INVALID_ORIGIN",
      "Không thể xử lý yêu cầu này.",
      403,
      correlationId,
    );
  }

  const rateLimit = checkRateLimit(request);
  if (!rateLimit.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.",
      429,
      correlationId,
      undefined,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  try {
    const body = await readJsonBody(request);

    if (isHoneypotSubmission(body)) {
      return honeypotSuccess(correlationId);
    }

    const validation = validateDemoLeadRequest(body);
    if (!validation.ok) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Vui lòng kiểm tra lại các trường bắt buộc.",
        422,
        correlationId,
        validation.fieldErrors,
      );
    }

    const workspace = await verifyGoogleWorkspaceEmail(
      validation.data.lead.workEmail,
    );
    const requestId = randomUUID();
    await sendNewDemoLead(validation.data.lead, requestId, workspace.domain);

    return jsonResponse({ ok: true, requestId }, 201, correlationId);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      const messages: Record<RequestBodyError["code"], string> = {
        INVALID_REQUEST: "Dữ liệu gửi lên không hợp lệ.",
        PAYLOAD_TOO_LARGE: "Dữ liệu gửi lên vượt quá giới hạn cho phép.",
        UNSUPPORTED_MEDIA_TYPE: "Định dạng dữ liệu không được hỗ trợ.",
      };

      return errorResponse(
        error.code,
        messages[error.code],
        error.status,
        correlationId,
      );
    }

    if (error instanceof DemoEmailError) {
      logSafeFailure(
        error.kind === "configuration"
          ? "demo_email_not_configured"
          : "demo_email_delivery_failed",
        correlationId,
      );
      return errorResponse(
        "SUBMISSION_FAILED",
        "Rất tiếc! Đã xảy ra lỗi khi gửi biểu mẫu.",
        503,
        correlationId,
      );
    }

    if (error instanceof WorkEmailVerificationError) {
      if (error.kind === "unavailable") {
        logSafeFailure("workspace_email_verification_unavailable", correlationId);
        return errorResponse(
          "SUBMISSION_FAILED",
          "Chưa thể kiểm tra email công việc lúc này. Vui lòng thử lại.",
          503,
          correlationId,
        );
      }

      return errorResponse(
        "VALIDATION_ERROR",
        "Vui lòng sử dụng email Google Workspace của doanh nghiệp.",
        422,
        correlationId,
        {
          workEmail:
            "Email này không thuộc một Google Workspace doanh nghiệp hợp lệ.",
        },
      );
    }

    logSafeFailure("demo_submission_failed", correlationId);
    return errorResponse(
      "SUBMISSION_FAILED",
      "Rất tiếc! Đã xảy ra lỗi khi gửi biểu mẫu.",
      500,
      correlationId,
    );
  }
}
