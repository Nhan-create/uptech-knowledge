import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  WebSessionAuthenticationError,
  WebSessionIntegrityError,
} from "../src/server/auth/web-session.ts";

const requestId = "00000000-0000-4000-8000-000000000092";
const appOrigin = "https://tenant-a.example";

let initiateResult: unknown = { outcome: "DENIED" };
let callbackResult: unknown = { outcome: "DENIED" };
let runtimeCreationError: Error | null = null;
let webSessionResult: unknown = new WebSessionAuthenticationError("stale");
let bootstrapInitiateResult: unknown;
let bootstrapCallbackResult: unknown;
const bootstrapAdmissionResult: unknown = { outcome: "ADMITTED" };
const bootstrapAdmissionInputs: unknown[] = [];
let bootstrapStatusResult: unknown = { outcome: "DIRECTORY_BOOTSTRAP_SYNC_PENDING" };
let bootstrapRetryResult: unknown = { outcome: "REQUEUED" };
let bootstrapFinishResult: unknown = { outcome: "FINISHED" };
let bootstrapRevokeResult: unknown = { outcome: "REVOKED" };
let accessSubmitResult: unknown = { outcome: "PENDING", requestId: "00000000-0000-4000-8000-000000000093", status: "PENDING" };
let accessReadResult: unknown = { outcome: "FOUND", requestId: "00000000-0000-4000-8000-000000000093", status: "PENDING" };
const bootstrapRecoveryInputs: Array<{ readonly operation: string; readonly input: unknown }> = [];
const bootstrapPepper = new Uint8Array(32).fill(7);

mock.module("@/server/auth/web-session", {
  namedExports: {
    WebSessionAuthenticationError,
    async authenticateWebSession() {
      if (webSessionResult instanceof Error) throw webSessionResult;
      return webSessionResult;
    },
  },
});

mock.module("@/server/auth/google/config", {
  namedExports: {
    loadGoogleLoginRuntimeConfig() {
      return {
        appOrigin,
        sessionPepper: bootstrapPepper,
        rateHmacKey: new Uint8Array(32).fill(11),
      };
    },
    loadWebSessionRuntimeConfig() {
      return {
        databaseUrl: "postgresql://runtime@unknown.example/test",
        sessionPepper: new Uint8Array(32),
      };
    },
  },
});

mock.module("@/server/onboarding/google-workspace/runtime", {
  namedExports: {
    createConfiguredGoogleWorkspaceBootstrapRuntime() {
      return {
        async admitStart(input: unknown) {
          bootstrapAdmissionInputs.push(input);
          if (bootstrapAdmissionResult instanceof Error) throw bootstrapAdmissionResult;
          return bootstrapAdmissionResult;
        },
        service: {
          async initiate() {
            if (bootstrapInitiateResult instanceof Error) throw bootstrapInitiateResult;
            return bootstrapInitiateResult;
          },
          async callback() {
            if (bootstrapCallbackResult instanceof Error) throw bootstrapCallbackResult;
            return bootstrapCallbackResult;
          },
        },
        repository: {
          async readStatus(input: unknown) {
            bootstrapRecoveryInputs.push({ operation: "readStatus", input });
            return bootstrapStatusResult;
          },
          async retrySync(input: unknown) {
            bootstrapRecoveryInputs.push({ operation: "retrySync", input });
            return bootstrapRetryResult;
          },
          async finish(input: unknown) {
            bootstrapRecoveryInputs.push({ operation: "finish", input });
            return bootstrapFinishResult;
          },
          async revokeCapability(input: unknown) {
            bootstrapRecoveryInputs.push({ operation: "revokeCapability", input });
            return bootstrapRevokeResult;
          },
          async submitAccessRequest(input: unknown) {
            bootstrapRecoveryInputs.push({ operation: "submitAccessRequest", input });
            return accessSubmitResult;
          },
          async readAccessRequest(input: unknown) {
            bootstrapRecoveryInputs.push({ operation: "readAccessRequest", input });
            return accessReadResult;
          },
        },
      };
    },
  },
});

