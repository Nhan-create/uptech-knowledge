import assert from "node:assert/strict";
import test from "node:test";

import { deriveCsrfCredential, hashProof, issueOpaqueProof } from "../../auth/google/crypto.ts";
import { GOOGLE_WORKSPACE_SETUP_COOKIE_NAME } from "./crypto.ts";
import { BootstrapCommitUnknownError } from "./repository.ts";
import {
  createAccessRequestPost,
  createCurrentAccessRequestGet,
  createGoogleWorkspaceBootstrapCallbackGet,
  createGoogleWorkspaceBootstrapPost,
  createBootstrapFinishPost,
  createBootstrapStatusGet,
  createBootstrapSyncRetryPost,
  createOnboardingLogoutPost,
  exactCsrfCredential,
  type AccessRequestDependencies,
  type BootstrapHttpDependencies,
  type BootstrapStatusDependencies,
} from "./http.ts";

const APP_ORIGIN = "https://knowledge.uptech.example";
const REQUEST_ID = "10000000-0000-4000-8000-000000000005";
const ONBOARDING = issueOpaqueProof();
const STATUS = issueOpaqueProof();
const SETUP = "1.AAAAAAAAAAAAAAAA.ciphertext.BBBBBBBBBBBBBBBBBBBBBB";
const PEPPER = new Uint8Array(32).fill(9);
const AUTHORIZATION = new URL("https://accounts.google.com/o/oauth2/v2/auth?client_id=approved");
const NETWORK_HMAC = new Uint8Array(32).fill(4);

test("exactCsrfCredential accepts only the derived canonical onboarding credential", () => {
  assert.equal(exactCsrfCredential(deriveCsrfCredential(ONBOARDING, PEPPER), ONBOARDING, PEPPER), true);
  assert.equal(exactCsrfCredential(issueOpaqueProof(), ONBOARDING, PEPPER), false);
  assert.equal(exactCsrfCredential("malformed", ONBOARDING, PEPPER), false);
});

function fixture() {
  const calls: unknown[] = [];
  const admissions: unknown[] = [];
  const service = {
    async initiate(input: { readonly onboardingCredential: string; readonly requestId: string }) {
      calls.push(input);
      return { authorizationUrl: AUTHORIZATION, transactionCookie: SETUP };
    },
    async callback(input: { readonly onboardingCredential: string; readonly callbackSearch: string; readonly transactionCookie: string; readonly requestId: string }) {
      calls.push(input);
      return {
        outcome: "PROVISIONING" as const,
        statusCredential: STATUS,
        statusExpiresAt: new Date(Date.now() + 60_000),
      };
    },
  };
  const dependencies: BootstrapHttpDependencies = {
    requestId: () => REQUEST_ID,
    loadRuntime: () => ({
      appOrigin: APP_ORIGIN,
      sessionPepper: PEPPER,
      async admitStart(input) { admissions.push(input); return { outcome: "ADMITTED" as const }; },
      service,
    }),
    networkHmac: () => NETWORK_HMAC,
  };
  return { admissions, calls, dependencies, service };
}

function startRequest(cookie = `__Host-uptech_onboarding=${ONBOARDING}`, headers: Record<string, string> = {}) {
  return new Request(`${APP_ORIGIN}/api/v1/onboarding/google-workspace/transactions`, {
    method: "POST",
    headers: {
      cookie,
      origin: APP_ORIGIN,
      "sec-fetch-site": "same-origin",
      "x-csrf-token": deriveCsrfCredential(ONBOARDING, PEPPER),
      "content-length": "0",
      ...headers,
    },
  });
}

function startFormRequest(options: {
  readonly body?: BodyInit;
  readonly contentLength?: string | null;
  readonly headers?: Record<string, string>;
  readonly method?: string;
  readonly suffix?: string;
} = {}) {
  const body = options.body ?? `csrf_token=${deriveCsrfCredential(ONBOARDING, PEPPER)}`;
  const headers: Record<string, string> = {
    cookie: `__Host-uptech_onboarding=${ONBOARDING}`,
    origin: APP_ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/x-www-form-urlencoded",
    ...options.headers,
  };
  if (options.contentLength !== null) {
    headers["content-length"] = options.contentLength ?? String(
      typeof body === "string" ? Buffer.byteLength(body) : (body as Uint8Array).byteLength,
    );
  }
  return new Request(`${APP_ORIGIN}/api/v1/onboarding/google-workspace/transactions${options.suffix ?? ""}`, {
    method: options.method ?? "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { readonly duplex: "half" });
}

function callbackRequest(query = "?code=provider-code&state=" + issueOpaqueProof(), cookie = `__Host-uptech_onboarding=${ONBOARDING}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`) {
  return new Request(`${APP_ORIGIN}/api/v1/onboarding/google-workspace/callback${query}`, {
    headers: { cookie },
  });
}

function assertSafe(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("setup POST accepts only the derived same-origin authority and redirects to Google", async () => {
  const fixtureValue = fixture();
  const response = await createGoogleWorkspaceBootstrapPost(fixtureValue.dependencies)(startRequest());

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), AUTHORIZATION.href);
  assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`^${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=`));
  assert.match(response.headers.get("set-cookie") ?? "", /Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600/u);
  assert.deepEqual(fixtureValue.calls, [{ onboardingCredential: ONBOARDING, requestId: REQUEST_ID }]);
  assert.deepEqual(fixtureValue.admissions, [{ networkHmac: NETWORK_HMAC, requestId: REQUEST_ID }]);
  assertSafe(response);
});

