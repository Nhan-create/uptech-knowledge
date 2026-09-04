import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as nodeRequest, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { NodeNextRequest } from "next/dist/server/base-http/node.js";
import { addRequestMeta } from "next/dist/server/request-meta.js";
import {
  NextRequestAdapter,
  signalFromNodeResponse,
} from "next/dist/server/web/spec-extension/adapters/next-request.js";

import { deriveCsrfCredential, issueOpaqueProof } from "../../auth/google/crypto.ts";
import {
  createAccessRequestPost,
  createBootstrapFinishPost,
  createBootstrapStatusGet,
  createBootstrapSyncRetryPost,
  createCurrentAccessRequestGet,
  createOnboardingLogoutPost,
  type AccessRequestDependencies,
  type BootstrapStatusDependencies,
} from "./http.ts";

const REQUEST_ID = "10000000-0000-4000-8000-000000000015";
const ACCESS_REQUEST_ID = "10000000-0000-4000-8000-000000000016";
const STATUS = issueOpaqueProof();
const PEPPER = new Uint8Array(32).fill(13);
const AUTHORIZATION = new URL("https://accounts.google.com/o/oauth2/v2/auth?client_id=adapter-regression");

type RouteHandler = (request: Request) => Promise<Response>;

function sendWebResponse(nodeResponse: ServerResponse, response: Response): Promise<void> {
  nodeResponse.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") nodeResponse.setHeader(name, value);
  }
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length > 0) nodeResponse.setHeader("set-cookie", setCookies);
  return response.arrayBuffer().then((body) => {
    nodeResponse.end(Buffer.from(body));
  });
}