mock.module("@/server/db/runtime-pool", {
  namedExports: {
    getRuntimeDatabasePool() {
      return { query: async () => ({ rows: [], rowCount: 0 }) };
    },
  },
});

mock.module("@/server/auth/google/runtime", {
  namedExports: {
    createGoogleLoginRuntime() {
      if (runtimeCreationError !== null) throw runtimeCreationError;
      return {
        config: { appOrigin, databaseUrl: "postgresql://runtime@unknown.example/test" },
        service: {
          async initiate() {
            if (initiateResult instanceof Error) throw initiateResult;
            return initiateResult;
          },
          async callback(input: {
            readonly inspectPreexistingBrowserAuthority?: () => Promise<boolean>;
          }) {
            await input.inspectPreexistingBrowserAuthority?.();
            if (callbackResult instanceof Error) throw callbackResult;
            return callbackResult;
          },
        },
      };
    },
  },
});

const transactionRoute = await import("../src/app/api/v1/auth/google/transactions/route.ts");
const callbackRoute = await import("../src/app/api/v1/auth/google/callback/route.ts");
const sessionRoute = await import("../src/app/api/v1/auth/session/route.ts");
const bootstrapTransactionRoute = await import("../src/app/api/v1/onboarding/google-workspace/transactions/route.ts");
const bootstrapCallbackRoute = await import("../src/app/api/v1/onboarding/google-workspace/callback/route.ts");
const bootstrapStatusRoute = await import("../src/app/api/v1/onboarding/google-workspace/status/route.ts");
const bootstrapRetryRoute = await import("../src/app/api/v1/onboarding/google-workspace/sync-retry/route.ts");
const bootstrapFinishRoute = await import("../src/app/api/v1/onboarding/google-workspace/finish/route.ts");
const onboardingLogoutRoute = await import("../src/app/api/v1/onboarding/logout/route.ts");
const accessRequestRoute = await import("../src/app/api/v1/onboarding/access-requests/route.ts");
const currentAccessRequestRoute = await import("../src/app/api/v1/onboarding/access-requests/current/route.ts");
const { issueSessionCredential } = await import("../src/server/sessions/session-security.ts");
const { deriveCsrfCredential, issueOpaqueProof } = await import("../src/server/auth/google/crypto.ts");

const trustedHeaders = {
  "x-uptech-request-id": requestId,
  "x-vercel-id": "test-edge",
  "x-vercel-forwarded-for": "203.0.113.10",
};

function loginLocation(response: Response, error: string): URL {
  assert.equal(response.status, 303);
  const locationHeader = response.headers.get("location");
  if (locationHeader === null) {
    assert.fail("login redirects must include a location header");
  }
  const location = new URL(locationHeader);
  assert.equal(location.origin, appOrigin);
  assert.equal(location.pathname, "/login");
  assert.deepEqual([...location.searchParams.keys()].sort(), ["error", "request_id"]);
  assert.equal(location.searchParams.get("error"), error);
  assert.equal(location.searchParams.get("request_id"), requestId);
  return location;
}

function hasSessionCookie(response: Response): boolean {
  return response.headers.getSetCookie().some((cookie) =>
    cookie.startsWith("__Host-uptech_session="),
  );
}

function hasOnboardingCookie(response: Response): boolean {
  return response.headers.getSetCookie().some((cookie) =>
    cookie.startsWith("__Host-uptech_onboarding="),
  );
}

function nonEmptyAuthorityCookieNames(response: Response): string[] {
  return response.headers.getSetCookie().flatMap((cookie) => {
    const separator = cookie.indexOf("=");
    const name = cookie.slice(0, separator);
    const value = cookie.slice(separator + 1).split(";", 1)[0];
    return value === "" || !name?.startsWith("__Host-uptech_") ? [] : [name];
  });
}

function hasCookieClear(response: Response, name: string): boolean {
  return response.headers.getSetCookie().some((cookie) =>
    cookie.startsWith(`${name}=;`) && cookie.includes("Max-Age=0"),
  );
}

test.before(() => {
  process.env.VERCEL = "1";
});

