import { createMobileAuthRuntime } from "@/server/auth/mobile/runtime";
import { trustedVercelClientIp } from "@/server/auth/google/crypto";
import { createMobileRouteHandlers } from "@/server/auth/mobile/route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = createMobileAuthRuntime();
  return createMobileRouteHandlers({ appReturnUri: context.config.appReturnUri,
    clientIp: trustedVercelClientIp, googleService: context.googleService,
    sessionService: context.sessionService }).switchWorkspace(request);
}
