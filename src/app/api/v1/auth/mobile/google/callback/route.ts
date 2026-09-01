import { trustedVercelClientIp } from "@/server/auth/google/crypto";
import { MOBILE_APP_RETURN_URI } from "@/server/auth/mobile/config";
import { createMobileAuthRuntime } from "@/server/auth/mobile/runtime";
import { createMobileGoogleCallbackGet } from "@/server/auth/mobile/route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createMobileGoogleCallbackGet({
  appReturnUri: MOBILE_APP_RETURN_URI,
  createRuntime: createMobileAuthRuntime,
  clientIp: trustedVercelClientIp,
});