for (const scenario of [
  { outcome: "RATE_LIMITED", error: "rate_limited" },
  { outcome: "DENIED", error: "login_failed" },
]) {
  test(`transaction ${scenario.outcome} redirects to the safe ${scenario.error} login state`, async () => {
    initiateResult = { outcome: scenario.outcome };

    const response = await transactionRoute.POST(
      new Request(`${appOrigin}/api/v1/auth/google/transactions`, {
        method: "POST",
        headers: trustedHeaders,
      }),
    );

    loginLocation(response, scenario.error);
    assert.doesNotMatch(response.headers.get("content-type") ?? "", /json/i);
  });
}

test("transaction provider failures redirect to login instead of returning a problem document", async () => {
  initiateResult = new Error("provider unavailable");

  const response = await transactionRoute.POST(
    new Request(`${appOrigin}/api/v1/auth/google/transactions`, {
      method: "POST",
      headers: trustedHeaders,
    }),
  );

  loginLocation(response, "temporarily_unavailable");
  assert.doesNotMatch(response.headers.get("content-type") ?? "", /json/i);
});

test("runtime configuration failures never trust the request origin for login redirects", async () => {
  runtimeCreationError = new Error("runtime unavailable");
  try {
    for (const invoke of [
      () => transactionRoute.POST(
        new Request("https://unknown.example/api/v1/auth/google/transactions", {
          method: "POST",
          headers: trustedHeaders,
        }),
      ),
      () => callbackRoute.GET(
        new Request("https://unknown.example/api/v1/auth/google/callback", {
          headers: trustedHeaders,
        }),
      ),
    ]) {
      const response = await invoke();
      assert.equal(response.status, 303);
      const location = response.headers.get("location") ?? "";
      assert.match(location, /^\/login\?/u);
      assert.doesNotMatch(location, /unknown\.example/u);
    }
  } finally {
    runtimeCreationError = null;
  }
});

for (const scenario of [
  { outcome: "RATE_LIMITED", error: "rate_limited" },
  { outcome: "PERSONAL_GOOGLE_ACCOUNT", error: "personal_account" },
  {
    outcome: "ACCESS_DENIED",
    accessState: "UNKNOWN_WORKSPACE",
    error: "unknown_workspace",
  },
  {
    outcome: "ACCESS_DENIED",
    accessState: "USER_NOT_PROVISIONED",
    error: "access_required",
  },
  {
    outcome: "ACCESS_DENIED",
    accessState: "ACCESS_MAPPING_CONFLICT",
    error: "access_mapping_conflict",
  },
  {
    outcome: "ACCESS_DENIED",
    accessState: "USER_SUSPENDED",
    error: "user_suspended",
  },
  {
    outcome: "ACCESS_DENIED",
    accessState: "USER_REMOVED",
    error: "user_removed",
  },
  {
    outcome: "ACCESS_DENIED",
    accessState: "DIRECTORY_SYNC_PENDING",
    error: "directory_sync_pending",
  },
  {
    outcome: "ACCESS_DENIED",
    accessState: "DIRECTORY_STALE",
    error: "directory_stale",
  },
  {
    outcome: "ACCESS_DENIED",
    accessState: "DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE",
    error: "directory_stale_access_request_available",
  },
  {
    outcome: "ACCESS_DENIED",
    accessState: "WORKSPACE_SUSPENDED",
    error: "workspace_suspended",
  },
  { outcome: "PROVIDER_REJECTED", error: "provider_rejected" },
  { outcome: "PROVIDER_UNAVAILABLE", error: "temporarily_unavailable" },
  { outcome: "DENIED", error: "login_failed" },
]) {
  test(`callback maps ${scenario.outcome} to its safe ${scenario.error} login state without a session`, async () => {
    const { error: expectedError, ...result } = scenario;
    callbackResult = result;

    const response = await callbackRoute.GET(
      new Request(`${appOrigin}/api/v1/auth/google/callback?code=provider-code&state=opaque-state`, {
        headers: trustedHeaders,
      }),
    );

    loginLocation(response, expectedError);
    assert.equal(hasSessionCookie(response), false);
    assert.equal(hasOnboardingCookie(response), false);
  });
}

