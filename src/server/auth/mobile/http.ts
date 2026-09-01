import {
  createSafeProblem,
  problemResponse,
  type ProblemCode,
} from "../../http/problem.ts";
import type { MobileAuthUiCategory } from "./google-service.ts";
import { MobileSessionServiceError } from "./session-service.ts";

export async function boundedJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type")?.split(";", 1)[0].trim();
  const length = Number(request.headers.get("content-length") ?? "0");
  if (type !== "application/json" || !Number.isFinite(length) || length > 4_096) {
    throw new TypeError("Invalid request body");
  }
  const text = await request.text();
  if (text.length < 2 || Buffer.byteLength(text, "utf8") > 4_096) {
    throw new TypeError("Invalid request body");
  }
  return JSON.parse(text) as unknown;
}

export function mobileJson(value: unknown, requestId: string, status = 200) {
  return Response.json(value, { status, headers: {
    "Cache-Control": "no-store, max-age=0", Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId,
  } });
}

export function mobileProblem(code: ProblemCode, requestId: string) {
  return problemResponse(createSafeProblem(code, requestId));
}

export function mobileAuthProblem(
  category: MobileAuthUiCategory,
  requestId: string,
): Response {
  const code: ProblemCode = category === "OFFLINE"
    ? "PROVIDER_UNAVAILABLE"
    : category;
  return mobileProblem(code, requestId);
}

export function mobileAuthenticatedDenialProblem(
  category: MobileAuthUiCategory,
  requestId: string,
): Response {
  const response = mobileAuthProblem(category, requestId);
  response.headers.set("X-Uptech-Mobile-Handoff-Outcome", "ACCESS_DENIED");
  return response;
}

export function mobileSessionProblem(error: unknown, requestId: string): Response {
  return mobileProblem(
    error instanceof MobileSessionServiceError ? error.code : "PROVIDER_UNAVAILABLE",
    requestId,
  );
}

export function mobileCallbackRedirect(
  appReturnUri: string,
  requestId: string,
  result:
    | { readonly outcome: "HANDOFF"; readonly handoffCode: string }
    | { readonly outcome: "DENIED" },
): Response {
  const location = new URL(appReturnUri);
  if (result.outcome === "HANDOFF") {
    location.searchParams.set("handoff", result.handoffCode);
  }
  location.searchParams.set("request_id", requestId);
  return new Response(null, { status: 303, headers: {
    "Cache-Control": "no-store, max-age=0",
    Location: location.href,
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  } });
}