test("setup POST accepts the exact native form envelope with the legacy service contract", async () => {
  const f = fixture();
  const response = await createGoogleWorkspaceBootstrapPost(f.dependencies)(startFormRequest());

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), AUTHORIZATION.href);
  assert.deepEqual(f.calls, [{ onboardingCredential: ONBOARDING, requestId: REQUEST_ID }]);
  assert.deepEqual(f.admissions, [{ networkHmac: NETWORK_HMAC, requestId: REQUEST_ID }]);
  assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`^${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=`));
  assertSafe(response);
});

test("setup POST denies a canonical but wrong native-form CSRF proof before admission", async () => {
  const f = fixture();
  const response = await createGoogleWorkspaceBootstrapPost(f.dependencies)(startFormRequest({
    body: `csrf_token=${issueOpaqueProof()}`,
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(f.admissions, []);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(response.headers.getSetCookie(), []);
});

test("setup POST rejects hostile native-form envelopes before admission or authority issuance", async () => {
  const proof = deriveCsrfCredential(ONBOARDING, PEPPER);
  const invalidUtf8 = new Uint8Array([0xff]);
  const hostile = [
    startFormRequest({ method: "PUT" }),
    startFormRequest({ suffix: "?workspace_id=caller" }),
    startFormRequest({ suffix: "#fragment" }),
    startFormRequest({ headers: { authorization: "Bearer caller" } }),
    startFormRequest({ headers: { "transfer-encoding": "chunked" }, contentLength: null }),
    ...["content-encoding", "content-range", "expect", "trailer"].map((name) => startFormRequest({ headers: { [name]: "caller" } })),
    startFormRequest({ headers: { "x-csrf-token": proof } }),
    startFormRequest({ body: "" }),
    startFormRequest({ body: `csrf_token=${proof}&csrf_token=${proof}` }),
    startFormRequest({ body: `csrf_token=${proof}&role=OWNER` }),
    startFormRequest({ body: `role=OWNER&csrf_token=${proof}` }),
    startFormRequest({ headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" } }),
    startFormRequest({ headers: { "content-type": "text/plain" } }),
    startFormRequest({ body: `csrf_token=%41${proof.slice(1)}` }),
    startFormRequest({ body: `csrf_token=${proof}\0` }),
    startFormRequest({ body: `csrf_token=${proof}%00` }),
    startFormRequest({ body: invalidUtf8 }),
    startFormRequest({ body: `csrf_token=${proof.slice(1)}` }),
    startFormRequest({ body: `csrf_token=${proof}A` }),
    startFormRequest({ body: `csrf_token=${"!".repeat(43)}` }),
    startFormRequest({ contentLength: "054" }),
    startFormRequest({ contentLength: "55" }),
    ...["tenant", "workspace", "customer", "domain", "role", "return_url"].map((field) =>
      startFormRequest({ body: `csrf_token=${proof}&${field}=caller` })),
  ];

  for (const [index, request] of hostile.entries()) {
    const f = fixture();
    const response = await createGoogleWorkspaceBootstrapPost(f.dependencies)(request);
    assert.ok([400, 403].includes(response.status), `hostile case ${index} returned ${response.status}`);
    assert.deepEqual(f.admissions, []);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(response.headers.getSetCookie(), []);
  }
});

test("setup POST cancels a native-form stream as soon as it exceeds the bounded parser cap", async () => {
  let cancelled = false;
  const proof = deriveCsrfCredential(ONBOARDING, PEPPER);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`csrf_token=${proof}`));
      controller.enqueue(new Uint8Array(512));
    },
    cancel() { cancelled = true; },
  });
  const f = fixture();
  const response = await createGoogleWorkspaceBootstrapPost(f.dependencies)(startFormRequest({
    body: stream,
    contentLength: null,
  }));

  assert.equal(response.status, 400);
  assert.equal(cancelled, true);
  assert.deepEqual(f.admissions, []);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(response.headers.getSetCookie(), []);
});

test("setup POST rate-limit admission runs before and can prevent all service/provider work", async () => {
  for (const [outcome, status] of [["RATE_LIMITED", 429], ["DENIED", 403]] as const) {
    const f = fixture();
    const dependencies = { ...f.dependencies, loadRuntime: () => ({
      appOrigin: APP_ORIGIN,
      sessionPepper: PEPPER,
      admitStart: async () => ({ outcome }),
      service: f.service,
    }) } satisfies BootstrapHttpDependencies;
    const response = await createGoogleWorkspaceBootstrapPost(dependencies)(startRequest());
    assert.equal(response.status, status);
    assert.equal(f.calls.length, 0);
    assertSafe(response);
  }
  const f = fixture();
  const uncertainDependencies = { ...f.dependencies, loadRuntime: () => ({
    appOrigin: APP_ORIGIN,
    sessionPepper: PEPPER,
    async admitStart() { throw new Error("database uncertainty"); },
    service: f.service,
  }) } satisfies BootstrapHttpDependencies;
  const response = await createGoogleWorkspaceBootstrapPost(uncertainDependencies)(startRequest());
  assert.equal(response.status, 503);
  assert.equal(f.calls.length, 0);
  assertSafe(response);
});

