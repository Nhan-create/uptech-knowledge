import assert from "node:assert/strict";
import test from "node:test";

import * as openid from "openid-client";

import { GOOGLE_ISSUER } from "../auth/google/config.ts";
import {
  createGoogleDirectoryConsentProvider,
  GOOGLE_DIRECTORY_CONSENT_SCOPES,
  GOOGLE_DIRECTORY_READ_ONLY_SCOPES,
  GoogleDirectoryConsentProviderError,
  type GoogleDirectoryConsentExchange,
  type GoogleDirectoryConsentProviderDependencies,
} from "./google-directory-consent-provider.ts";
import {
  GOOGLE_DIRECTORY_LEGACY_READ_ONLY_SCOPES,
  classifyGoogleDirectoryReadOnlyScopes,
  hasExactGoogleDirectoryReadOnlyScopes,
} from "./google-directory-scopes.ts";

const NOW = 1_788_224_400;
const CONFIG = Object.freeze({
  clientId: "directory-client.apps.googleusercontent.com",
  clientSecret: "directory-client-secret",
  redirectUri:
    "https://tenant-a.example/api/v1/admin/connectors/google-directory/callback",
});
const TRANSACTION = Object.freeze({
  state: Buffer.alloc(32, 0x11).toString("base64url"),
  nonce: Buffer.alloc(32, 0x22).toString("base64url"),
  pkceVerifier: "v".repeat(43),
  pkceChallenge: Buffer.alloc(32, 0x33).toString("base64url"),
});

function validExchange(
  overrides: Partial<GoogleDirectoryConsentExchange> = {},
): GoogleDirectoryConsentExchange {
  return {
    claims: {
      iss: GOOGLE_ISSUER,
      aud: CONFIG.clientId,
      azp: CONFIG.clientId,
      sub: "google-subject-admin",
      email: "Admin@Tenant-A.Example",
      email_verified: true,
      hd: "Tenant-A.Example",
      nonce: TRANSACTION.nonce,
      iat: NOW - 30,
      exp: NOW + 300,
    },
    accessToken: "directory-access-token",
    refreshToken: "directory-refresh-token",
    scope: GOOGLE_DIRECTORY_CONSENT_SCOPES.join(" "),
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface DirectoryFetchFixture {
  readonly requests: Array<{ readonly url: URL; readonly init?: RequestInit }>;
  readonly fetch: typeof globalThis.fetch;
}

function directoryFetchFixture(options: {
  readonly groups?: readonly Record<string, unknown>[];
  readonly currentUserId?: string;
  readonly currentUserCustomerId?: string;
  readonly currentUserArchived?: boolean;
  readonly domains?: readonly Record<string, unknown>[];
} = {}): DirectoryFetchFixture {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.endsWith("/customers/my_customer")) {
      return json({ id: "C0123abc", customerDomain: "Tenant-A.Example" });
    }
    if (url.pathname.endsWith("/customer/C0123abc/domains")) {
      return json({ domains: options.domains ?? [
        { domainName: "Tenant-A.Example", verified: true, isPrimary: true, domainAliases: [{ domainAliasName: "unknown.example", verified: true }] },
      ] });
    }
    if (url.pathname.includes("/users/") && !url.pathname.endsWith("/users")) {
      return json({
        id: options.currentUserId ?? "google-subject-admin",
        customerId: options.currentUserCustomerId ?? "C0123abc",
        primaryEmail: "admin@tenant-a.example",
        suspended: false,
        archived: options.currentUserArchived ?? false,
        isAdmin: true,
        isDelegatedAdmin: false,
      });
    }
    if (url.pathname.endsWith("/users")) {
      return json({ users: [{ id: "google-subject-admin" }] });
    }
    if (url.pathname.endsWith("/groups")) {
      return json({ groups: options.groups ?? [{ id: "group-1" }] });
    }
    if (url.pathname.endsWith("/members")) {
      return json({ members: [{ id: "google-subject-member", type: "USER" }] });
    }
    if (url.pathname.endsWith("/orgunits")) {
      return json({ organizationUnits: [] });
    }
    throw new Error(`Unexpected test URL: ${url.pathname}`);
  };
  return { requests, fetch };
}

