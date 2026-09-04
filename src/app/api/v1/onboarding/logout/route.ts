import { loadGoogleLoginRuntimeConfig } from "@/server/auth/google/config";
import { requestIdFromHeaders } from "@/server/http/problem";
import {
  createOnboardingLogoutPost,
  type BootstrapStatusDependencies,
} from "@/server/onboarding/google-workspace/http";
import { createConfiguredGoogleWorkspaceBootstrapRuntime } from "@/server/onboarding/google-workspace/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dependencies: BootstrapStatusDependencies = Object.freeze({
  requestId: requestIdFromHeaders,
  loadRuntime() {
    const config = loadGoogleLoginRuntimeConfig();
    return Object.freeze({
      appOrigin: config.appOrigin,
      sessionPepper: config.sessionPepper,
      repository: createConfiguredGoogleWorkspaceBootstrapRuntime().repository,
    });
  },
});

export const POST = createOnboardingLogoutPost(dependencies);