test("Next 16 Node adapter admits framed-empty Task 6 POSTs and rejects body framing before mutation", async (t) => {
  let appOrigin = "";
  const calls: string[] = [];
  const adaptedBodies: boolean[] = [];
  const statusDependencies: BootstrapStatusDependencies = {
    requestId: () => REQUEST_ID,
    canonicalClientIp: () => "203.0.113.15",
    loadRuntime: () => ({
      appOrigin,
      sessionPepper: PEPPER,
      repository: {
        async readStatus() { calls.push("readStatus"); return { outcome: "READY" }; },
        async retrySync() { calls.push("retrySync"); return { outcome: "REQUEUED" }; },
        async finish() { calls.push("finish"); return { outcome: "FINISHED" }; },
        async revokeCapability() { calls.push("revokeCapability"); return { outcome: "REVOKED" }; },
      },
      normalLoginService: {
        async initiate() {
          calls.push("initiate");
          return {
            outcome: "REDIRECT" as const,
            authorizationUrl: AUTHORIZATION,
            loginCookie: "1.AAAAAAAAAAAAAAAA.ciphertext.BBBBBBBBBBBBBBBBBB",
            expiresAt: new Date(Date.now() + 60_000),
          };
        },
      },
    }),
  };
  const accessDependencies: AccessRequestDependencies = {
    requestId: () => REQUEST_ID,
    loadRuntime: () => ({
      appOrigin,
      sessionPepper: PEPPER,
      repository: {
        async submitAccessRequest() {
          calls.push("submitAccessRequest");
          return { outcome: "PENDING", requestId: ACCESS_REQUEST_ID, status: "PENDING" };
        },
        async readAccessRequest() {
          calls.push("readAccessRequest");
          return { outcome: "FOUND", requestId: ACCESS_REQUEST_ID, status: "PENDING" };
        },
      },
    }),
  };
  const routes = new Map<string, RouteHandler>([
    ["/api/v1/onboarding/google-workspace/status", createBootstrapStatusGet(statusDependencies)],
    ["/api/v1/onboarding/google-workspace/sync-retry", createBootstrapSyncRetryPost(statusDependencies)],
    ["/api/v1/onboarding/google-workspace/finish", createBootstrapFinishPost(statusDependencies)],
    ["/api/v1/onboarding/logout", createOnboardingLogoutPost(statusDependencies)],
    ["/api/v1/onboarding/access-requests", createAccessRequestPost(accessDependencies)],
    ["/api/v1/onboarding/access-requests/current", createCurrentAccessRequestGet(accessDependencies)],
  ]);

  const server = createServer(async (incoming, outgoing) => {
    try {
      const rawTarget = incoming.url ?? "/";
      addRequestMeta(incoming, "initURL", new URL(rawTarget, appOrigin).href);
      const request = NextRequestAdapter.fromNodeNextRequest(
        new NodeNextRequest(incoming),
        signalFromNodeResponse(outgoing),
      );
      adaptedBodies.push(request.body !== null);
      const handler = routes.get(new URL(request.url).pathname);
      await sendWebResponse(outgoing, handler === undefined
        ? new Response(null, { status: 404 })
        : await handler(request));
    } catch {
      outgoing.statusCode = 500;
      outgoing.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address() as AddressInfo;
  appOrigin = `http://localhost:${address.port}`;

  async function wireRequest(path: string, input: {
    readonly method?: "GET" | "POST";
    readonly contentLength?: string;
    readonly transferEncoding?: string;
    readonly chunks?: readonly string[];
  } = {}): Promise<number> {
    const method = input.method ?? "POST";
    const headers: Record<string, string> = {
      cookie: `__Host-uptech_onboarding=${STATUS}`,
      origin: appOrigin,
      "sec-fetch-site": "same-origin",
      "x-csrf-token": deriveCsrfCredential(STATUS, PEPPER),
      connection: "close",
      host: `localhost:${address.port}`,
    };
    if (input.contentLength !== undefined) headers["content-length"] = input.contentLength;
    if (input.transferEncoding !== undefined) headers["transfer-encoding"] = input.transferEncoding;
    return new Promise((resolve, reject) => {
      const request = nodeRequest({ hostname: "127.0.0.1", port: address.port, path, method, headers }, (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      });
      request.once("error", reject);
      for (const chunk of input.chunks ?? []) request.write(chunk);
      request.end();
    });
  }

  for (const [path, expectedStatus, expectedCalls] of [
    ["/api/v1/onboarding/google-workspace/sync-retry", 200, ["retrySync"]],
    ["/api/v1/onboarding/google-workspace/finish", 303, ["finish", "initiate"]],
    ["/api/v1/onboarding/logout", 303, ["revokeCapability"]],
    ["/api/v1/onboarding/access-requests", 200, ["submitAccessRequest"]],
  ] as const) {
    calls.splice(0);
    assert.equal(await wireRequest(path, { contentLength: "0" }), expectedStatus, path);
    assert.equal(adaptedBodies.at(-1), true, `${path} did not exercise the Next Node body adapter`);
    assert.deepEqual(calls, expectedCalls, path);

    calls.splice(0);
    assert.equal(await wireRequest(path, { contentLength: "2", chunks: ["{}"] }), 400, path);
    assert.deepEqual(calls, [], `${path} fixed-length body reached mutation`);

    calls.splice(0);
    assert.equal(await wireRequest(path, { transferEncoding: "chunked", chunks: ["{}"] }), 400, path);
    assert.deepEqual(calls, [], `${path} chunked body reached mutation`);
  }

  for (const path of [
    "/api/v1/onboarding/google-workspace/status",
    "/api/v1/onboarding/access-requests/current",
  ]) {
    calls.splice(0);
    assert.equal(await wireRequest(`${path}?workspace_id=caller-controlled`, { method: "GET" }), 400);
    assert.deepEqual(calls, [], `${path} query reached repository`);

    calls.splice(0);
    assert.equal(await wireRequest(path, { method: "GET", contentLength: "2", chunks: ["{}"] }), 400);
    assert.deepEqual(calls, [], `${path} GET body reached repository through the adapter`);
  }

  calls.splice(0);
  assert.equal(await wireRequest("/api/v1/onboarding/google-workspace/sync-retry", { method: "GET" }), 400);
  assert.deepEqual(calls, [], "wrong method reached mutation");
});