for (const route of ["/admin", "/home"] as const) {
  test(`NORMAL callback redirects only to the server-selected ${route} route and replaces stale authority`, async () => {
    const sessionCredential = issueSessionCredential().raw_token;
    callbackResult = { outcome: "NORMAL", sessionCredential, route };

    const response = await callbackRoute.GET(
      new Request(`${appOrigin}/api/v1/auth/google/callback?code=provider-code&state=opaque-state&route=https://attacker.example`, {
        headers: {
          ...trustedHeaders,
          cookie: "__Host-uptech_login_tx=transaction; __Host-uptech_session=stale; __Host-uptech_onboarding=stale; __Host-uptech_workspace_setup_tx=stale",
        },
      }),
    );

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `${appOrigin}${route}`);
    assert.deepEqual(nonEmptyAuthorityCookieNames(response), ["__Host-uptech_session"]);
    assert.ok(response.headers.getSetCookie().some((cookie) =>
      cookie === `__Host-uptech_session=${sessionCredential}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    ));
    for (const name of [
      "__Host-uptech_login_tx",
      "__Host-uptech_session",
      "__Host-uptech_onboarding",
      "__Host-uptech_workspace_setup_tx",
    ]) assert.equal(hasCookieClear(response, name), true);
  });
}

for (const scenario of [
  {
    accessState: "UNKNOWN_WORKSPACE",
    allowedOperations: [
      "FIRST_DOMAIN_CLAIM_READ",
      "FIRST_DOMAIN_CLAIM_RESERVE",
      "FIRST_DOMAIN_CLAIM_COMPLETE",
    ],
    error: "unknown_workspace",
  },
  {
    accessState: "USER_NOT_PROVISIONED",
    allowedOperations: ["ACCESS_REQUEST_READ", "ACCESS_REQUEST_SUBMIT"],
    error: "access_required",
  },
] as const) {
  test(`ONBOARDING ${scenario.accessState} commits only its onboarding authority`, async () => {
    const onboardingCredential = issueSessionCredential().raw_token;
    callbackResult = {
      outcome: "ONBOARDING",
      ...scenario,
      onboardingCredential,
      expiresAt: new Date(Date.now() + 60_000),
    };

    const response = await callbackRoute.GET(
      new Request(`${appOrigin}/api/v1/auth/google/callback?code=provider-code&state=opaque-state`, {
        headers: {
          ...trustedHeaders,
          cookie: "__Host-uptech_login_tx=transaction; __Host-uptech_session=stale; __Host-uptech_onboarding=stale; __Host-uptech_workspace_setup_tx=stale",
        },
      }),
    );

    loginLocation(response, scenario.error);
    assert.deepEqual(nonEmptyAuthorityCookieNames(response), ["__Host-uptech_onboarding"]);
    assert.ok(response.headers.getSetCookie().some((cookie) =>
      /^__Host-uptech_onboarding=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=[1-9][0-9]*$/u.test(cookie),
    ));
    for (const name of [
      "__Host-uptech_login_tx",
      "__Host-uptech_session",
      "__Host-uptech_onboarding",
      "__Host-uptech_workspace_setup_tx",
    ]) assert.equal(hasCookieClear(response, name), true);
  });
}

test("callback fails closed when a runtime result supplies an attacker route or access state", async () => {
  callbackResult = {
    outcome: "NORMAL",
    sessionCredential: issueSessionCredential().raw_token,
    route: "https://attacker.example/admin",
  };
  const routeResponse = await callbackRoute.GET(new Request(
    `${appOrigin}/api/v1/auth/google/callback?code=provider-code&state=opaque-state`,
    { headers: trustedHeaders },
  ));
  loginLocation(routeResponse, "login_failed");
  assert.equal(nonEmptyAuthorityCookieNames(routeResponse).length, 0);

  callbackResult = { outcome: "ACCESS_DENIED", accessState: "ATTACKER_STATE" };
  const stateResponse = await callbackRoute.GET(new Request(
    `${appOrigin}/api/v1/auth/google/callback?code=provider-code&state=opaque-state`,
    { headers: trustedHeaders },
  ));
  loginLocation(stateResponse, "login_failed");
  assert.equal(nonEmptyAuthorityCookieNames(stateResponse).length, 0);
});

test("session bootstrap treats an integrity failure as stale authority instead of a provider outage", async () => {
  webSessionResult = new WebSessionIntegrityError("binding mismatch");
  const credential = issueSessionCredential().raw_token;

  const response = await sessionRoute.GET(
    new Request(`${appOrigin}/api/v1/auth/session`, {
      headers: {
        ...trustedHeaders,
        cookie: `__Host-uptech_session=${credential}`,
      },
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    type: "urn:uptech:problem:unauthenticated",
    title: "Unauthenticated",
    status: 401,
    code: "UNAUTHENTICATED",
    detail: "Authentication is required.",
    request_id: requestId,
  });
});

test("Workspace bootstrap adapters expose only the guarded POST and callback GET flow", async () => {
  const onboarding = issueOpaqueProof();
  const setup = "1.AAAAAAAAAAAAAAAA.ciphertext.BBBBBBBBBBBBBBBBBBBBBB";
  const status = issueOpaqueProof();
  bootstrapInitiateResult = {
    authorizationUrl: new URL("https://accounts.google.com/o/oauth2/v2/auth?client_id=approved"),
    transactionCookie: setup,
  };
  const start = await bootstrapTransactionRoute.POST(new Request(
    `${appOrigin}/api/v1/onboarding/google-workspace/transactions`,
    {
      method: "POST",
      headers: {
        ...trustedHeaders,
        cookie: `__Host-uptech_onboarding=${onboarding}`,
        origin: appOrigin,
        "sec-fetch-site": "same-origin",
        "x-csrf-token": deriveCsrfCredential(onboarding, bootstrapPepper),
        "content-length": "0",
      },
    },
  ));
  assert.equal(start.status, 303);
  assert.equal(start.headers.get("location"), "https://accounts.google.com/o/oauth2/v2/auth?client_id=approved");
  assert.match(start.headers.get("set-cookie") ?? "", /__Host-uptech_workspace_setup_tx=/u);
  assert.equal(bootstrapAdmissionInputs.length, 1);
  const admission = bootstrapAdmissionInputs[0] as { readonly networkHmac: Uint8Array; readonly requestId: string };
  assert.equal(admission.networkHmac.byteLength, 32);
  assert.notEqual(Buffer.from(admission.networkHmac).toString("utf8"), trustedHeaders["x-vercel-forwarded-for"]);
  assert.equal(admission.requestId, requestId);

  bootstrapCallbackResult = {
    outcome: "PROVISIONING",
    statusCredential: status,
    statusExpiresAt: new Date(Date.now() + 60_000),
  };
  const callback = await bootstrapCallbackRoute.GET(new Request(
    `${appOrigin}/api/v1/onboarding/google-workspace/callback?code=provider-code&state=${issueOpaqueProof()}`,
    { headers: { ...trustedHeaders, cookie: `__Host-uptech_onboarding=${onboarding}; __Host-uptech_workspace_setup_tx=${setup}` } },
  ));
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get("location"), `${appOrigin}/setup/provisioning`);
  assert.equal(hasSessionCookie(callback), false);
  assert.ok(callback.headers.getSetCookie().some((cookie) => cookie.startsWith(`__Host-uptech_onboarding=${status};`)));
});

test("Workspace bootstrap recovery adapters expose only status, same-bound retry, and fresh normal login", async () => {
  bootstrapRecoveryInputs.length = 0;
  const statusCredential = issueOpaqueProof();
  const baseHeaders = {
    ...trustedHeaders,
    cookie: `__Host-uptech_onboarding=${statusCredential}`,
  };

  bootstrapStatusResult = { outcome: "READY" };
  const statusResponse = await bootstrapStatusRoute.GET(new Request(
    `${appOrigin}/api/v1/onboarding/google-workspace/status`,
    { headers: baseHeaders },
  ));
  assert.deepEqual(await statusResponse.json(), { state: "READY" });

  bootstrapRetryResult = { outcome: "REQUEUED" };
  const csrf = deriveCsrfCredential(statusCredential, bootstrapPepper);
  const retryResponse = await bootstrapRetryRoute.POST(new Request(
    `${appOrigin}/api/v1/onboarding/google-workspace/sync-retry`,
    { method: "POST", headers: { ...baseHeaders, origin: appOrigin, "sec-fetch-site": "same-origin", "x-csrf-token": csrf, "content-length": "0" } },
  ));
  assert.deepEqual(await retryResponse.json(), { state: "DIRECTORY_BOOTSTRAP_SYNC_PENDING" });

  initiateResult = {
    outcome: "REDIRECT",
    authorizationUrl: new URL("https://accounts.google.com/o/oauth2/v2/auth?client_id=approved"),
    loginCookie: issueOpaqueProof(),
    expiresAt: new Date(Date.now() + 600_000),
  };
  bootstrapFinishResult = { outcome: "FINISHED" };
  const finishResponse = await bootstrapFinishRoute.POST(new Request(
    `${appOrigin}/api/v1/onboarding/google-workspace/finish`,
    { method: "POST", headers: { ...baseHeaders, origin: appOrigin, "sec-fetch-site": "same-origin", "x-csrf-token": csrf, "content-length": "0" } },
  ));
  assert.equal(finishResponse.status, 303);
  assert.equal(finishResponse.headers.get("location"), "https://accounts.google.com/o/oauth2/v2/auth?client_id=approved");
  const cookies = finishResponse.headers.getSetCookie();
  assert.ok(cookies.some((cookie) => cookie.startsWith("__Host-uptech_login_tx=")));
  assert.ok(cookies.some((cookie) => cookie.startsWith("__Host-uptech_onboarding=;") && cookie.includes("Max-Age=0")));
  assert.equal(cookies.some((cookie) => cookie.includes("uptech_session")), false);
  assert.deepEqual(bootstrapRecoveryInputs.map((entry) => entry.operation), ["readStatus", "retrySync", "finish"]);
});

test("onboarding logout and access-request adapters expose only their bound repository operations", async () => {
  bootstrapRecoveryInputs.length = 0;
  const credential = issueOpaqueProof();
  const csrf = deriveCsrfCredential(credential, bootstrapPepper);
  const postHeaders = {
    ...trustedHeaders,
    cookie: `__Host-uptech_onboarding=${credential}`,
    origin: appOrigin,
    "sec-fetch-site": "same-origin",
    "x-csrf-token": csrf,
    "content-length": "0",
  };

  accessSubmitResult = { outcome: "PENDING", requestId: "00000000-0000-4000-8000-000000000093", status: "PENDING" };
  assert.deepEqual(await (await accessRequestRoute.POST(new Request(
    `${appOrigin}/api/v1/onboarding/access-requests`, { method: "POST", headers: postHeaders },
  ))).json(), { request_id: "00000000-0000-4000-8000-000000000093", status: "PENDING" });

  accessReadResult = { outcome: "FOUND", requestId: "00000000-0000-4000-8000-000000000093", status: "FULFILLED" };
  assert.deepEqual(await (await currentAccessRequestRoute.GET(new Request(
    `${appOrigin}/api/v1/onboarding/access-requests/current`, { headers: { ...trustedHeaders, cookie: `__Host-uptech_onboarding=${credential}` } },
  ))).json(), { request_id: "00000000-0000-4000-8000-000000000093", status: "FULFILLED" });

  bootstrapRevokeResult = { outcome: "REVOKED" };
  const logout = await onboardingLogoutRoute.POST(new Request(
    `${appOrigin}/api/v1/onboarding/logout`, { method: "POST", headers: postHeaders },
  ));
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.get("location"), `${appOrigin}/login`);
  assert.equal(logout.headers.getSetCookie().some((cookie) => cookie.includes("uptech_session")), false);
  assert.deepEqual(bootstrapRecoveryInputs.map((entry) => entry.operation), [
    "submitAccessRequest", "readAccessRequest", "revokeCapability",
  ]);
});