function dependencies(
  options: {
    readonly exchange?: GoogleDirectoryConsentExchange;
    readonly fetch?: typeof globalThis.fetch;
    readonly timeoutMs?: number;
  } = {},
): GoogleDirectoryConsentProviderDependencies {
  return {
    createAuthorizationTransaction: async () => TRANSACTION,
    exchangeAuthorizationCode: async () => options.exchange ?? validExchange(),
    fetch: options.fetch ?? directoryFetchFixture().fetch,
    nowEpochSeconds: () => NOW,
    timeoutMs: options.timeoutMs,
  };
}

async function offlineGoogleConfiguration(): Promise<openid.Configuration> {
  const offlineFetch: openid.CustomFetch = async () =>
    json({
      issuer: GOOGLE_ISSUER,
      authorization_endpoint: `${GOOGLE_ISSUER}/o/oauth2/v2/auth`,
      token_endpoint: `${GOOGLE_ISSUER}/token`,
      jwks_uri: `${GOOGLE_ISSUER}/oauth2/v3/certs`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
    });
  return openid.discovery(
    new URL(GOOGLE_ISSUER),
    CONFIG.clientId,
    {
      client_secret: CONFIG.clientSecret,
      redirect_uris: [CONFIG.redirectUri],
      response_types: ["code"],
    },
    undefined,
    { [openid.customFetch]: offlineFetch },
  );
}

test("authorization request fixes identity and Directory read-only scopes with offline PKCE consent", async () => {
  const configuration = await offlineGoogleConfiguration();
  const provider = createGoogleDirectoryConsentProvider(CONFIG, {
    ...dependencies(),
    discover: async () => configuration,
  });

  const authorization = await provider.createAuthorization();
  const authorizationUrl = authorization.authorizationUrl;

  assert.equal(authorizationUrl.origin, "https://accounts.google.com");
  assert.equal(authorizationUrl.pathname, "/o/oauth2/v2/auth");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), CONFIG.redirectUri);
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
  assert.deepEqual(
    authorizationUrl.searchParams.get("scope")?.split(" "),
    [...GOOGLE_DIRECTORY_CONSENT_SCOPES],
  );
  assert.equal(authorizationUrl.searchParams.get("access_type"), "offline");
  assert.equal(authorizationUrl.searchParams.get("prompt"), "consent select_account");
  assert.equal(authorizationUrl.searchParams.get("include_granted_scopes"), "false");
  assert.equal(authorization.state, TRANSACTION.state);
  assert.equal(authorization.nonce, TRANSACTION.nonce);
  assert.equal(authorization.pkceVerifier, TRANSACTION.pkceVerifier);
  assert.equal(authorizationUrl.searchParams.get("state"), TRANSACTION.state);
  assert.equal(authorizationUrl.searchParams.get("nonce"), TRANSACTION.nonce);
  assert.equal(authorizationUrl.searchParams.get("code_challenge"), TRANSACTION.pkceChallenge);
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizationUrl.searchParams.has("hd"), false);
});

test("Directory consent accepts the exact bootstrap callback without weakening callback validation", () => {
  const bootstrapRedirectUri =
    "https://tenant-a.example/api/v1/onboarding/google-workspace/callback";
  assert.doesNotThrow(() => createGoogleDirectoryConsentProvider({
    ...CONFIG,
    redirectUri: bootstrapRedirectUri,
  }, dependencies()));

  for (const redirectUri of [
    `${bootstrapRedirectUri}/extra`,
    `${bootstrapRedirectUri}?next=/admin`,
    "https://tenant-a.example/api/v1/onboarding/google-workspace/other",
  ]) {
    assert.throws(
      () => createGoogleDirectoryConsentProvider({ ...CONFIG, redirectUri }, dependencies()),
      GoogleDirectoryConsentProviderError,
    );
  }
});