test("callback runtime-load uncertainty is a terminal no-store problem that clears setup", async () => {
  const f = fixture();
  const dependencies = { ...f.dependencies, loadRuntime: () => { throw new Error("runtime unavailable"); } };
  const response = await createGoogleWorkspaceBootstrapCallbackGet(dependencies)(callbackRequest());
  assert.equal(response.status, 503);
  assert.equal(response.headers.has("location"), false);
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`) && cookie.includes("Max-Age=0")));
  assertSafe(response);
});

test("setup POST rejects missing or duplicate authority, setup/session coexistence, body authority, and bad CSRF metadata", async () => {
  for (const request of [
    startRequest("other=cookie"),
    startRequest(`__Host-uptech_onboarding=${ONBOARDING}; __Host-uptech_onboarding=${ONBOARDING}`),
    startRequest(`__Host-uptech_onboarding=${ONBOARDING}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`),
    startRequest(`__Host-uptech_onboarding=${ONBOARDING}; __Host-uptech_session=${issueOpaqueProof()}`),
    startRequest(undefined, { authorization: "Bearer browser-authority" }),
    startRequest(undefined, { origin: "https://evil.example" }),
    startRequest(undefined, { "sec-fetch-site": "same-site" }),
    startRequest(undefined, { "x-csrf-token": issueOpaqueProof() }),
    new Request(`${APP_ORIGIN}/api/v1/onboarding/google-workspace/transactions`, {
      method: "POST",
      headers: {
        cookie: `__Host-uptech_onboarding=${ONBOARDING}`,
        origin: APP_ORIGIN,
        "sec-fetch-site": "same-origin",
        "x-csrf-token": deriveCsrfCredential(ONBOARDING, PEPPER),
      },
      body: JSON.stringify({ workspace_id: "caller-controlled" }),
    }),
  ]) {
    const f = fixture();
    const response = await createGoogleWorkspaceBootstrapPost(f.dependencies)(request);
    assert.ok([400, 401, 403].includes(response.status));
    assert.equal(f.calls.length, 0);
    assertSafe(response);
  }
});

test("setup POST refuses non-exact Google authorization destinations", async () => {
  for (const authorizationUrl of [
    new URL("http://accounts.google.com/o/oauth2/v2/auth"),
    new URL("https://accounts.google.com.evil.example/o/oauth2/v2/auth"),
    new URL("https://accounts.google.com/o/oauth2/v2/auth/extra"),
  ]) {
    const f = fixture();
    f.service.initiate = async () => ({ authorizationUrl, transactionCookie: SETUP });
    const response = await createGoogleWorkspaceBootstrapPost(f.dependencies)(startRequest());
    assert.equal(response.status, 503);
    assert.equal(response.headers.has("location"), false);
    assertSafe(response);
  }
});

test("callback success clears setup, replaces onboarding with status authority, and never creates a session", async () => {
  const f = fixture();
  const response = await createGoogleWorkspaceBootstrapCallbackGet(f.dependencies)(callbackRequest());

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${APP_ORIGIN}/setup/provisioning`);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some((cookie) => cookie.startsWith(`${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`) && cookie.includes("Max-Age=0")));
  assert.ok(cookies.some((cookie) => cookie.startsWith(`__Host-uptech_onboarding=${STATUS};`)));
  assert.equal(cookies.some((cookie) => cookie.includes("uptech_session")), false);
  assert.equal(f.calls.length, 1);
  assertSafe(response);
});

test("callback enforces the 4,500-byte setup-cookie boundary", async () => {
  const accepted = fixture();
  const acceptedResponse = await createGoogleWorkspaceBootstrapCallbackGet(accepted.dependencies)(
    callbackRequest(undefined, `__Host-uptech_onboarding=${ONBOARDING}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${"A".repeat(4_500)}`),
  );
  assert.equal(acceptedResponse.status, 303);
  assert.equal(accepted.calls.length, 1);

  const rejected = fixture();
  const rejectedResponse = await createGoogleWorkspaceBootstrapCallbackGet(rejected.dependencies)(
    callbackRequest(undefined, `__Host-uptech_onboarding=${ONBOARDING}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${"A".repeat(4_501)}`),
  );
  assert.equal(new URL(rejectedResponse.headers.get("location")!).pathname, "/login");
  assert.equal(rejected.calls.length, 0);
  assertSafe(rejectedResponse);
});

