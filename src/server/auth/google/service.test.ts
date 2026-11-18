import assert from "node:assert/strict";
import test from "node:test";

import type { IDToken } from "openid-client";

import { hashCredential } from "../../sessions/session-security.ts";
import {
  GOOGLE_ISSUER,
  GOOGLE_LOGIN_CONFIGURATION_KEY,
  type GoogleLoginRuntimeConfig,
} from "./config.ts";
import {
  decodeLoginTransactionCookie,
  deriveCsrfCredential,
  encodeLoginTransactionCookie,
  hashProof,
  isCanonicalProof,
  pkceAssociatedData,
} from "./crypto.ts";
import {
  GoogleOidcProviderUnavailableError,
  type GoogleAuthorizationTransaction,
  type GoogleOidcClient,
} from "./oidc.ts";
import type {
  BeginGoogleLoginInput,
  CompleteGoogleLoginInput,
  ConsumeGoogleLoginInput,
  GoogleLoginBeginResult,
  GoogleLoginCompletionResult,
  GoogleLoginConsumeResult,
  GoogleLoginRejectionClass,
  GoogleLoginRepository,
} from "./repository.ts";
import {
  createGoogleLoginService,
  GoogleLoginServiceError,
  type GoogleLoginService,
} from "./service.ts";

const INIT_REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const CALLBACK_REQUEST_ID = "00000000-0000-4000-8000-000000000002";
const CLIENT_IP = "203.0.113.17";

function proof(fill: number): string {
  return Buffer.alloc(32, fill).toString("base64url");
}

const AUTHORIZATION: GoogleAuthorizationTransaction = Object.freeze({
  state: proof(1),
  nonce: proof(2),
  pkceVerifier: proof(3),
  pkceChallenge: proof(4),
});

const CONFIG: GoogleLoginRuntimeConfig = Object.freeze({
  appOrigin: "https://tenant-a.example",
  redirectUri:
    "https://tenant-a.example/api/v1/auth/google/callback",
  clientId: "uptech-google-web-client.apps.googleusercontent.com",
  clientSecret: "raw-google-client-secret-never-for-the-database",
  environmentId: "offline_test",
  databaseUrl: "postgresql://unknown.example/uptech",
  rateHmacKey: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  pkceEncryptionKey: Uint8Array.from(
    { length: 32 },
    (_, index) => 255 - index,
  ),
  pkceKeyVersion: "offline-test-v1",
  sessionPepper: new Uint8Array(32).fill(0xa5),
});

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

type NonReservedConsumeResult = Exclude<
  GoogleLoginConsumeResult,
  { readonly outcome: "RESERVED" }
>;

class FakeRepository implements GoogleLoginRepository {
  readonly beginCalls: BeginGoogleLoginInput[] = [];
  readonly consumeCalls: ConsumeGoogleLoginInput[] = [];
  readonly completeCalls: CompleteGoogleLoginInput[] = [];
  readonly rejectUnboundCalls: Array<{
    readonly networkHmac: Uint8Array;
    readonly rejectionClass: GoogleLoginRejectionClass;
    readonly requestId: string;
  }> = [];
  readonly rejectBoundCalls: Array<{
    readonly completionHandleHash: Uint8Array;
    readonly rejectionClass: GoogleLoginRejectionClass;
    readonly requestId: string;
  }> = [];

  beginResult: GoogleLoginBeginResult = {
    outcome: "CREATED",
    expiresAt: new Date("2026-08-25T04:10:00.000Z"),
  };
  consumeOverride: NonReservedConsumeResult | undefined;
  completeResult: GoogleLoginCompletionResult = {
    outcome: "NORMAL",
    route: "/home",
  };
  rejectUnboundResult: "RECORDED" | "RATE_LIMITED" = "RECORDED";
  rejectBoundResult: "RECORDED" | "RATE_LIMITED" = "RECORDED";
  expectedNonceHash: Uint8Array | undefined;
  returnedPkceKmsKeyVersion = CONFIG.pkceKeyVersion;
  beginError: Error | undefined;
  consumeError: Error | undefined;
  completeError: Error | undefined;
  rejectUnboundError: Error | undefined;
  rejectBoundError: Error | undefined;
  syncProfileClaims?: GoogleLoginRepository["syncProfileClaims"];

  private transaction: BeginGoogleLoginInput | undefined;
  private completionHandleHash: Uint8Array | undefined;
  private consumed = false;

  async begin(input: BeginGoogleLoginInput): Promise<GoogleLoginBeginResult> {
    this.beginCalls.push(input);
    if (this.beginError !== undefined) {
      throw this.beginError;
    }
    if (this.beginResult.outcome === "CREATED") {
      this.transaction = input;
    }
    return this.beginResult;
  }