test("Directory scopes distinguish exact legacy and current grants", () => {
  assert.equal(classifyGoogleDirectoryReadOnlyScopes(GOOGLE_DIRECTORY_LEGACY_READ_ONLY_SCOPES), "LEGACY_FOUR");
  assert.equal(classifyGoogleDirectoryReadOnlyScopes(GOOGLE_DIRECTORY_READ_ONLY_SCOPES), "CURRENT_FIVE");
  assert.equal(classifyGoogleDirectoryReadOnlyScopes([...GOOGLE_DIRECTORY_READ_ONLY_SCOPES, GOOGLE_DIRECTORY_READ_ONLY_SCOPES[0]]), null);
  assert.equal(classifyGoogleDirectoryReadOnlyScopes([...GOOGLE_DIRECTORY_READ_ONLY_SCOPES, "https://www.googleapis.com/auth/drive.readonly"]), null);
  assert.equal(hasExactGoogleDirectoryReadOnlyScopes(GOOGLE_DIRECTORY_LEGACY_READ_ONLY_SCOPES), false);
  assert.equal(hasExactGoogleDirectoryReadOnlyScopes(GOOGLE_DIRECTORY_READ_ONLY_SCOPES), true);
});

test("exchange verifies the Workspace identity and derives bounded Directory setup evidence", async () => {
  const fixture = directoryFetchFixture();
  const provider = createGoogleDirectoryConsentProvider(CONFIG, dependencies({
    fetch: fixture.fetch,
  }));

  const result = await provider.exchangeAndProbe({
    callbackSearch: `?code=provider-code&state=${TRANSACTION.state}`,
    state: TRANSACTION.state,
    nonce: TRANSACTION.nonce,
    pkceVerifier: TRANSACTION.pkceVerifier,
  });

  assert.deepEqual(
    {
      ...result,
      refreshToken: new TextDecoder().decode(result.refreshToken),
    },
    {
      customerId: "C0123abc",
      directoryUserCustomerId: "C0123abc",
      directoryUserActive: true,
      primaryDomain: "tenant-a.example",
      verifiedDomains: [
        { normalizedDomain: "tenant-a.example", kind: "PRIMARY", providerParentDomain: null, verified: true },
        { normalizedDomain: "unknown.example", kind: "ALIAS", providerParentDomain: "tenant-a.example", verified: true },
      ],
      providerSubject: "google-subject-admin",
      normalizedEmail: "admin@tenant-a.example",
      hostedDomain: "tenant-a.example",
      refreshToken: "directory-refresh-token",
      grantedScopes: [...GOOGLE_DIRECTORY_READ_ONLY_SCOPES],
      isAdmin: true,
      isDelegatedAdmin: false,
      readProbes: {
        customer: true,
        users: true,
        groups: true,
        groupMembers: true,
        orgUnits: true,
      },
    },
  );
  assert.equal("accessToken" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /directory-access-token/u);
  assert.equal(fixture.requests.length, 7);
  for (const request of fixture.requests) {
    const headers = new Headers(request.init?.headers);
    assert.equal(request.init?.method, "GET");
    assert.equal(request.init?.cache, "no-store");
    assert.equal(request.init?.redirect, "error");
    assert.equal(request.init?.credentials, "omit");
    assert.equal(headers.get("authorization"), "Bearer directory-access-token");
    assert.equal(headers.get("accept"), "application/json");
    assert.ok(request.init?.signal instanceof AbortSignal);
  }
  const userList = fixture.requests.find(({ url }) => url.pathname.endsWith("/users"));
  assert.equal(userList?.url.searchParams.get("customer"), "my_customer");
  assert.equal(userList?.url.searchParams.get("projection"), "FULL");
  assert.equal(userList?.url.searchParams.get("viewType"), "admin_view");
  assert.equal(userList?.url.searchParams.get("maxResults"), "1");
  const memberList = fixture.requests.find(({ url }) => url.pathname.endsWith("/members"));
  assert.equal(memberList?.url.pathname, "/admin/directory/v1/groups/group-1/members");
  assert.equal(memberList?.url.searchParams.get("includeDerivedMembership"), "false");
  assert.equal(memberList?.url.searchParams.get("maxResults"), "1");
});

test("consent rejects a hosted domain absent from verified Google Workspace domains", async () => {
  const provider = createGoogleDirectoryConsentProvider(CONFIG, dependencies({
    fetch: directoryFetchFixture({
      domains: [{ domainName: "tenant-b.example", verified: true, isPrimary: true }],
    }).fetch,
  }));
  await assert.rejects(
    provider.exchangeAndProbe({
      callbackSearch: `?code=provider-code&state=${TRANSACTION.state}`,
      state: TRANSACTION.state,
      nonce: TRANSACTION.nonce,
      pkceVerifier: TRANSACTION.pkceVerifier,
    }),
    GoogleDirectoryConsentProviderError,
  );
});