test("callback rejects expired and over-24-hour status authority", async () => {
  const now = new Date("2030-01-01T00:00:00.000Z");
  for (const statusExpiresAt of [now, new Date(now.getTime() + 86_401_000)]) {
    const f = fixture();
    f.service.callback = async () => ({ outcome: "PROVISIONING", statusCredential: STATUS, statusExpiresAt });
    const response = await createGoogleWorkspaceBootstrapCallbackGet({ ...f.dependencies, now: () => now })(callbackRequest());
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("error"), "PROVIDER_UNAVAILABLE");
    assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`)));
    assertSafe(response);
  }
});

test("a replayed callback denial never republishes status authority", async () => {
  const f = fixture();
  let attempts = 0;
  f.service.callback = async () => {
    attempts += 1;
    if (attempts === 2) throw Object.assign(new Error("consumed"), { code: "ONBOARDING_EXPIRED" });
    return { outcome: "PROVISIONING", statusCredential: STATUS, statusExpiresAt: new Date(Date.now() + 60_000) };
  };
  assert.equal((await createGoogleWorkspaceBootstrapCallbackGet(f.dependencies)(callbackRequest())).headers.get("location"), `${APP_ORIGIN}/setup/provisioning`);
  const replay = await createGoogleWorkspaceBootstrapCallbackGet(f.dependencies)(callbackRequest());
  assert.equal(new URL(replay.headers.get("location")!).pathname, "/login");
  assert.equal(replay.headers.getSetCookie().some((cookie) => cookie.startsWith(`__Host-uptech_onboarding=${STATUS};`)), false);
  assertSafe(replay);
});

test("callback rejects malformed cookies and arbitrary or overlong Google query input while always clearing setup", async () => {
  for (const request of [
    callbackRequest("?code=ok&state=" + issueOpaqueProof() + "&tenant_id=caller-controlled"),
    callbackRequest("?code=ok&code=duplicate&state=" + issueOpaqueProof()),
    callbackRequest("?code=" + "x".repeat(4_097) + "&state=" + issueOpaqueProof()),
    callbackRequest(undefined, `__Host-uptech_onboarding=${ONBOARDING}`),
    callbackRequest(undefined, `${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`),
    callbackRequest(undefined, `__Host-uptech_onboarding=${ONBOARDING}; __Host-uptech_onboarding=${ONBOARDING}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`),
    callbackRequest(undefined, `__Host-uptech_onboarding=${ONBOARDING}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`),
    callbackRequest(undefined, `__Host-uptech_onboarding=${ONBOARDING}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}; __Host-uptech_session=${issueOpaqueProof()}`),
    new Request(`${APP_ORIGIN}/api/v1/onboarding/google-workspace/callback?code=ok&state=${issueOpaqueProof()}`, { headers: { cookie: `__Host-uptech_onboarding=${ONBOARDING}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`, authorization: "Bearer browser-authority" } }),
  ]) {
    const f = fixture();
    const response = await createGoogleWorkspaceBootstrapCallbackGet(f.dependencies)(request);
    assert.equal(response.status, 303);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.origin, APP_ORIGIN);
    assert.equal(location.pathname, "/login");
    assert.deepEqual([...location.searchParams.keys()].sort(), ["error", "request_id"]);
    assert.equal(f.calls.length, 0);
    assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`)));
    assertSafe(response);
  }
});

