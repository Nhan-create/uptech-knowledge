import { requestIdFromHeaders } from "@/server/http/problem";
import { mobileJson, mobileProblem, mobileSessionProblem } from "@/server/auth/mobile/http";
import { createMobileAuthRuntime } from "@/server/auth/mobile/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const id = requestIdFromHeaders(request.headers);
  try {
    const result = await createMobileAuthRuntime().sessionService.revoke(
      request.headers.get("authorization"), id,
    );
    return result === "REVOKED"
      ? mobileJson({ revoked: true }, id)
      : mobileProblem("UNAUTHENTICATED", id);
  } catch (error) {
    return mobileSessionProblem(error, id);
  }
}