test("an empty groups response is a successful vacuous direct-members probe", async () => {
  const fixture = directoryFetchFixture({ groups: [] });
  const provider = createGoogleDirectoryConsentProvider(CONFIG, dependencies({
    fetch: fixture.fetch,
  }));

  const result = await provider.exchangeAndProbe({
    callbackSearch: `?code=provider-code&state=${TRANSACTION.state}`,
    state: TRANSACTION.state,
    nonce: TRANSACTION.nonce,
    pkceVerifier: TRANSACTION.pkceVerifier,
  });

  assert.equal(result.readProbes.groupMembers, true);
  assert.equal(
    fixture.requests.some(({ url }) => url.pathname.endsWith("/members")),
    false,
  );
});

test("missing refresh token fails closed before any Directory request", async () => {
  let fetchCalls = 0;
  const provider = createGoogleDirectoryConsentProvider(CONFIG, dependencies({
    exchange: validExchange({ refreshToken: undefined }),
    fetch: async () => {
      fetchCalls += 1;
      return json({});
    },
  }));

  await assert.rejects(
    provider.exchangeAndProbe({
      callbackSearch: `?code=provider-code&state=${TRANSACTION.state}`,
      state: TRANSACTION.state,
      nonce: TRANSACTION.nonce,
      pkceVerifier: TRANSACTION.pkceVerifier,
    }),
    GoogleDirectoryConsentProviderError,
  );
  assert.equal(fetchCalls, 0);
});

test("a widened or incomplete OAuth scope grant fails closed", async () => {
  for (const scope of [
    `${GOOGLE_DIRECTORY_CONSENT_SCOPES.join(" ")} https://www.googleapis.com/auth/drive.readonly`,
    GOOGLE_DIRECTORY_CONSENT_SCOPES.slice(0, -1).join(" "),
  ]) {
    let fetchCalls = 0;
    const provider = createGoogleDirectoryConsentProvider(CONFIG, dependencies({
      exchange: validExchange({ scope }),
      fetch: async () => {
        fetchCalls += 1;
        return json({});
      },
    }));
    await assert.rejects(
      provider.exchangeAndProbe({
        callbackSearch: `?code=provider-code&state=${TRANSACTION.state}`,
        state: TRANSACTION.state,
        nonce: TRANSACTION.nonce,
        pkceVerifier: TRANSACTION.pkceVerifier,
      }),
      GoogleDirectoryConsentProviderError,
    );
    assert.equal(fetchCalls, 0);
  }
});

test("Google's canonical userinfo aliases are accepted without widening Directory authority", async () => {
  const fixture = directoryFetchFixture();
  const scope = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    ...GOOGLE_DIRECTORY_READ_ONLY_SCOPES,
  ].join(" ");
  const provider = createGoogleDirectoryConsentProvider(CONFIG, dependencies({
    exchange: validExchange({ scope }),
    fetch: fixture.fetch,
  }));

  const result = await provider.exchangeAndProbe({
    callbackSearch: `?code=provider-code&state=${TRANSACTION.state}`,
    state: TRANSACTION.state,
    nonce: TRANSACTION.nonce,
    pkceVerifier: TRANSACTION.pkceVerifier,
  });

  assert.deepEqual(result.grantedScopes, [...GOOGLE_DIRECTORY_READ_ONLY_SCOPES]);
});

test("claims and current Directory user must describe the same Google account", async () => {
  for (const scenario of [
    {
      exchange: validExchange({
        claims: { ...validExchange().claims, nonce: "x".repeat(43) },
      }),
      fixture: directoryFetchFixture(),
      expectedFetchCalls: 0,
    },
    {
      exchange: validExchange(),
      fixture: directoryFetchFixture({ currentUserId: "different-google-subject" }),
      expectedFetchCalls: 3,
    },
  ]) {
    const provider = createGoogleDirectoryConsentProvider(CONFIG, dependencies({
      exchange: scenario.exchange,
      fetch: scenario.fixture.fetch,
    }));
    await assert.rejects(
      provider.exchangeAndProbe({
        callbackSearch: `?code=provider-code&state=${TRANSACTION.state}`,
        state: TRANSACTION.state,
        nonce: TRANSACTION.nonce,
        pkceVerifier: TRANSACTION.pkceVerifier,
      }),
      GoogleDirectoryConsentProviderError,
    );
    assert.equal(scenario.fixture.requests.length, scenario.expectedFetchCalls);
  }
});