  async consume(
    input: ConsumeGoogleLoginInput,
  ): Promise<GoogleLoginConsumeResult> {
    this.consumeCalls.push(input);
    if (this.consumeError !== undefined) {
      throw this.consumeError;
    }
    if (this.consumeOverride !== undefined) {
      return this.consumeOverride;
    }
    if (
      this.consumed ||
      this.transaction === undefined ||
      !sameBytes(input.stateHash, this.transaction.stateHash) ||
      !sameBytes(
        input.browserBindingHash,
        this.transaction.browserBindingHash,
      )
    ) {
      return { outcome: "DENIED" };
    }
    this.consumed = true;
    this.completionHandleHash = input.completionHandleHash;
    return {
      outcome: "RESERVED",
      configurationKey: GOOGLE_LOGIN_CONFIGURATION_KEY,
      expectedNonceHash:
        this.expectedNonceHash ?? this.transaction.nonceHash,
      pkceEnvelope: this.transaction.pkceEnvelope,
      pkceKmsKeyVersion: this.returnedPkceKmsKeyVersion,
      pkceAssociatedData: pkceAssociatedData({
        environmentId: CONFIG.environmentId,
        locatorHash: this.transaction.stateHash,
      }),
      completionExpiresAt: new Date("2026-08-25T04:02:00.000Z"),
    };
  }

  async complete(
    input: CompleteGoogleLoginInput,
  ): Promise<GoogleLoginCompletionResult> {
    this.completeCalls.push(input);
    if (this.completeError !== undefined) {
      throw this.completeError;
    }
    if (
      this.completionHandleHash === undefined ||
      !sameBytes(input.completionHandleHash, this.completionHandleHash)
    ) {
      return { outcome: "DENIED", accessState: "USER_REMOVED" };
    }
    return this.completeResult;
  }

  async rejectUnbound(input: {
    readonly networkHmac: Uint8Array;
    readonly rejectionClass: GoogleLoginRejectionClass;
    readonly requestId: string;
  }): Promise<"RECORDED" | "RATE_LIMITED"> {
    this.rejectUnboundCalls.push(input);
    if (this.rejectUnboundError !== undefined) {
      throw this.rejectUnboundError;
    }
    return this.rejectUnboundResult;
  }

  async rejectBound(input: {
    readonly completionHandleHash: Uint8Array;
    readonly rejectionClass: GoogleLoginRejectionClass;
    readonly requestId: string;
  }): Promise<"RECORDED" | "RATE_LIMITED"> {
    this.rejectBoundCalls.push(input);
    if (this.rejectBoundError !== undefined) {
      throw this.rejectBoundError;
    }
    return this.rejectBoundResult;
  }
}

interface OidcBehavior {
  readonly createError?: Error;
  readonly buildError?: Error;
  readonly exchangeError?: Error;
  readonly claims?: (
    input: Parameters<GoogleOidcClient["exchangeAuthorizationCode"]>[0],
  ) => IDToken;
}

class FakeOidcClient implements GoogleOidcClient {
  readonly createCalls: number[] = [];
  readonly buildCalls: Array<{
    readonly config: GoogleLoginRuntimeConfig;
    readonly transaction: GoogleAuthorizationTransaction;
  }> = [];
  readonly exchangeCalls: Array<
    Parameters<GoogleOidcClient["exchangeAuthorizationCode"]>[0]
  > = [];
  private readonly behavior: OidcBehavior;

  constructor(behavior: OidcBehavior = {}) {
    this.behavior = behavior;
  }

  async createAuthorizationTransaction(): Promise<GoogleAuthorizationTransaction> {
    this.createCalls.push(this.createCalls.length + 1);
    if (this.behavior.createError !== undefined) {
      throw this.behavior.createError;
    }
    return AUTHORIZATION;
  }

  async buildAuthorizationUrl(
    config: GoogleLoginRuntimeConfig,
    transaction: GoogleAuthorizationTransaction,
  ): Promise<URL> {
    this.buildCalls.push({ config, transaction });
    if (this.behavior.buildError !== undefined) {
      throw this.behavior.buildError;
    }
    const result = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    result.searchParams.set("state", transaction.state);
    return result;
  }

  async exchangeAuthorizationCode(
    input: Parameters<GoogleOidcClient["exchangeAuthorizationCode"]>[0],
  ): Promise<IDToken> {
    this.exchangeCalls.push(input);
    if (this.behavior.exchangeError !== undefined) {
      throw this.behavior.exchangeError;
    }
    return (this.behavior.claims ?? ((value) => validClaims(value.nonce)))(
      input,
    );
  }
}

