import { requestIdFromHeaders } from "@/server/http/problem";
import { mobileJson, mobileSessionProblem } from "@/server/auth/mobile/http";
import { createMobileAuthRuntime } from "@/server/auth/mobile/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = requestIdFromHeaders(request.headers);
  try {
    const context = await createMobileAuthRuntime().sessionService.authenticateBearer(
      request.headers.get("authorization"),
    );
    return mobileJson({ authenticated: true, user_id: context.userId,
      workspace_id: context.workspaceId, membership_id: context.membershipId,
      role: context.role }, id);
  } catch (error) {
    return mobileSessionProblem(error, id);
  }
}
