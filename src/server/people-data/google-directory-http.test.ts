import assert from "node:assert/strict";
import test from "node:test";

import { createGoogleDirectoryHttpTransport } from "./google-directory-http.ts";

const lease = {
  jobId: "123e4567-e89b-42d3-a456-426614174000",
  jobKind: "DIRECTORY_SYNC" as const,
  workspaceId: "223e4567-e89b-42d3-a456-426614174000",
  serviceActor: "323e4567-e89b-42d3-a456-426614174000",
  connectorId: "423e4567-e89b-42d3-a456-426614174000",
  sourceId: null,
  leaseFence: "523e4567-e89b-42d3-a456-426614174000",
  leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
};

test("Google Directory transport follows every user page before returning a complete snapshot", async () => {
  const urls: string[] = [];
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: { async getAccessToken() { return "server-token"; } },
    freshFor: 60_000,
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      return new Response(JSON.stringify(url.includes("pageToken=second")
        ? { users: [{ id: "tenant-a-subject-2", name: { fullName: "Two" }, primaryEmail: "two@tenant-a.example", orgUnitPath: "/", suspended: true }] }
        : { users: [{ id: "tenant-a-subject-1", name: { fullName: "One" }, primaryEmail: "one@tenant-a.example", orgUnitPath: "/", isAdmin: true }], nextPageToken: "second" }),
        { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const users = await transport.listUsers();

  assert.equal(users.traversalComplete, true);
  assert.deepEqual(users.items.map((user) => [user.googleSubject, user.lifecycleState, user.isAdmin]), [
    ["tenant-a-subject-1", "ACTIVE", true],
    ["tenant-a-subject-2", "SUSPENDED", false],
  ]);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /pageToken=second/u);
});

test("Google Directory transport binds the customer and selects the primary organization department", async () => {
  const urls: string[] = [];
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: { async getAccessToken() { return "server-token"; } },
    freshFor: 60_000,
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/customers/my_customer")) {
        return new Response(JSON.stringify({ id: "C012345", customerDomain: "tenant-a.example" }), { status: 200 });
      }
      return new Response(JSON.stringify({
        users: [{
          id: "tenant-a-subject-1",
          name: { fullName: "One" },
          primaryEmail: "one@tenant-a.example",
          orgUnitPath: "/Sales",
          isAdmin: true,
          isDelegatedAdmin: true,
          organizations: [
            { department: "Engineering", primary: false },
            { department: "Sales", primary: true },
          ],
        }],
      }), { status: 200 });
    },
  });

  const [customer, users] = await Promise.all([
    transport.getCustomer(),
    transport.listUsers(),
  ]);

  assert.deepEqual(customer, {
    googleCustomerId: "C012345",
    primaryDomain: "tenant-a.example",
  });
  assert.deepEqual(users.items[0], {
    googleSubject: "tenant-a-subject-1",
    fullName: "One",
    primaryEmail: "one@tenant-a.example",
    department: "Sales",
    orgUnitPath: "/Sales",
    lifecycleState: "ACTIVE",
    isAdmin: true,
    isDelegatedAdmin: true,
  });
  assert.ok(urls.some((url) => url.includes("/customers/my_customer")));
});

test("Google Directory transport returns stable organizational-unit identifiers and parents", async () => {
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: { async getAccessToken() { return "server-token"; } },
    freshFor: 60_000,
    fetch: async (input) => {
      const url = new URL(String(input));
      assert.match(url.pathname, /customer\/my_customer\/orgunits/u);
      assert.equal(url.searchParams.get("type"), "ALL_INCLUDING_PARENT");
      assert.equal(url.searchParams.has("maxResults"), false);
      assert.equal(url.searchParams.has("pageToken"), false);
      return new Response(JSON.stringify({ organizationUnits: [
        { orgUnitId: "root", orgUnitPath: "/" },
        { orgUnitId: "sales", orgUnitPath: "/Sales", parentOrgUnitId: "root" },
      ] }), { status: 200 });
    },
  });

  const units = await transport.listOrgUnits();

  assert.deepEqual(units.items, [
    { googleOrgUnitId: "root", orgUnitPath: "/", parentGoogleOrgUnitId: null },
    { googleOrgUnitId: "sales", orgUnitPath: "/Sales", parentGoogleOrgUnitId: "root" },
  ]);
  assert.equal(units.traversalComplete, true);
});

