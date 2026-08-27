import { requestIdFromHeaders } from "@/server/http/problem";
import { boundedJson, mobileJson, mobileProblem } from "@/server/auth/mobile/http";
import { parseRefreshBody } from "@/server/auth/mobile/protocol";
import { createMobileAuthRuntime } from "@/server/auth/mobile/runtime";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const id = requestIdFromHeaders(request.headers);
  try {
    const body = parseRefreshBody(await boundedJson(request));
    const installationSecret = request.headers.get("x-installation-secret") ?? "";
    const result = await createMobileAuthRuntime().sessionService.refresh({
      ...body, installationSecret, idempotencyKey: request.headers.get("idempotency-key") ?? "", requestId: id,
    });
    if (result.outcome === "SESSION_EXPIRED") return mobileProblem("SESSION_EXPIRED", id);
    if (result.outcome === "FAMILY_REVOKED" || result.outcome === "SESSION_REVOKED" || result.outcome === "DENIED") {
      return mobileProblem("SESSION_REVOKED", id);
    }
    if (result.outcome !== "ROTATED" && result.outcome !== "REPLAY") return mobileProblem("UNAUTHENTICATED", id);
    return mobileJson({ access_token: result.accessToken, refresh_token: result.refreshToken,
      access_expires_at: result.accessExpiresAt.toISOString(), refresh_expires_at: result.refreshExpiresAt.toISOString() }, id);
  } catch (error) {
    return mobileProblem(error instanceof SyntaxError || error instanceof TypeError ||
      (error instanceof Error && ["MobileProtocolError","MobileSessionServiceError"].includes(error.name))
      ? "VALIDATION_FAILED" : "PROVIDER_UNAVAILABLE", id);
  }
}
