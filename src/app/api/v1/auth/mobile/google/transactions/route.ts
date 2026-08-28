import { trustedVercelClientIp } from "@/server/auth/google/crypto";
import { createMobileAuthRuntime } from "@/server/auth/mobile/runtime";
import { createMobileGoogleTransactionPost } from "@/server/auth/mobile/route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createMobileGoogleTransactionPost({
  createRuntime: createMobileAuthRuntime,
  clientIp: trustedVercelClientIp,
});