test("Google Directory transport follows every customer-bound group page", async () => {
  const urls: URL[] = [];
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: { async getAccessToken() { return "server-token"; } },
    freshFor: 60_000,
    fetch: async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      return new Response(JSON.stringify(
        url.searchParams.get("pageToken") === "groups-page-2"
          ? {
              kind: "admin#directory#groups",
              groups: [{
                id: "tenant-a-group-2",
                name: "Human Resources",
                email: "hr@tenant-a.example",
              }],
            }
          : {
              kind: "admin#directory#groups",
              groups: [{
                id: "tenant-a-group-1",
                name: "Sales",
                email: "sales@tenant-a.example",
              }],
              nextPageToken: "groups-page-2",
            },
      ), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const groups = await transport.listGroups();

  assert.deepEqual(groups.items, [
    { googleGroupId: "tenant-a-group-1", groupName: "Sales" },
    { googleGroupId: "tenant-a-group-2", groupName: "Human Resources" },
  ]);
  assert.equal(groups.traversalComplete, true);
  assert.equal(urls.length, 2);
  assert.equal(urls[0].pathname, "/admin/directory/v1/groups");
  assert.equal(urls[0].searchParams.get("customer"), "my_customer");
  assert.equal(urls[1].searchParams.get("pageToken"), "groups-page-2");
});

test("Google Directory transport follows every direct-member page without expanding nested groups", async () => {
  const urls: URL[] = [];
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: { async getAccessToken() { return "server-token"; } },
    freshFor: 60_000,
    fetch: async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      return new Response(JSON.stringify(
        url.searchParams.get("pageToken") === "members-page-2"
          ? {
              kind: "admin#directory#members",
              members: [{
                id: "tenant-a-subject-2",
                email: "two@tenant-a.example",
                role: "MEMBER",
                status: "ACTIVE",
                type: "USER",
              }],
            }
          : {
              kind: "admin#directory#members",
              members: [
                {
                  id: "tenant-a-subject-1",
                  email: "one@tenant-a.example",
                  role: "MEMBER",
                  status: "ACTIVE",
                  type: "USER",
                },
                {
                  id: "nested-group",
                  email: "nested@tenant-a.example",
                  role: "MEMBER",
                  status: "ACTIVE",
                  type: "GROUP",
                },
              ],
              nextPageToken: "members-page-2",
            },
      ), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const members = await transport.listDirectMembers("tenant-a/group");

  assert.deepEqual(members.items, [
    { googleSubject: "tenant-a-subject-1" },
    { googleSubject: "tenant-a-subject-2" },
  ]);
  assert.equal(members.traversalComplete, true);
  assert.equal(urls.length, 2);
  assert.equal(
    urls[0].pathname,
    "/admin/directory/v1/groups/tenant-a%2Fgroup/members",
  );
  assert.equal(urls[0].searchParams.get("includeDerivedMembership"), "false");
  assert.equal(urls[1].searchParams.get("pageToken"), "members-page-2");
});

test("Google Directory transport fails closed on a repeated page token", async () => {
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: { async getAccessToken() { return "server-token"; } },
    fetch: async () => new Response(JSON.stringify({ groups: [], nextPageToken: "loop" }), { status: 200 }),
  });

  await assert.rejects(transport.listGroups(), /repeated a page token/u);
});

test("Google Directory transport rejects a non-Directory lease before token or network access", () => {
  let tokenCalls = 0;
  let fetchCalls = 0;
  assert.throws(
    () => createGoogleDirectoryHttpTransport(
      { ...lease, jobKind: "DRIVE_SYNC", sourceId: "623e4567-e89b-42d3-a456-426614174000" },
      {
        accessTokenProvider: { async getAccessToken() { tokenCalls += 1; return "server-token"; } },
        fetch: async () => { fetchCalls += 1; return new Response(null, { status: 500 }); },
      },
    ),
    /DIRECTORY_SYNC/u,
  );
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("Google Directory transport rejects freshness beyond the approved TTL", () => {
  assert.throws(
    () => createGoogleDirectoryHttpTransport(lease, {
      accessTokenProvider: { async getAccessToken() { return "server-token"; } },
      freshFor: 5 * 60_000 + 1,
      fetch: async () => new Response("{}", { status: 200 }),
    }),
    /not configured/u,
  );
});

test("Google Directory transport rejects request timeouts beyond the approved maximum", () => {
  assert.throws(
    () => createGoogleDirectoryHttpTransport(lease, {
      accessTokenProvider: { async getAccessToken() { return "server-token"; } },
      timeoutMs: 30_001,
      fetch: async () => new Response("{}", { status: 200 }),
    }),
    /not configured/u,
  );
});

test("Google Directory transport sanitizes credential failures without making a request", async () => {
  let fetchCalls = 0;
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: {
      async getAccessToken() {
        throw new Error("provider failure containing server-token");
      },
    },
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("must not make a Directory request");
    },
  });

  await assert.rejects(
    transport.listGroups(),
    (error: unknown) => {
      assert.equal(
        error instanceof Error ? error.message : String(error),
        "Google Directory request failed",
      );
      assert.doesNotMatch(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        /server-token|provider failure/u,
      );
      return true;
    },
  );
  assert.equal(fetchCalls, 0);
});