function validClaims(
  nonce: string,
  overrides: Readonly<Record<string, unknown>> = {},
): IDToken {
  const now = Math.floor(Date.now() / 1_000);
  return {
    iss: GOOGLE_ISSUER,
    aud: CONFIG.clientId,
    azp: CONFIG.clientId,
    sub: "google-subject-123",
    nonce,
    email: "Member@tenant-a.example",
    email_verified: true,
    hd: "tenant-a.example",
    iat: now - 5,
    exp: now + 3_600,
    name: "UPTECH Member",
    picture: "https://lh3.googleusercontent.com/member",
    // Unknown provider material must be discarded by the verifier.
    provider_private_claim: "raw-provider-material-never-for-the-database",
    ...overrides,
  } as IDToken;
}

function createHarness(behavior: OidcBehavior = {}): {
  readonly repository: FakeRepository;
  readonly oidc: FakeOidcClient;
  readonly service: GoogleLoginService;
} {
  const repository = new FakeRepository();
  const oidc = new FakeOidcClient(behavior);
  return {
    repository,
    oidc,
    service: createGoogleLoginService({
      config: CONFIG,
      repository,
      oidc,
    }),
  };
}

interface ExpectedRepositoryCalls {
  readonly begin: number;
  readonly consume: number;
  readonly complete: number;
  readonly rejectUnbound: number;
  readonly rejectBound: number;
}

function assertRepositoryCalls(
  repository: FakeRepository,
  expected: ExpectedRepositoryCalls,
): void {
  assert.deepEqual(
    {
      begin: repository.beginCalls.length,
      consume: repository.consumeCalls.length,
      complete: repository.completeCalls.length,
      rejectUnbound: repository.rejectUnboundCalls.length,
      rejectBound: repository.rejectBoundCalls.length,
    },
    expected,
  );
}

async function initiateCreated(harness: {
  readonly service: GoogleLoginService;
}): Promise<{
  readonly authorizationUrl: URL;
  readonly loginCookie: string;
  readonly state: string;
  readonly nonce: string;
}> {
  const result = await harness.service.initiate({
    canonicalClientIp: CLIENT_IP,
    requestId: INIT_REQUEST_ID,
  });
  assert.equal(result.outcome, "REDIRECT");
  if (result.outcome !== "REDIRECT") {
    assert.fail("expected a redirect initiation");
  }
  const cookie = decodeLoginTransactionCookie(result.loginCookie);
  assert.notEqual(cookie, null);
  if (cookie === null) {
    assert.fail("expected a login transaction cookie");
  }
  return {
    authorizationUrl: result.authorizationUrl,
    loginCookie: result.loginCookie,
    state: AUTHORIZATION.state,
    nonce: cookie.nonce,
  };
}

function callbackSearch(state: string): string {
  return `?code=provider-authorization-code&state=${encodeURIComponent(state)}`;
}

async function callbackWithStartedTransaction(
  harness: ReturnType<typeof createHarness>,
): Promise<Awaited<ReturnType<GoogleLoginService["callback"]>>> {
  const started = await initiateCreated(harness);
  return harness.service.callback({
    canonicalClientIp: CLIENT_IP,
    callbackSearch: callbackSearch(started.state),
    loginCookie: started.loginCookie,
    requestId: CALLBACK_REQUEST_ID,
  });
}

test("initiation creates one encrypted, browser-bound transaction and redirects", async () => {
  const harness = createHarness();

  const result = await harness.service.initiate({
    canonicalClientIp: CLIENT_IP,
    requestId: INIT_REQUEST_ID,
  });

  assert.equal(result.outcome, "REDIRECT");
  if (result.outcome !== "REDIRECT") {
    assert.fail("expected a redirect initiation");
  }
  assert.equal(result.authorizationUrl.origin, "https://accounts.google.com");
  assert.equal(result.authorizationUrl.searchParams.get("state"), AUTHORIZATION.state);
  assert.deepEqual(result.expiresAt, new Date("2026-08-25T04:10:00.000Z"));
  assert.equal(harness.oidc.createCalls.length, 1);
  assert.equal(harness.oidc.buildCalls.length, 1);
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 0,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 0,
  });

  const began = harness.repository.beginCalls[0];
  assert.deepEqual(Object.keys(began).sort(), [
    "browserBindingHash",
    "networkHmac",
    "nonceHash",
    "pkceEnvelope",
    "requestId",
    "stateHash",
  ]);
  for (const digest of [
    began.networkHmac,
    began.stateHash,
    began.nonceHash,
    began.browserBindingHash,
  ]) {
    assert.equal(digest.byteLength, 32);
  }
  assert.equal(
    Buffer.from(began.pkceEnvelope.ciphertext).includes(
      Buffer.from(AUTHORIZATION.pkceVerifier, "ascii"),
    ),
    false,
  );
  assert.notEqual(result.loginCookie, AUTHORIZATION.nonce);
  assert.equal(result.loginCookie.includes(AUTHORIZATION.pkceVerifier), false);
});

