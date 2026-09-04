import { loadGoogleLoginRuntimeConfig } from "@/server/auth/google/config";
import { requestIdFromHeaders } from "@/server/http/problem";
import {
  createGoogleWorkspaceBootstrapCallbackGet,
  type BootstrapHttpDependencies,
} from "@/server/onboarding/google-workspace/http";
import { createConfiguredGoogleWorkspaceBootstrapRuntime } from "@/server/onboarding/google-workspace/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const dependencies: BootstrapHttpDependencies = Object.freeze({
  requestId: requestIdFromHeaders,
  networkHmac() { throw new Error("callback has no rate-limit input"); },
  loadRuntime() {
    const config = loadGoogleLoginRuntimeConfig();
    return Object.freeze({
      appOrigin: config.appOrigin,
      sessionPepper: config.sessionPepper,
      ...createConfiguredGoogleWorkspaceBootstrapRuntime(),
    });
  },
});

export const GET = createGoogleWorkspaceBootstrapCallbackGet(dependencies);