test("Google Directory transport sanitizes network failures that contain an access token", async () => {
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: { async getAccessToken() { return "server-token"; } },
    fetch: async () => {
      throw new Error("request failed with Authorization: Bearer server-token");
    },
  });

  await assert.rejects(
    transport.listUsers(),
    (error: unknown) => {
      assert.equal(
        error instanceof Error ? error.message : String(error),
        "Google Directory request failed",
      );
      assert.doesNotMatch(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        /server-token|Authorization/u,
      );
      return true;
    },
  );
});

test("Google Directory transport rejects redirected responses without leaking their destination or token", async () => {
  const redirected = new Response("{}", { status: 200 });
  Object.defineProperty(redirected, "redirected", { value: true });
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: { async getAccessToken() { return "server-token"; } },
    fetch: async () => redirected,
  });

  await assert.rejects(
    transport.getCustomer(),
    (error: unknown) => {
      const rendered = error instanceof Error ? (error.stack ?? error.message) : String(error);
      assert.equal(error instanceof Error ? error.message : String(error), "Google Directory request failed");
      assert.doesNotMatch(rendered, /server-token|unknown\.example|redirect/u);
      return true;
    },
  );
});

test("Google Directory transport aborts each timed-out request and masks bearer material", async () => {
  const observedSignals: AbortSignal[] = [];
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: { async getAccessToken() { return "server-token"; } },
    timeoutMs: 5,
    fetch: async (_input, init) => {
      if (init?.signal !== undefined && init.signal !== null) {
        observedSignals.push(init.signal);
      }
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("timed out with Bearer server-token"));
        }, { once: true });
      });
    },
  });

  await assert.rejects(
    transport.listGroups(),
    (error: unknown) => {
      const rendered = error instanceof Error ? (error.stack ?? error.message) : String(error);
      assert.equal(error instanceof Error ? error.message : String(error), "Google Directory request failed");
      assert.doesNotMatch(rendered, /server-token|Bearer|timed out/u);
      return true;
    },
  );
  assert.ok(observedSignals[0] instanceof AbortSignal);
  assert.equal(observedSignals[0]?.aborted, true);
});

test("Google Directory transport uses only read-only GET requests and keeps credentials out of URLs", async () => {
  const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
  let tokenCalls = 0;
  const transport = createGoogleDirectoryHttpTransport(lease, {
    accessTokenProvider: {
      async getAccessToken() {
        tokenCalls += 1;
        return "server-token";
      },
    },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, init });
      if (url.pathname.endsWith("/customers/my_customer")) {
        return new Response(JSON.stringify({
          id: "C012345",
          customerDomain: "tenant-a.example",
        }), { status: 200 });
      }
      if (url.pathname.endsWith("/orgunits")) {
        return new Response(JSON.stringify({ organizationUnits: [] }), { status: 200 });
      }
      if (url.pathname.endsWith("/users")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      if (url.pathname.endsWith("/members")) {
        return new Response(JSON.stringify({ members: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ groups: [] }), { status: 200 });
    },
  });

  await transport.getCustomer();
  await transport.listOrgUnits();
  await transport.listUsers();
  await transport.listGroups();
  await transport.listDirectMembers("tenant-a-group");

  assert.equal(requests.length, 5);
  assert.equal(tokenCalls, 1);
  for (const request of requests) {
    const headers = new Headers(request.init?.headers);
    assert.equal(request.url.origin, "https://admin.googleapis.com");
    assert.equal(request.init?.method, "GET");
    assert.equal(request.init?.body, undefined);
    assert.equal(request.init?.cache, "no-store");
    assert.equal(request.init?.redirect, "error");
    assert.equal(request.init?.credentials, "omit");
    assert.equal(request.init?.referrerPolicy, "no-referrer");
    assert.ok(request.init?.signal instanceof AbortSignal);
    assert.equal(headers.get("authorization"), "Bearer server-token");
    assert.equal(request.url.searchParams.has("access_token"), false);
    assert.equal(request.url.searchParams.has("refresh_token"), false);
  }
});