for (const outcome of ["RATE_LIMITED", "DENIED"] as const) {
  test(`initiation returns the database ${outcome} decision without issuing authority`, async () => {
    const harness = createHarness();
    harness.repository.beginResult = { outcome };

    const result = await harness.service.initiate({
      canonicalClientIp: CLIENT_IP,
      requestId: INIT_REQUEST_ID,
    });

    assert.deepEqual(result, { outcome });
    assert.equal(harness.oidc.buildCalls.length, 0);
    assertRepositoryCalls(harness.repository, {
      begin: 1,
      consume: 0,
      complete: 0,
      rejectUnbound: 0,
      rejectBound: 0,
    });
  });
}

test("initiation rate-limits before discovery and fails closed when discovery fails", async () => {
  const harness = createHarness({
    buildError: new Error("provider discovery unavailable"),
  });

  await assert.rejects(
    harness.service.initiate({
      canonicalClientIp: CLIENT_IP,
      requestId: INIT_REQUEST_ID,
    }),
    (error: unknown) =>
      error instanceof GoogleLoginServiceError &&
      error.message === "Google login provider is unavailable",
  );

  assert.equal(harness.oidc.createCalls.length, 1);
  assert.equal(harness.oidc.buildCalls.length, 1);
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 0,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 0,
  });
});

test("initiation records a single unbound failure when local transaction creation fails", async () => {
  const harness = createHarness({
    createError: new Error("local transaction generation failed"),
  });

  await assert.rejects(
    harness.service.initiate({
      canonicalClientIp: CLIENT_IP,
      requestId: INIT_REQUEST_ID,
    }),
    (error: unknown) =>
      error instanceof GoogleLoginServiceError &&
      error.message === "Google login transaction is unavailable",
  );

  assert.equal(harness.oidc.createCalls.length, 1);
  assert.equal(harness.oidc.buildCalls.length, 0);
  assertRepositoryCalls(harness.repository, {
    begin: 0,
    consume: 0,
    complete: 0,
    rejectUnbound: 1,
    rejectBound: 0,
  });
  assert.equal(
    harness.repository.rejectUnboundCalls[0].rejectionClass,
    "INTERNAL_FAILURE",
  );
});

test("initiation propagates a begin database failure without redirecting", async () => {
  const harness = createHarness();
  harness.repository.beginError = new Error("database begin unavailable");

  await assert.rejects(
    harness.service.initiate({
      canonicalClientIp: CLIENT_IP,
      requestId: INIT_REQUEST_ID,
    }),
    /database begin unavailable/u,
  );
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 0,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 0,
  });
});

test("normal callback consumes once and gives the database only verified claims and credential hashes", async () => {
  const harness = createHarness();

  const result = await callbackWithStartedTransaction(harness);

  assert.equal(result.outcome, "NORMAL");
  if (result.outcome !== "NORMAL") {
    assert.fail("expected a normal session");
  }
  assert.equal(isCanonicalProof(result.sessionCredential), true);
  assert.equal(result.route, "/home");
  assert.deepEqual(Object.keys(result).sort(), [
    "outcome",
    "route",
    "sessionCredential",
  ]);
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 1,
    rejectUnbound: 0,
    rejectBound: 0,
  });
  assert.equal(harness.oidc.exchangeCalls.length, 1);

  const completed = harness.repository.completeCalls[0];
  assert.deepEqual(Object.keys(completed).sort(), [
    "claims",
    "completionHandleHash",
    "csrfTokenHash",
    "onboardingTokenHash",
    "requestId",
    "sessionTokenHash",
  ]);
  assert.deepEqual(Object.keys(completed.claims).sort(), [
    "audienceConfigurationKey",
    "authorizedPartyConfigurationKey",
    "displayName",
    "emailVerified",
    "expiresAtEpochSeconds",
    "hostedDomain",
    "issuedAtEpochSeconds",
    "issuer",
    "nonceHash",
    "normalizedEmail",
    "pictureUrl",
    "providerSubject",
  ]);
  assert.equal(completed.claims.providerSubject, "google-subject-123");
  assert.equal(completed.claims.normalizedEmail, "member@tenant-a.example");
  assert.equal(completed.claims.hostedDomain, "tenant-a.example");
  assert.equal(completed.claims.emailVerified, true);
  assert.equal(
    "provider_private_claim" in completed.claims,
    false,
  );
  assert.deepEqual(
    Buffer.from(completed.sessionTokenHash),
    Buffer.from(hashCredential(result.sessionCredential), "hex"),
  );
  const csrf = deriveCsrfCredential(
    result.sessionCredential,
    CONFIG.sessionPepper,
  );
  assert.deepEqual(
    Buffer.from(completed.csrfTokenHash),
    Buffer.from(hashCredential(csrf), "hex"),
  );
  for (const digest of [
    completed.completionHandleHash,
    completed.sessionTokenHash,
    completed.csrfTokenHash,
    completed.onboardingTokenHash,
    completed.claims.nonceHash,
  ]) {
    assert.equal(digest.byteLength, 32);
  }

  const databaseBoundary = JSON.stringify(completed);
  for (const rawSecret of [
    CONFIG.clientSecret,
    AUTHORIZATION.state,
    AUTHORIZATION.nonce,
    AUTHORIZATION.pkceVerifier,
    "provider-authorization-code",
    "raw-provider-material-never-for-the-database",
    result.sessionCredential,
    csrf,
  ]) {
    assert.equal(databaseBoundary.includes(rawSecret), false);
  }
});