test("callback failures expose only an allowlisted code and server request UUID", async () => {
  const f = fixture();
  f.service.callback = async () => {
    throw Object.assign(new Error("provider said secret-domain.example token=leak"), { code: "SUPER_ADMIN_REQUIRED" });
  };
  const response = await createGoogleWorkspaceBootstrapCallbackGet(f.dependencies)(callbackRequest());
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.href, `${APP_ORIGIN}/login?error=SUPER_ADMIN_REQUIRED&request_id=${REQUEST_ID}`);
  assert.equal(JSON.stringify([...response.headers]).includes("secret-domain"), false);
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`)));
  assertSafe(response);
});

function recoveryFixture() {
  const calls: Array<{ readonly operation: string; readonly input: unknown }> = [];
  let statusOutcome = "DIRECTORY_BOOTSTRAP_SYNC_PENDING";
  let retryOutcome = "REQUEUED";
  let finishOutcome = "FINISHED";
  let revokeOutcome = "REVOKED";
  let submitOutcome: unknown = { outcome: "PENDING", requestId: "10000000-0000-4000-8000-000000000006", status: "PENDING" };
  let readOutcome: unknown = { outcome: "FOUND", requestId: "10000000-0000-4000-8000-000000000006", status: "FULFILLED" };
  let loginOutcome: unknown = {
    outcome: "REDIRECT",
    authorizationUrl: AUTHORIZATION,
    loginCookie: SETUP,
    expiresAt: new Date(Date.now() + 600_000),
  };
  const dependencies: BootstrapStatusDependencies = {
    requestId: () => REQUEST_ID,
    canonicalClientIp: () => "203.0.113.10",
    loadRuntime: () => ({
      appOrigin: APP_ORIGIN,
      sessionPepper: PEPPER,
      repository: {
        async readStatus(input) {
          calls.push({ operation: "readStatus", input });
          return { outcome: statusOutcome } as never;
        },
        async retrySync(input) {
          calls.push({ operation: "retrySync", input });
          return { outcome: retryOutcome } as never;
        },
        async finish(input) {
          calls.push({ operation: "finish", input });
          return { outcome: finishOutcome } as never;
        },
        async revokeCapability(input) {
          calls.push({ operation: "revokeCapability", input });
          return { outcome: revokeOutcome } as never;
        },
      },
      normalLoginService: {
        async initiate(input) {
          calls.push({ operation: "initiate", input });
          if (loginOutcome instanceof Error) throw loginOutcome;
          return loginOutcome as never;
        },
      },
    }),
  };
  return {
    calls,
    dependencies,
    setStatus(outcome: string) { statusOutcome = outcome; },
    setRetry(outcome: string) { retryOutcome = outcome; },
    setFinish(outcome: string) { finishOutcome = outcome; },
    setRevoke(outcome: string) { revokeOutcome = outcome; },
    setSubmit(outcome: unknown) { submitOutcome = outcome; },
    setRead(outcome: unknown) { readOutcome = outcome; },
    setLogin(outcome: unknown) { loginOutcome = outcome; },
    accessDependencies: {
      requestId: () => REQUEST_ID,
      loadRuntime: () => ({
        appOrigin: APP_ORIGIN,
        sessionPepper: PEPPER,
        repository: {
          async submitAccessRequest(input: unknown) {
            calls.push({ operation: "submitAccessRequest", input });
            return submitOutcome as never;
          },
          async readAccessRequest(input: unknown) {
            calls.push({ operation: "readAccessRequest", input });
            return readOutcome as never;
          },
        },
      }),
    } satisfies AccessRequestDependencies,
  };
}

function recoveryRequest(path: "status" | "sync-retry" | "finish", options: {
  readonly method?: "GET" | "POST";
  readonly cookie?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly query?: string;
} = {}) {
  const method = options.method ?? (path === "status" ? "GET" : "POST");
  return new Request(`${APP_ORIGIN}/api/v1/onboarding/google-workspace/${path}${options.query ?? ""}`, {
    method,
    headers: {
      cookie: options.cookie ?? `__Host-uptech_onboarding=${STATUS}`,
      ...(method === "POST" ? {
        origin: APP_ORIGIN,
        "sec-fetch-site": "same-origin",
        "x-csrf-token": deriveCsrfCredential(STATUS, PEPPER),
        "content-length": options.body === undefined ? "0" : String(Buffer.byteLength(options.body)),
      } : {}),
      ...options.headers,
    },
    body: options.body,
  });
}

function recoveryFormRequest(path: "finish" | "logout", options: {
  readonly body?: BodyInit;
  readonly contentLength?: string | null;
  readonly cookie?: string;
  readonly headers?: Record<string, string>;
  readonly suffix?: string;
} = {}) {
  const body = options.body ?? `csrf_token=${deriveCsrfCredential(STATUS, PEPPER)}`;
  const headers: Record<string, string> = {
    cookie: options.cookie ?? `__Host-uptech_onboarding=${STATUS}`,
    origin: APP_ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/x-www-form-urlencoded",
    ...options.headers,
  };
  if (options.contentLength !== null) {
    headers["content-length"] = options.contentLength ?? String(
      typeof body === "string" ? Buffer.byteLength(body) : (body as Uint8Array).byteLength,
    );
  }
  const pathname = path === "finish"
    ? "/api/v1/onboarding/google-workspace/finish"
    : "/api/v1/onboarding/logout";
  return new Request(`${APP_ORIGIN}${pathname}${options.suffix ?? ""}`, {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { readonly duplex: "half" });
}

test("status GET returns only the repository allowlisted public state", async () => {
  const f = recoveryFixture();
  const response = await createBootstrapStatusGet(f.dependencies)(recoveryRequest("status"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state: "DIRECTORY_BOOTSTRAP_SYNC_PENDING" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.operation, "readStatus");
  const input = f.calls[0]!.input as { readonly statusTokenHash: Uint8Array; readonly requestId: string };
  assert.deepEqual(input.statusTokenHash, hashProof(STATUS));
  assert.equal(input.requestId, REQUEST_ID);
  assertSafe(response);
});

test("status GET rejects query/body authority and every cookie-family conflict before repository work", async () => {
  for (const request of [
    recoveryRequest("status", { cookie: "other=cookie" }),
    recoveryRequest("status", { cookie: `__Host-uptech_onboarding=${STATUS}; __Host-uptech_onboarding=${STATUS}` }),
    recoveryRequest("status", { cookie: `__Host-uptech_onboarding=${STATUS}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}` }),
    recoveryRequest("status", { cookie: `__Host-uptech_onboarding=${STATUS}; __Host-uptech_session=${issueOpaqueProof()}` }),
    recoveryRequest("status", { headers: { authorization: "Bearer caller-authority" } }),
    recoveryRequest("status", { query: "?workspace_id=caller-controlled" }),
  ]) {
    const f = recoveryFixture();
    const response = await createBootstrapStatusGet(f.dependencies)(request);
    assert.ok([400, 401, 403].includes(response.status));
    assert.equal(f.calls.length, 0);
    assertSafe(response);
  }
});

test("sync retry accepts only bodyless same-origin status authority and maps requeue to pending", async () => {
  const f = recoveryFixture();
  const response = await createBootstrapSyncRetryPost(f.dependencies)(recoveryRequest("sync-retry"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state: "DIRECTORY_BOOTSTRAP_SYNC_PENDING" });
  assert.equal(f.calls[0]!.operation, "retrySync");
  assert.deepEqual((f.calls[0]!.input as { statusTokenHash: Uint8Array }).statusTokenHash, hashProof(STATUS));
  assertSafe(response);

  for (const request of [
    recoveryRequest("sync-retry", { headers: { origin: "https://evil.example" } }),
    recoveryRequest("sync-retry", { headers: { "sec-fetch-site": "same-site" } }),
    recoveryRequest("sync-retry", { headers: { "x-csrf-token": issueOpaqueProof() } }),
    recoveryRequest("sync-retry", { body: JSON.stringify({ job_id: "caller-controlled" }) }),
    recoveryRequest("sync-retry", { query: "?connector_id=caller-controlled" }),
  ]) {
    const denied = recoveryFixture();
    const deniedResponse = await createBootstrapSyncRetryPost(denied.dependencies)(request);
    assert.ok([400, 403].includes(deniedResponse.status));
    assert.equal(denied.calls.length, 0);
    assertSafe(deniedResponse);
  }
});

test("closed repository results expose only public expiry or generic unauthorized problems", async () => {
  const expired = recoveryFixture();
  expired.setStatus("ONBOARDING_EXPIRED");
  const expiredResponse = await createBootstrapStatusGet(expired.dependencies)(recoveryRequest("status"));
  assert.deepEqual(await expiredResponse.json(), { state: "ONBOARDING_EXPIRED" });

  for (const invoke of [
    (f: ReturnType<typeof recoveryFixture>) => { f.setStatus("DENIED"); return createBootstrapStatusGet(f.dependencies)(recoveryRequest("status")); },
    (f: ReturnType<typeof recoveryFixture>) => { f.setRetry("DENIED"); return createBootstrapSyncRetryPost(f.dependencies)(recoveryRequest("sync-retry")); },
  ]) {
    const f = recoveryFixture();
    const response = await invoke(f);
    assert.equal(response.status, 401);
    assert.equal(JSON.stringify(await response.json()).includes("workspace"), false);
    assertSafe(response);
  }
});

test("finish consumes READY status before starting a fresh normal login and clears transient authority", async () => {
  const f = recoveryFixture();
  const response = await createBootstrapFinishPost(f.dependencies)(recoveryRequest("finish"));

  assert.deepEqual(f.calls.map((call) => call.operation), ["finish", "initiate"]);
  assert.deepEqual(f.calls[1]!.input, { canonicalClientIp: "203.0.113.10", requestId: REQUEST_ID });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), AUTHORIZATION.href);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some((cookie) => cookie.startsWith("__Host-uptech_login_tx=")));
  assert.ok(cookies.some((cookie) => cookie.startsWith("__Host-uptech_onboarding=;") && cookie.includes("Max-Age=0")));
  assert.ok(cookies.some((cookie) => cookie.startsWith(`${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`) && cookie.includes("Max-Age=0")));
  assert.equal(cookies.some((cookie) => cookie.includes("uptech_session")), false);
  assertSafe(response);
});

test("finish accepts an exact native form and issues only the approved login authority in deterministic order", async () => {
  const f = recoveryFixture();
  const response = await createBootstrapFinishPost(f.dependencies)(recoveryFormRequest("finish"));

  assert.deepEqual(f.calls.map((call) => call.operation), ["finish", "initiate"]);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), AUTHORIZATION.href);
  const cookies = response.headers.getSetCookie();
  assert.match(cookies[0] ?? "", /^__Host-uptech_login_tx=/u);
  assert.match(cookies[1] ?? "", /^__Host-uptech_onboarding=;/u);
  assert.match(cookies[2] ?? "", new RegExp(`^${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`));
  assert.equal(cookies.some((cookie) => cookie.includes("uptech_session")), false);
  assertSafe(response);
});

test("finish accepts the exact bounded native form without Content-Length", async () => {
  const f = recoveryFixture();
  const response = await createBootstrapFinishPost(f.dependencies)(recoveryFormRequest("finish", {
    contentLength: null,
  }));

  assert.equal(response.status, 303);
  assert.deepEqual(f.calls.map((call) => call.operation), ["finish", "initiate"]);
});

test("finish never starts login when atomic READY consumption denies or request authority is caller-controlled", async () => {
  const denied = recoveryFixture();
  denied.setFinish("DENIED");
  const deniedResponse = await createBootstrapFinishPost(denied.dependencies)(recoveryRequest("finish"));
  assert.equal(deniedResponse.status, 401);
  assert.deepEqual(denied.calls.map((call) => call.operation), ["finish"]);

  for (const key of ["workspace_id", "connector_id", "job_id", "role", "department", "reason", "recipient"]) {
    const f = recoveryFixture();
    const response = await createBootstrapFinishPost(f.dependencies)(recoveryRequest("finish", {
      body: JSON.stringify({ [key]: "caller-controlled" }),
    }));
    assert.equal(response.status, 400);
    assert.equal(f.calls.length, 0);
  }
});

test("native-form finish retains denial and downstream login failure semantics", async () => {
  const denied = recoveryFixture();
  denied.setFinish("DENIED");
  const deniedResponse = await createBootstrapFinishPost(denied.dependencies)(recoveryFormRequest("finish"));
  assert.equal(deniedResponse.status, 401);
  assert.deepEqual(denied.calls.map((call) => call.operation), ["finish"]);
  assert.deepEqual(deniedResponse.headers.getSetCookie(), []);

  for (const [loginOutcome, error] of [
    [{ outcome: "RATE_LIMITED" }, "rate_limited"],
    [new Error("provider unavailable secret-token"), "temporarily_unavailable"],
  ] as const) {
    const f = recoveryFixture();
    f.setLogin(loginOutcome);
    const response = await createBootstrapFinishPost(f.dependencies)(recoveryFormRequest("finish"));
    assert.equal(response.status, 303);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("error"), error);
    assert.equal(location.href.includes("secret-token"), false);
    assert.deepEqual(f.calls.map((call) => call.operation), ["finish", "initiate"]);
    assert.equal(response.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-uptech_login_tx=")), false);
    assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-uptech_onboarding=;")));
    assertSafe(response);
  }
});

function capabilityRequest(path: "logout" | "access-requests" | "access-requests/current", options: {
  readonly method?: "GET" | "POST";
  readonly credential?: string;
  readonly cookie?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly query?: string;
} = {}) {
  const method = options.method ?? (path === "access-requests/current" ? "GET" : "POST");
  const credential = options.credential ?? STATUS;
  return new Request(`${APP_ORIGIN}/api/v1/onboarding/${path}${options.query ?? ""}`, {
    method,
    headers: {
      cookie: options.cookie ?? `__Host-uptech_onboarding=${credential}`,
      ...(method === "POST" ? {
        origin: APP_ORIGIN,
        "sec-fetch-site": "same-origin",
        "x-csrf-token": deriveCsrfCredential(credential, PEPPER),
        "content-length": options.body === undefined ? "0" : String(Buffer.byteLength(options.body)),
      } : {}),
      ...options.headers,
    },
    body: options.body,
  });
}

test("onboarding logout revokes only the presented capability hash then clears onboarding and setup authority", async () => {
  const f = recoveryFixture();
  const response = await createOnboardingLogoutPost(f.dependencies)(capabilityRequest("logout", {
    cookie: `__Host-uptech_onboarding=${STATUS}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`,
  }));

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${APP_ORIGIN}/login`);
  assert.deepEqual(f.calls, [{
    operation: "revokeCapability",
    input: { statusTokenHash: hashProof(STATUS), requestId: REQUEST_ID },
  }]);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some((cookie) => cookie.startsWith("__Host-uptech_onboarding=;") && cookie.includes("Max-Age=0")));
  assert.ok(cookies.some((cookie) => cookie.startsWith(`${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`) && cookie.includes("Max-Age=0")));
  assert.equal(cookies.some((cookie) => cookie.includes("uptech_session")), false);
  assertSafe(response);
});

