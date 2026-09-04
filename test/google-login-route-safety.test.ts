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
let bootstrapAdmissionResult: unknown = { outcome: "ADMITTED" };
const bootstrapAdmissionInputs: unknown[] = [];
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
          async callback() {
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
    accessState: "USER_SUSPENDED",
    error: "user_suspended",
  },
  {
    outcome: "ACCESS_DENIED",
    accessState: "WORKSPACE_SUSPENDED",
    error: "workspace_suspended",
  },
  { outcome: "PROVIDER_REJECTED", error: "provider_rejected" },
  { outcome: "PROVIDER_UNAVAILABLE", error: "temporarily_unavailable" },
  {
    outcome: "ONBOARDING",
    onboardingCredential: issueSessionCredential().raw_token,
    allowedOperations: ["ACCESS_REQUEST_READ"],
    expiresAt: new Date("2026-09-01T04:15:00.000Z"),
    error: "access_required",
  },
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

test("only a NORMAL callback establishes a browser session", async () => {
  callbackResult = {
    outcome: "NORMAL",
    sessionCredential: issueSessionCredential().raw_token,
  };

  const response = await callbackRoute.GET(
    new Request(`${appOrigin}/api/v1/auth/google/callback?code=provider-code&state=opaque-state`, {
      headers: trustedHeaders,
    }),
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${appOrigin}/home`);
  assert.equal(hasSessionCookie(response), true);
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