for (const route of ["/admin", "/home"] as const) {
  test(`a normal completion returns the database-selected ${route} route only`, async () => {
    const harness = createHarness();
    harness.repository.completeResult = { outcome: "NORMAL", route };

    const result = await callbackWithStartedTransaction(harness);

    assert.equal(result.outcome, "NORMAL");
    if (result.outcome !== "NORMAL") {
      assert.fail("expected a normal session");
    }
    assert.equal(result.route, route);
    assert.equal("onboardingCredential" in result, false);
    assert.equal("allowedOperations" in result, false);
    assert.equal("expiresAt" in result, false);
    assert.equal("accessState" in result, false);
  });
}

test("onboarding returns only its opaque credential and bounded operations", async () => {
  const harness = createHarness();
  const expiresAt = new Date("2026-08-25T04:15:00.000Z");
  harness.repository.completeResult = {
    outcome: "ONBOARDING",
    accessState: "USER_NOT_PROVISIONED",
    allowedOperations: ["ACCESS_REQUEST_READ", "ACCESS_REQUEST_SUBMIT"],
    expiresAt,
  };

  const result = await callbackWithStartedTransaction(harness);

  assert.equal(result.outcome, "ONBOARDING");
  if (result.outcome !== "ONBOARDING") {
    assert.fail("expected onboarding authority");
  }
  assert.equal(isCanonicalProof(result.onboardingCredential), true);
  assert.equal(result.accessState, "USER_NOT_PROVISIONED");
  assert.deepEqual(result.allowedOperations, [
    "ACCESS_REQUEST_READ",
    "ACCESS_REQUEST_SUBMIT",
  ]);
  assert.deepEqual(result.expiresAt, expiresAt);
  assert.deepEqual(
    Buffer.from(harness.repository.completeCalls[0].onboardingTokenHash),
    Buffer.from(hashProof(result.onboardingCredential)),
  );
  assert.equal("sessionCredential" in result, false);
  assert.equal("route" in result, false);
  assert.equal("csrfCredential" in result, false);
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 1,
    rejectUnbound: 0,
    rejectBound: 0,
  });
});

test("a completion denial returns no candidate credential", async () => {
  const harness = createHarness();
  harness.repository.completeResult = {
    outcome: "DENIED",
    accessState: "WORKSPACE_SUSPENDED",
  };

  const result = await callbackWithStartedTransaction(harness);

  assert.deepEqual(result, {
    outcome: "ACCESS_DENIED",
    accessState: "WORKSPACE_SUSPENDED",
  });
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 1,
    rejectUnbound: 0,
    rejectBound: 0,
  });
});

test("a callback with no valid browser binding is rejected unbound", async () => {
  const harness = createHarness();

  const result = await harness.service.callback({
    canonicalClientIp: CLIENT_IP,
    callbackSearch: callbackSearch(AUTHORIZATION.state),
    loginCookie: null,
    requestId: CALLBACK_REQUEST_ID,
  });

  assert.deepEqual(result, { outcome: "DENIED" });
  assertRepositoryCalls(harness.repository, {
    begin: 0,
    consume: 0,
    complete: 0,
    rejectUnbound: 1,
    rejectBound: 0,
  });
  assert.equal(
    harness.repository.rejectUnboundCalls[0].rejectionClass,
    "PROTOCOL_INVALID",
  );
});