test("onboarding logout accepts an exact native form, revokes once, and redirects with fixed clears", async () => {
  const f = recoveryFixture();
  const response = await createOnboardingLogoutPost(f.dependencies)(recoveryFormRequest("logout", {
    cookie: `__Host-uptech_onboarding=${STATUS}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`,
  }));

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${APP_ORIGIN}/login`);
  assert.deepEqual(f.calls, [{
    operation: "revokeCapability",
    input: { statusTokenHash: hashProof(STATUS), requestId: REQUEST_ID },
  }]);
  const cookies = response.headers.getSetCookie();
  assert.match(cookies[0] ?? "", /^__Host-uptech_onboarding=;/u);
  assert.match(cookies[1] ?? "", new RegExp(`^${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`));
  assertSafe(response);
});

test("finish and logout reject wrong-CSRF and hostile native forms before repository or login work", async () => {
  const proof = deriveCsrfCredential(STATUS, PEPPER);
  const hostile: ReadonlyArray<NonNullable<Parameters<typeof recoveryFormRequest>[1]>> = [
    { body: `csrf_token=${issueOpaqueProof()}` },
    { headers: { "x-csrf-token": proof } },
    { suffix: "?workspace_id=caller" },
    { suffix: "#fragment" },
    { headers: { origin: "https://evil.example" } },
    { headers: { "sec-fetch-site": "same-site" } },
    { headers: { authorization: "Bearer caller" } },
    { headers: { "content-type": "text/plain" } },
    { body: `csrf_token=${proof}&role=OWNER` },
    { body: `csrf_token=${proof}&csrf_token=${proof}` },
    { body: `csrf_token=%41${proof.slice(1)}` },
    { contentLength: "95" },
    { body: `csrf_token=${proof}${"A".repeat(97)}`, contentLength: null },
    { cookie: `__Host-uptech_onboarding=${STATUS}; __Host-uptech_onboarding=${STATUS}` },
    { cookie: `__Host-uptech_onboarding=${STATUS}; __Host-uptech_session=${issueOpaqueProof()}` },
  ];

  for (const path of ["finish", "logout"] as const) {
    for (const options of hostile) {
      const f = recoveryFixture();
      const response = path === "finish"
        ? await createBootstrapFinishPost(f.dependencies)(recoveryFormRequest(path, options))
        : await createOnboardingLogoutPost(f.dependencies)(recoveryFormRequest(path, options));
      assert.ok([400, 401, 403].includes(response.status));
      assert.deepEqual(f.calls, []);
      assert.deepEqual(response.headers.getSetCookie(), []);
      assertSafe(response);
    }
  }
});

test("native-form finish rejects setup-cookie coexistence before consuming READY", async () => {
  const f = recoveryFixture();
  const response = await createBootstrapFinishPost(f.dependencies)(recoveryFormRequest("finish", {
    cookie: `__Host-uptech_onboarding=${STATUS}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`,
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(response.headers.getSetCookie(), []);
});

test("onboarding logout does not claim an unrecognized copied capability was revoked", async () => {
  const f = recoveryFixture();
  f.setRevoke("DENIED");
  const response = await createOnboardingLogoutPost(f.dependencies)(capabilityRequest("logout", {
    cookie: `__Host-uptech_onboarding=${STATUS}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`,
  }));

  assert.equal(response.status, 401);
  assert.equal(response.headers.has("location"), false);
  assert.equal(response.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-uptech_onboarding=")), false);
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`)));
  assert.equal((await response.text()).includes("revoked"), false);
  assertSafe(response);
});

