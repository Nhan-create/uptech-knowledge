import { loadGoogleLoginRuntimeConfig } from "@/server/auth/google/config";
import { trustedVercelClientIp } from "@/server/auth/google/crypto";
import { createGoogleLoginRuntime } from "@/server/auth/google/runtime";
import { requestIdFromHeaders } from "@/server/http/problem";
import {
  createBootstrapFinishPost,
  type BootstrapStatusDependencies,
} from "@/server/onboarding/google-workspace/http";
import { createConfiguredGoogleWorkspaceBootstrapRuntime } from "@/server/onboarding/google-workspace/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dependencies: BootstrapStatusDependencies = Object.freeze({
  requestId: requestIdFromHeaders,
  canonicalClientIp: trustedVercelClientIp,
  loadRuntime() {
    const config = loadGoogleLoginRuntimeConfig();
    return Object.freeze({
      appOrigin: config.appOrigin,
      sessionPepper: config.sessionPepper,
      repository: createConfiguredGoogleWorkspaceBootstrapRuntime().repository,
      normalLoginService: createGoogleLoginRuntime().service,
    });
  },
});

export const POST = createBootstrapFinishPost(dependencies);