test("malformed callbacks never perform a pre-limiter authority lookup", async () => {
  const harness = createHarness();
  let authorityLookups = 0;

  const result = await harness.service.callback({
    canonicalClientIp: CLIENT_IP,
    callbackSearch: "?code=authorization-code&state=malformed",
    loginCookie: null,
    inspectPreexistingBrowserAuthority: async () => {
      authorityLookups += 1;
      return false;
    },
    requestId: CALLBACK_REQUEST_ID,
  });

  assert.deepEqual(result, { outcome: "DENIED" });
  assert.equal(authorityLookups, 0);
  assert.equal(harness.repository.rejectUnboundCalls.length, 1);
});

test("rate-limited callback ingress never performs an authority lookup", async () => {
  const harness = createHarness();
  harness.repository.consumeOverride = { outcome: "RATE_LIMITED" };
  const started = await initiateCreated(harness);
  let authorityLookups = 0;

  const result = await harness.service.callback({
    canonicalClientIp: CLIENT_IP,
    callbackSearch: callbackSearch(started.state),
    loginCookie: started.loginCookie,
    inspectPreexistingBrowserAuthority: async () => {
      authorityLookups += 1;
      return false;
    },
    requestId: CALLBACK_REQUEST_ID,
  });

  assert.deepEqual(result, { outcome: "RATE_LIMITED" });
  assert.equal(authorityLookups, 0);
  assert.equal(harness.oidc.exchangeCalls.length, 0);
});

test("an unbound rejection obeys the shared rate-limit decision", async () => {
  const harness = createHarness();
  harness.repository.rejectUnboundResult = "RATE_LIMITED";

  const result = await harness.service.callback({
    canonicalClientIp: CLIENT_IP,
    callbackSearch: "?error=invalid_request",
    loginCookie: "malformed",
    requestId: CALLBACK_REQUEST_ID,
  });

  assert.deepEqual(result, { outcome: "RATE_LIMITED" });
  assertRepositoryCalls(harness.repository, {
    begin: 0,
    consume: 0,
    complete: 0,
    rejectUnbound: 1,
    rejectBound: 0,
  });
});

test("a canonical but wrong state is denied by the single consume routine", async () => {
  const harness = createHarness();
  const started = await initiateCreated(harness);
  const wrongState = proof(9);

  const result = await harness.service.callback({
    canonicalClientIp: CLIENT_IP,
    callbackSearch: callbackSearch(wrongState),
    loginCookie: started.loginCookie,
    requestId: CALLBACK_REQUEST_ID,
  });

  assert.deepEqual(result, { outcome: "DENIED" });
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 0,
  });
  assert.equal(harness.oidc.exchangeCalls.length, 0);
});

test("a wrong browser credential is denied before provider exchange", async () => {
  const harness = createHarness();
  const started = await initiateCreated(harness);
  const cookie = decodeLoginTransactionCookie(started.loginCookie);
  assert.notEqual(cookie, null);
  if (cookie === null) {
    assert.fail("expected a valid transaction cookie");
  }

  const result = await harness.service.callback({
    canonicalClientIp: CLIENT_IP,
    callbackSearch: callbackSearch(started.state),
    loginCookie: encodeLoginTransactionCookie({
      browserCredential: proof(8),
      nonce: cookie.nonce,
    }),
    requestId: CALLBACK_REQUEST_ID,
  });

  assert.deepEqual(result, { outcome: "DENIED" });
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 0,
  });
  assert.equal(harness.oidc.exchangeCalls.length, 0);
});

test("preexisting browser authority consumes and rejects the bound callback without exchange", async () => {
  const harness = createHarness();
  const started = await initiateCreated(harness);

  const result = await harness.service.callback({
    canonicalClientIp: CLIENT_IP,
    callbackSearch: callbackSearch(started.state),
    loginCookie: started.loginCookie,
    inspectPreexistingBrowserAuthority: async () => true,
    requestId: CALLBACK_REQUEST_ID,
  });

  assert.deepEqual(result, { outcome: "DENIED" });
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 1,
  });
  assert.equal(
    harness.repository.rejectBoundCalls[0].rejectionClass,
    "PROTOCOL_INVALID",
  );
  assert.equal(harness.oidc.exchangeCalls.length, 0);
});