test("onboarding logout preserves retry authority across pre-commit and ambiguous revoke failures", async () => {
  for (const failure of [
    new Error("database unavailable before query secret-precommit"),
    new BootstrapCommitUnknownError(),
  ]) {
    let attempts = 0;
    const f = recoveryFixture();
    const dependencies = {
      ...f.dependencies,
      loadRuntime: () => ({
        appOrigin: APP_ORIGIN,
        sessionPepper: PEPPER,
        repository: {
          async readStatus() { throw new Error("unused"); },
          async retrySync() { throw new Error("unused"); },
          async finish() { throw new Error("unused"); },
          async revokeCapability() {
            attempts += 1;
            if (attempts === 1) throw failure;
            return { outcome: "REVOKED" as const };
          },
        },
      }),
    } satisfies BootstrapStatusDependencies;

    const first = await createOnboardingLogoutPost(dependencies)(capabilityRequest("logout", {
      cookie: `__Host-uptech_onboarding=${STATUS}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`,
    }));
    assert.equal(first.status, 503);
    assert.equal(first.headers.has("location"), false);
    assert.equal(first.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-uptech_onboarding=")), false);
    assert.ok(first.headers.getSetCookie().some((cookie) => cookie.startsWith(`${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`)));
    assert.equal((await first.text()).includes("secret-precommit"), false);
    assertSafe(first);

    const retry = await createOnboardingLogoutPost(dependencies)(capabilityRequest("logout"));
    assert.equal(retry.status, 303);
    assert.equal(retry.headers.get("location"), `${APP_ORIGIN}/login`);
    assert.ok(retry.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-uptech_onboarding=;")));
    assert.equal(attempts, 2);
    assertSafe(retry);
  }
});

test("onboarding logout rejects invalid caller authority before repository work", async () => {
  for (const request of [
    capabilityRequest("logout", { cookie: `__Host-uptech_onboarding=${STATUS}; __Host-uptech_onboarding=${STATUS}` }),
    capabilityRequest("logout", { cookie: `__Host-uptech_onboarding=${STATUS}; __Host-uptech_session=${issueOpaqueProof()}` }),
    capabilityRequest("logout", { headers: { authorization: "Bearer caller-authority" } }),
    capabilityRequest("logout", { headers: { origin: "https://evil.example" } }),
    capabilityRequest("logout", { headers: { "x-csrf-token": issueOpaqueProof() } }),
    capabilityRequest("logout", { query: "?workspace_id=caller-controlled" }),
    capabilityRequest("logout", { body: JSON.stringify({ reason: "caller-controlled" }) }),
  ]) {
    const f = recoveryFixture();
    const response = await createOnboardingLogoutPost(f.dependencies)(request);
    assert.ok([400, 401, 403].includes(response.status));
    assert.equal(f.calls.length, 0);
    assert.deepEqual(response.headers.getSetCookie(), []);
    assertSafe(response);
  }
});

test("access request submit/read use only the bound capability hash and return only public receipt fields", async () => {
  const f = recoveryFixture();
  const submitted = await createAccessRequestPost(f.accessDependencies)(capabilityRequest("access-requests"));
  assert.equal(submitted.status, 200);
  assert.deepEqual(await submitted.json(), {
    request_id: "10000000-0000-4000-8000-000000000006",
    status: "PENDING",
  });
  assertSafe(submitted);

  const current = await createCurrentAccessRequestGet(f.accessDependencies)(capabilityRequest("access-requests/current"));
  assert.equal(current.status, 200);
  assert.deepEqual(await current.json(), {
    request_id: "10000000-0000-4000-8000-000000000006",
    status: "FULFILLED",
  });
  assertSafe(current);
  assert.deepEqual(f.calls, [
    { operation: "submitAccessRequest", input: { statusTokenHash: hashProof(STATUS), requestId: REQUEST_ID } },
    { operation: "readAccessRequest", input: { statusTokenHash: hashProof(STATUS), requestId: REQUEST_ID } },
  ]);
});

test("access request routes reject client selectors, conflicting authorities, and closed capability denials before leaking tenant data", async () => {
  for (const key of ["workspace_id", "connector_id", "job_id", "role", "department", "reason", "recipient"]) {
    const f = recoveryFixture();
    const response = await createAccessRequestPost(f.accessDependencies)(capabilityRequest("access-requests", {
      body: JSON.stringify({ [key]: "caller-controlled" }),
    }));
    assert.equal(response.status, 400);
    assert.equal(f.calls.length, 0);
  }

  for (const invoke of [
    (f: ReturnType<typeof recoveryFixture>) => createAccessRequestPost(f.accessDependencies)(capabilityRequest("access-requests", { query: "?workspace_id=caller-controlled" })),
    (f: ReturnType<typeof recoveryFixture>) => createAccessRequestPost(f.accessDependencies)(capabilityRequest("access-requests", { cookie: `__Host-uptech_onboarding=${STATUS}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}` })),
    (f: ReturnType<typeof recoveryFixture>) => createAccessRequestPost(f.accessDependencies)(capabilityRequest("access-requests", { cookie: `__Host-uptech_onboarding=${STATUS}; __Host-uptech_session=${issueOpaqueProof()}` })),
    (f: ReturnType<typeof recoveryFixture>) => createAccessRequestPost(f.accessDependencies)(capabilityRequest("access-requests", { headers: { authorization: "Bearer caller-authority" } })),
    (f: ReturnType<typeof recoveryFixture>) => createAccessRequestPost(f.accessDependencies)(capabilityRequest("access-requests", { headers: { "sec-fetch-site": "same-site" } })),
    (f: ReturnType<typeof recoveryFixture>) => createCurrentAccessRequestGet(f.accessDependencies)(capabilityRequest("access-requests/current", { query: "?reason=caller-controlled" })),
    (f: ReturnType<typeof recoveryFixture>) => createCurrentAccessRequestGet(f.accessDependencies)(capabilityRequest("access-requests/current", { method: "POST", body: "{}" })),
  ]) {
    const f = recoveryFixture();
    const response = await invoke(f);
    assert.ok([400, 403].includes(response.status));
    assert.equal(f.calls.length, 0);
    assertSafe(response);
  }

  for (const scenario of ["wrong-family", "duplicate-operation", "expired", "revoked", "cross-workspace"] as const) {
    const f = recoveryFixture();
    f.setSubmit({ outcome: "DENIED", scenario });
    f.setRead({ outcome: "DENIED", scenario });
    for (const response of [
      await createAccessRequestPost(f.accessDependencies)(capabilityRequest("access-requests")),
      await createCurrentAccessRequestGet(f.accessDependencies)(capabilityRequest("access-requests/current")),
    ]) {
      assert.equal(response.status, 401);
      const serialized = JSON.stringify(await response.json());
      assert.equal(serialized.includes("workspace"), false);
      assert.equal(serialized.includes(scenario), false);
      assertSafe(response);
    }
  }
});
