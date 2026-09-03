import { authenticateWebSession, requireWebCsrf } from "@/server/auth/web-session";
import { requestIdFromHeaders } from "@/server/http/problem";
import {
  createDirectoryConsentCallbackGet,
  type DirectoryConsentHandlerDependencies,
} from "@/server/people-data/directory-consent-handler";
import { createConfiguredGoogleDirectoryConsentRuntime } from "@/server/people-data/directory-consent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const dependencies: DirectoryConsentHandlerDependencies = Object.freeze({
  loadRuntime: createConfiguredGoogleDirectoryConsentRuntime,
  authenticate: authenticateWebSession,
  requireCsrf: requireWebCsrf,
  requestId: requestIdFromHeaders,
  log(event: Parameters<DirectoryConsentHandlerDependencies["log"]>[0]) {
    console.info(JSON.stringify(event));
  },
});

export const GET = createDirectoryConsentCallbackGet(dependencies);