test("current Directory user must be active and belong to the probed customer", async () => {
  for (const fixture of [
    directoryFetchFixture({ currentUserCustomerId: "different-customer" }),
    directoryFetchFixture({ currentUserArchived: true }),
  ]) {
    const provider = createGoogleDirectoryConsentProvider(CONFIG, dependencies({
      exchange: validExchange(),
      fetch: fixture.fetch,
    }));
    await assert.rejects(provider.exchangeAndProbe({
      callbackSearch: `?code=provider-code&state=${TRANSACTION.state}`,
      state: TRANSACTION.state,
      nonce: TRANSACTION.nonce,
      pkceVerifier: TRANSACTION.pkceVerifier,
    }), GoogleDirectoryConsentProviderError);
    assert.equal(fixture.requests.length, 3);
  }
});

test("Directory redirects and timeouts fail closed without leaking bearer material", async () => {
  const failures: Array<{
    readonly fetch: typeof globalThis.fetch;
    readonly timeoutMs?: number;
  }> = [
    {
      fetch: async () => new Response(null, {
        status: 302,
        headers: { location: "https://tenant-b.example/token/directory-access-token" },
      }),
    },
    {
      timeoutMs: 5,
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("request with directory-access-token timed out"));
          }, { once: true });
        }),
    },
  ];

  for (const failure of failures) {
    const provider = createGoogleDirectoryConsentProvider(CONFIG, dependencies(failure));
    await assert.rejects(
      provider.exchangeAndProbe({
        callbackSearch: `?code=provider-code&state=${TRANSACTION.state}`,
        state: TRANSACTION.state,
        nonce: TRANSACTION.nonce,
        pkceVerifier: TRANSACTION.pkceVerifier,
      }),
      (error: unknown) => {
        assert.ok(error instanceof GoogleDirectoryConsentProviderError);
        assert.doesNotMatch(error.message, /access-token|attacker|timed out|tenant-b\.example/u);
        return true;
      },
    );
  }
});

test("Directory HTTP 403 attaches non-sensitive probe diagnosticCode without leaking response body", async () => {
  const provider = createGoogleDirectoryConsentProvider(CONFIG, dependencies({
    fetch: async () => new Response(JSON.stringify({ error: { message: "secret-detail for tenant-a.example" } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  }));

  await assert.rejects(
    provider.exchangeAndProbe({
      callbackSearch: `?code=provider-code&state=${TRANSACTION.state}`,
      state: TRANSACTION.state,
      nonce: TRANSACTION.nonce,
      pkceVerifier: TRANSACTION.pkceVerifier,
    }),
    (error: unknown) => {
      assert.ok(error instanceof GoogleDirectoryConsentProviderError);
      assert.equal(error.message, "Google Directory consent could not be verified");
      assert.equal(error.diagnosticCode, "PROBE_CUSTOMER_HTTP_403");
      return true;
    },
  );
});

test("personal Google account without hd claim surfaces PERSONAL_GOOGLE_ACCOUNT diagnosticCode", async () => {
  const base = validExchange();
  const { hd: _omitHd, ...claimsWithoutHd } = base.claims;
  void _omitHd;
  const provider = createGoogleDirectoryConsentProvider(CONFIG, dependencies({
    exchange: validExchange({
      claims: {
        ...claimsWithoutHd,
        sub: "google-subject-personal",
        email: "person@unknown.example",
      },
    }),
  }));

  await assert.rejects(
    provider.exchangeAndProbe({
      callbackSearch: `?code=provider-code&state=${TRANSACTION.state}`,
      state: TRANSACTION.state,
      nonce: TRANSACTION.nonce,
      pkceVerifier: TRANSACTION.pkceVerifier,
    }),
    (error: unknown) => {
      assert.ok(error instanceof GoogleDirectoryConsentProviderError);
      assert.equal(error.diagnosticCode, "PERSONAL_GOOGLE_ACCOUNT");
      return true;
    },
  );
});