test("a registry PKCE key-version mismatch rejects the reservation before decrypt or exchange", async () => {
  const harness = createHarness();
  harness.repository.returnedPkceKmsKeyVersion = "registry-v2";

  const result = await callbackWithStartedTransaction(harness);

  assert.deepEqual(result, { outcome: "DENIED" });
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 1,
  });
  assert.equal(
    harness.repository.rejectBoundCalls[0].rejectionClass,
    "PROTOCOL_INVALID",
  );
  assert.equal(harness.oidc.exchangeCalls.length, 0);
});

test("the same state/browser transaction cannot be consumed twice", async () => {
  const harness = createHarness();
  const started = await initiateCreated(harness);
  const operation = {
    canonicalClientIp: CLIENT_IP,
    callbackSearch: callbackSearch(started.state),
    loginCookie: started.loginCookie,
    requestId: CALLBACK_REQUEST_ID,
  } as const;

  const first = await harness.service.callback(operation);
  const replay = await harness.service.callback(operation);

  assert.equal(first.outcome, "NORMAL");
  assert.deepEqual(replay, { outcome: "DENIED" });
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 2,
    complete: 1,
    rejectUnbound: 0,
    rejectBound: 0,
  });
  assert.equal(harness.oidc.exchangeCalls.length, 1);
});

test("a stored nonce mismatch rejects the reserved transaction before exchange", async () => {
  const harness = createHarness();
  harness.repository.expectedNonceHash = hashProof(proof(7));

  const result = await callbackWithStartedTransaction(harness);

  assert.deepEqual(result, { outcome: "DENIED" });
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 1,
  });
  assert.equal(harness.oidc.exchangeCalls.length, 0);
  assert.equal(
    harness.repository.rejectBoundCalls[0].rejectionClass,
    "PROTOCOL_INVALID",
  );
});

test("a provider error callback is consumed and recorded without code exchange", async () => {
  const harness = createHarness();
  const started = await initiateCreated(harness);

  const result = await harness.service.callback({
    canonicalClientIp: CLIENT_IP,
    callbackSearch: `?error=access_denied&state=${encodeURIComponent(started.state)}`,
    loginCookie: started.loginCookie,
    requestId: CALLBACK_REQUEST_ID,
  });

  assert.deepEqual(result, { outcome: "PROVIDER_REJECTED" });
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 1,
  });
  assert.equal(harness.oidc.exchangeCalls.length, 0);
  assert.equal(
    harness.repository.rejectBoundCalls[0].rejectionClass,
    "PROVIDER_REJECTED",
  );
});

for (const transientError of ["temporarily_unavailable", "server_error"] as const) {
  test(`a ${transientError} callback is recorded as provider unavailable`, async () => {
    const harness = createHarness();
    const started = await initiateCreated(harness);

    const result = await harness.service.callback({
      canonicalClientIp: CLIENT_IP,
      callbackSearch: `?error=${transientError}&state=${encodeURIComponent(started.state)}`,
      loginCookie: started.loginCookie,
      requestId: CALLBACK_REQUEST_ID,
    });

    assert.deepEqual(result, { outcome: "PROVIDER_UNAVAILABLE" });
    assertRepositoryCalls(harness.repository, {
      begin: 1,
      consume: 1,
      complete: 0,
      rejectUnbound: 0,
      rejectBound: 1,
    });
    assert.equal(harness.oidc.exchangeCalls.length, 0);
    assert.equal(
      harness.repository.rejectBoundCalls[0].rejectionClass,
      "PROVIDER_UNAVAILABLE",
    );
  });
}

test("an unrecognized provider error is a generic verification denial", async () => {
  const harness = createHarness();
  const started = await initiateCreated(harness);

  const result = await harness.service.callback({
    canonicalClientIp: CLIENT_IP,
    callbackSearch: `?error=interaction_required&state=${encodeURIComponent(started.state)}`,
    loginCookie: started.loginCookie,
    requestId: CALLBACK_REQUEST_ID,
  });

  assert.deepEqual(result, { outcome: "DENIED" });
  assert.equal(harness.oidc.exchangeCalls.length, 0);
  assert.equal(
    harness.repository.rejectBoundCalls[0].rejectionClass,
    "CLAIMS_INVALID",
  );
});

test("provider unavailability after reservation is recorded and returns no authority", async () => {
  const harness = createHarness({
    exchangeError: new GoogleOidcProviderUnavailableError(
      "token endpoint unavailable",
    ),
  });

  const result = await callbackWithStartedTransaction(harness);

  assert.deepEqual(result, { outcome: "PROVIDER_UNAVAILABLE" });
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 1,
  });
  assert.equal(
    harness.repository.rejectBoundCalls[0].rejectionClass,
    "PROVIDER_UNAVAILABLE",
  );
});

