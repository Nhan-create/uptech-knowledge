import { createMobileAuthRuntime } from "@/server/auth/mobile/runtime";
import { trustedVercelClientIp } from "@/server/auth/google/crypto";
import { createMobileHandoffExchangePost } from "@/server/auth/mobile/route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createMobileHandoffExchangePost({
  createRuntime: createMobileAuthRuntime,
  clientIp: trustedVercelClientIp,
});
