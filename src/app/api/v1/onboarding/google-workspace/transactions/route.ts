import { loadGoogleLoginRuntimeConfig } from "@/server/auth/google/config";
import { clientNetworkHmac, trustedVercelClientIp } from "@/server/auth/google/crypto";
import { requestIdFromHeaders } from "@/server/http/problem";
import {
  createGoogleWorkspaceBootstrapPost,
  type BootstrapHttpDependencies,
} from "@/server/onboarding/google-workspace/http";
import { createConfiguredGoogleWorkspaceBootstrapRuntime } from "@/server/onboarding/google-workspace/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const dependencies: BootstrapHttpDependencies = Object.freeze({
  requestId: requestIdFromHeaders,
  networkHmac(headers: Headers) {
    const config = loadGoogleLoginRuntimeConfig();
    return clientNetworkHmac(trustedVercelClientIp(headers), config.rateHmacKey);
  },
  loadRuntime() {
    const config = loadGoogleLoginRuntimeConfig();
    return Object.freeze({
      appOrigin: config.appOrigin,
      sessionPepper: config.sessionPepper,
      ...createConfiguredGoogleWorkspaceBootstrapRuntime(),
    });
  },
});

export const POST = createGoogleWorkspaceBootstrapPost(dependencies);