const invalidClaimScenarios: ReadonlyArray<{
  readonly name: string;
  readonly overrides: (nonce: string) => Readonly<Record<string, unknown>>;
}> = [
  {
    name: "wrong audience",
    overrides: () => ({ aud: "other-client", azp: "other-client" }),
  },
  {
    name: "expired assertion",
    overrides: () => ({ exp: Math.floor(Date.now() / 1_000) - 121 }),
  },
  {
    name: "email_verified false",
    overrides: () => ({ email_verified: false }),
  },
  {
    name: "claim nonce mismatch",
    overrides: () => ({ nonce: proof(6) }),
  },
];

test("a personal Google account is denied with a Workspace-specific outcome", async () => {
  const harness = createHarness({
    claims: (input) => validClaims(input.nonce, { hd: undefined }),
  });

  const result = await callbackWithStartedTransaction(harness);

  assert.deepEqual(result, { outcome: "PERSONAL_GOOGLE_ACCOUNT" });
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 1,
  });
  assert.equal(
    harness.repository.rejectBoundCalls[0].rejectionClass,
    "CLAIMS_INVALID",
  );
});

for (const scenario of invalidClaimScenarios) {
  test(`verified-claim boundary denies ${scenario.name}`, async () => {
    const harness = createHarness({
      claims: (input) =>
        validClaims(input.nonce, scenario.overrides(input.nonce)),
    });

    const result = await callbackWithStartedTransaction(harness);

    assert.deepEqual(result, { outcome: "DENIED" });
    assertRepositoryCalls(harness.repository, {
      begin: 1,
      consume: 1,
      complete: 0,
      rejectUnbound: 0,
      rejectBound: 1,
    });
    assert.equal(
      harness.repository.rejectBoundCalls[0].rejectionClass,
      "CLAIMS_INVALID",
    );
  });
}

test("a consume database failure is fail-closed before provider exchange", async () => {
  const harness = createHarness();
  harness.repository.consumeError = new Error("database consume unavailable");

  await assert.rejects(
    callbackWithStartedTransaction(harness),
    /database consume unavailable/u,
  );
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 0,
  });
  assert.equal(harness.oidc.exchangeCalls.length, 0);
});

test("a completion database failure is fail-closed and leaks no credential", async () => {
  const harness = createHarness();
  harness.repository.completeError = new Error("database completion unavailable");

  await assert.rejects(
    callbackWithStartedTransaction(harness),
    /database completion unavailable/u,
  );
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 1,
    rejectUnbound: 0,
    rejectBound: 0,
  });
});

test("a rejection database failure remains fail-closed", async () => {
  const harness = createHarness({
    claims: (input) => validClaims(input.nonce, { email_verified: false }),
  });
  harness.repository.rejectBoundError = new Error(
    "database rejection unavailable",
  );

  await assert.rejects(
    callbackWithStartedTransaction(harness),
    /database rejection unavailable/u,
  );
  assertRepositoryCalls(harness.repository, {
    begin: 1,
    consume: 1,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 1,
  });
});

test("invalid request identifiers are rejected before any side effect", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.service.initiate({
      canonicalClientIp: CLIENT_IP,
      requestId: "not-a-request-id",
    }),
    GoogleLoginServiceError,
  );
  assertRepositoryCalls(harness.repository, {
    begin: 0,
    consume: 0,
    complete: 0,
    rejectUnbound: 0,
    rejectBound: 0,
  });
  assert.equal(harness.oidc.createCalls.length, 0);
});

test("normal callback syncs verified display name and picture without failing login when sync throws", async () => {
  const synced: Array<{
    readonly credentialHash: Uint8Array;
    readonly displayName: string | null;
    readonly pictureUrl: string | null;
  }> = [];
  const harness = createHarness();
  harness.repository.syncProfileClaims = async (input) => {
    synced.push(input);
  };

  const result = await callbackWithStartedTransaction(harness);
  assert.equal(result.outcome, "NORMAL");
  if (result.outcome !== "NORMAL") assert.fail("expected normal");
  assert.equal(synced.length, 1);
  assert.equal(synced[0]?.displayName, "UPTECH Member");
  assert.equal(synced[0]?.pictureUrl, "https://lh3.googleusercontent.com/member");
  assert.equal(
    Buffer.from(synced[0]!.credentialHash).toString("hex"),
    hashCredential(result.sessionCredential),
  );

  const resilientHarness = createHarness();
  resilientHarness.repository.syncProfileClaims = async () => {
    throw new Error("routine unavailable");
  };
  const resilientResult = await callbackWithStartedTransaction(resilientHarness);
  assert.equal(resilientResult.outcome, "NORMAL");
});
