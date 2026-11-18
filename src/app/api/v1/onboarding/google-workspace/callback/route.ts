import { loadGoogleLoginRuntimeConfig } from "@/server/auth/google/config";
import { ONBOARDING_COOKIE_NAME } from "@/server/auth/google/crypto";
import { requestIdFromHeaders } from "@/server/http/problem";
import { GOOGLE_WORKSPACE_SETUP_COOKIE_NAME } from "@/server/onboarding/google-workspace/crypto";
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

const DIRECT_SIGNUP_COOKIE_NAME = "__Host-uptech_workspace_direct_tx";
const bootstrapCallbackGet = createGoogleWorkspaceBootstrapCallbackGet(dependencies);

function hasNamedCookie(headers: Headers, name: string): boolean {
  const cookie = headers.get("cookie");
  return cookie !== null && cookie.split(";").some((part) => part.trim().startsWith(`${name}=`));
}

export async function GET(request: Request): Promise<Response> {
  if (
    hasNamedCookie(request.headers, DIRECT_SIGNUP_COOKIE_NAME) &&
    !hasNamedCookie(request.headers, ONBOARDING_COOKIE_NAME) &&
    !hasNamedCookie(request.headers, GOOGLE_WORKSPACE_SETUP_COOKIE_NAME)
  ) {
    const { handleDirectOrgSignupCallbackGet } = await import(
      "@/server/onboarding/google-workspace/direct-signup"
    );
    return handleDirectOrgSignupCallbackGet(request);
  }
  return bootstrapCallbackGet(request);
}
