import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMobileSessionService,
  MobileSessionServiceError,
  type MobileSessionRepository,
} from "./session-service.ts";
import { hashMobileProof } from "./protocol.ts";
import { clientNetworkHmac } from "../google/crypto.ts";

const proof = (byte: number): string =>
  Buffer.alloc(32, byte).toString("base64url");
const requestId = "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21";
const installation = proof(9);
const replayKey = Uint8Array.from(Buffer.alloc(32, 31));
const rateHmacKey = Uint8Array.from(Buffer.alloc(32, 30));

test("handoff exchange returns raw credentials only after atomic hash commit", async () => {
  let received: Parameters<MobileSessionRepository["exchangeHandoff"]>[0] | null =
    null;
  const repository: MobileSessionRepository = {
    async exchangeHandoff(input) {
      received = input;
      return {
        outcome: "ISSUED",
        sessionId: "7df575e1-c7c4-4774-b5d6-c69ef1bbcc40",
        accessExpiresAt: new Date("2026-08-27T14:15:00.000Z"),
        refreshExpiresAt: new Date("2026-09-26T14:00:00.000Z"),
        activeWorkspaceId: "44f864e4-bbd5-470f-8878-a68c270ce849",
        memberships: [
          {
            workspaceId: "44f864e4-bbd5-470f-8878-a68c270ce849",
            membershipId: "13e95eb2-2aee-4aab-8d52-d4b3b96c9e73",
            role: "MEMBER",
          },
        ],
      };
    },
    async refresh() { throw new Error("unused"); },
    async authenticate() { throw new Error("unused"); },
    async listWorkspaces() { throw new Error("unused"); },
    async switchWorkspace() { throw new Error("unused"); },
    async revoke() { throw new Error("unused"); },
  };
  const service = createMobileSessionService({ repository, replayKey, rateHmacKey });
  const result = await service.exchangeHandoff({
    handoffCode: proof(1),
    appExchangeVerifier: proof(2),
    installationSecret: installation,
    canonicalClientIp: "203.0.113.1",
    requestId,
  });

  assert.equal(result.outcome, "ISSUED");
  if (result.outcome !== "ISSUED" || received === null) return;
  const captured = received as Parameters<MobileSessionRepository["exchangeHandoff"]>[0];
  assert.match(result.accessToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(result.refreshToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.deepEqual(captured.handoffHash, hashMobileProof(proof(1)));
  assert.deepEqual(captured.appExchangeChallenge, hashMobileProof(proof(2)));
  assert.deepEqual(captured.installationBinding, hashMobileProof(installation));
  assert.deepEqual(captured.networkHmac,
    clientNetworkHmac("203.0.113.1", rateHmacKey));
  assert.deepEqual(captured.accessTokenHash, hashMobileProof(result.accessToken));
  assert.deepEqual(captured.refreshTokenHash, hashMobileProof(result.refreshToken));
});

test("handoff denial releases no candidate credential", async () => {
  const repository = repositoryWith({
    async exchangeHandoff() { return { outcome: "DENIED" } as const; },
  });
  const result = await createMobileSessionService({ repository, replayKey, rateHmacKey }).exchangeHandoff({
    handoffCode: proof(1),
    appExchangeVerifier: proof(2),
    installationSecret: installation,
    canonicalClientIp: "203.0.113.1",
    requestId,
  });
  assert.deepEqual(result, { outcome: "DENIED" });
  assert.equal(JSON.stringify(result).includes("token"), false);
});

test("authenticated denial handoff returns a safe category and no candidate credential", async () => {
  const repository = repositoryWith({
    async exchangeHandoff() {
      return { outcome: "ACCESS_DENIED", category: "USER_NOT_PROVISIONED" } as const;
    },
  });
  const result = await createMobileSessionService({ repository, replayKey, rateHmacKey }).exchangeHandoff({
    handoffCode: proof(1), appExchangeVerifier: proof(2), installationSecret: installation,
    canonicalClientIp: "203.0.113.1", requestId,
  });
  assert.deepEqual(result, { outcome: "ACCESS_DENIED", category: "USER_NOT_PROVISIONED" });
  assert.equal(JSON.stringify(result).includes("token"), false);
});

test("refresh rotates both credentials and passes a bounded idempotency key", async () => {
  let received: Parameters<MobileSessionRepository["refresh"]>[0] | null = null;
  const repository = repositoryWith({
    async refresh(input) {
      received = input;
      return {
        outcome: "ROTATED",
        accessExpiresAt: new Date("2026-08-27T14:15:00.000Z"),
        refreshExpiresAt: new Date("2026-09-26T14:00:00.000Z"),
      } as const;
    },
  });
  const result = await createMobileSessionService({ repository, replayKey, rateHmacKey }).refresh({
    refreshToken: proof(3),
    installationSecret: installation,
    idempotencyKey: "mobile-refresh-01",
    requestId,
  });
  assert.equal(result.outcome, "ROTATED");
  if (result.outcome !== "ROTATED" || received === null) return;
  const captured = received as Parameters<MobileSessionRepository["refresh"]>[0];
  assert.deepEqual(captured.predecessorRefreshHash, hashMobileProof(proof(3)));
  assert.deepEqual(captured.installationBinding, hashMobileProof(installation));
  assert.deepEqual(captured.accessTokenHash, hashMobileProof(result.accessToken));
  assert.deepEqual(captured.refreshTokenHash, hashMobileProof(result.refreshToken));
  assert.equal(captured.idempotencyKey, "mobile-refresh-01");

  await assert.rejects(
    createMobileSessionService({ repository, replayKey, rateHmacKey }).refresh({
      refreshToken: proof(3),
      installationSecret: installation,
      idempotencyKey: "contains spaces",
      requestId,
    }),
    { name: "MobileSessionServiceError" },
  );
});

test("Bearer authentication returns only a current server-rechecked context", async () => {
  const repository = repositoryWith({
    async authenticate(input) {
      assert.deepEqual(input.accessTokenHash, hashMobileProof(proof(7)));
      return {
        outcome: "AUTHORIZED",
        sessionId: "7df575e1-c7c4-4774-b5d6-c69ef1bbcc40",
        userId: "fc757b76-e1f8-4c95-a103-16262ff8d6aa",
        identityId: "dd2a619d-ac9c-41f7-b20a-a46e8304346e",
        workspaceId: "44f864e4-bbd5-470f-8878-a68c270ce849",
        membershipId: "13e95eb2-2aee-4aab-8d52-d4b3b96c9e73",
        role: "MEMBER",
      } as const;
    },
  });
  assert.deepEqual(
    await createMobileSessionService({ repository, replayKey, rateHmacKey }).authenticateBearer(
      `Bearer ${proof(7)}`,
    ),
    {
      sessionId: "7df575e1-c7c4-4774-b5d6-c69ef1bbcc40",
      userId: "fc757b76-e1f8-4c95-a103-16262ff8d6aa",
      identityId: "dd2a619d-ac9c-41f7-b20a-a46e8304346e",
      workspaceId: "44f864e4-bbd5-470f-8878-a68c270ce849",
      membershipId: "13e95eb2-2aee-4aab-8d52-d4b3b96c9e73",
      role: "MEMBER",
    },
  );
  await assert.rejects(
    createMobileSessionService({ repository, replayKey, rateHmacKey }).authenticateBearer(
      `Basic ${proof(7)}`,
    ),
    { name: "MobileSessionServiceError" },
  );
});

test("an exact refresh retry opens the database-returned capsule to the same successor", async () => {
  let capsule: Uint8Array | null = null;
  let firstAccess = "";
  let firstRefresh = "";
  let calls = 0;
  const repository = repositoryWith({
    async refresh(input) {
      calls += 1;
      if (calls === 1) {
        capsule = input.replayCapsule;
        return {
          outcome: "ROTATED",
          accessExpiresAt: new Date("2026-08-27T14:15:00.000Z"),
          refreshExpiresAt: new Date("2026-09-26T14:00:00.000Z"),
        } as const;
      }
      assert.ok(capsule !== null);
      return {
        outcome: "REPLAY",
        replayCapsule: capsule,
        accessExpiresAt: new Date("2026-08-27T14:15:00.000Z"),
        refreshExpiresAt: new Date("2026-09-26T14:00:00.000Z"),
      } as const;
    },
  });
  const service = createMobileSessionService({ repository, replayKey, rateHmacKey });
  const first = await service.refresh({
    refreshToken: proof(3), installationSecret: installation,
    idempotencyKey: "retry-01", requestId,
  });
  assert.equal(first.outcome, "ROTATED");
  if (first.outcome === "ROTATED") {
    firstAccess = first.accessToken;
    firstRefresh = first.refreshToken;
  }
  const retry = await service.refresh({
    refreshToken: proof(3), installationSecret: installation,
    idempotencyKey: "retry-01", requestId,
  });
  assert.equal(retry.outcome, "REPLAY");
  if (retry.outcome === "REPLAY") {
    assert.equal(retry.accessToken, firstAccess);
    assert.equal(retry.refreshToken, firstRefresh);
  }
});

test("workspace listing rejects a database denial and preserves an authorized membership list", async () => {
  const denied = createMobileSessionService({
    repository: repositoryWith({
      async listWorkspaces() { return { outcome: "DENIED" } as never; },
    }),
    replayKey,
    rateHmacKey,
  });
  await assert.rejects(
    denied.listWorkspaces(`Bearer ${proof(7)}`),
    { name: "MobileSessionServiceError" },
  );

  const memberships = [{
    workspaceId: "44f864e4-bbd5-470f-8878-a68c270ce849",
    membershipId: "13e95eb2-2aee-4aab-8d52-d4b3b96c9e73",
    role: "MEMBER" as const,
  }];
  const authorized = createMobileSessionService({
    repository: repositoryWith({
      async listWorkspaces() {
        return { outcome: "AUTHORIZED", memberships } as never;
      },
    }),
    replayKey,
    rateHmacKey,
  });
  assert.deepEqual(
    await authorized.listWorkspaces(`Bearer ${proof(7)}`),
    memberships,
  );
});

test("workspace listing preserves fixed mobile session-state codes", async () => {
  for (const outcome of ["ACCESS_TOKEN_EXPIRED", "SESSION_EXPIRED", "SESSION_REVOKED"] as const) {
    const service = createMobileSessionService({
      repository: repositoryWith({ async listWorkspaces() { return { outcome } as never; } }),
      replayKey,
      rateHmacKey,
    });
    await assert.rejects(
      service.listWorkspaces(`Bearer ${proof(7)}`),
      (error: unknown) => error instanceof MobileSessionServiceError && error.code === outcome,
    );
  }
});

test("Bearer authentication exposes only fixed mobile session-state codes", async () => {
  for (const outcome of ["ACCESS_TOKEN_EXPIRED", "SESSION_EXPIRED", "SESSION_REVOKED"] as const) {
    const service = createMobileSessionService({
      repository: repositoryWith({
        async authenticate() { return { outcome } as never; },
      }),
      replayKey,
      rateHmacKey,
    });
    await assert.rejects(
      service.authenticateBearer(`Bearer ${proof(7)}`),
      (error: unknown) => error instanceof Error &&
        error.name === "MobileSessionServiceError" &&
        "code" in error && error.code === outcome,
    );
  }
});

test("an exact workspace-switch retry opens the same database-returned successor", async () => {
  let capsule: Uint8Array | null = null;
  let firstAccess = "";
  let firstRefresh = "";
  let calls = 0;
  const repository = repositoryWith({
    async switchWorkspace(input) {
      calls += 1;
      if (calls === 1) {
        assert.equal(input.idempotencyKey, "switch-retry-01");
        capsule = input.replayCapsule;
        return { outcome: "ROTATED", accessExpiresAt: new Date("2026-08-27T14:15:00.000Z"),
          refreshExpiresAt: new Date("2026-09-26T14:00:00.000Z") } as never;
      }
      assert.ok(capsule !== null);
      return { outcome: "REPLAY", replayCapsule: capsule,
        accessExpiresAt: new Date("2026-08-27T14:15:00.000Z"),
        refreshExpiresAt: new Date("2026-09-26T14:00:00.000Z") } as never;
    },
  });
  const service = createMobileSessionService({ repository, replayKey, rateHmacKey });
  const input = { authorization: `Bearer ${proof(7)}`,
    targetWorkspaceId: "44f864e4-bbd5-470f-8878-a68c270ce849",
    installationSecret: installation, idempotencyKey: "switch-retry-01", requestId };
  const first = await service.switchWorkspace(input);
  assert.equal(first.outcome, "ROTATED");
  if (first.outcome === "ROTATED") {
    firstAccess = first.accessToken;
    firstRefresh = first.refreshToken;
  }
  const retry = await service.switchWorkspace(input);
  assert.equal(retry.outcome, "REPLAY");
  if (retry.outcome === "REPLAY") {
    assert.equal(retry.accessToken, firstAccess);
    assert.equal(retry.refreshToken, firstRefresh);
  }
});

function repositoryWith(
  overrides: Partial<MobileSessionRepository>,
): MobileSessionRepository {
  return {
    async exchangeHandoff() { throw new Error("unused"); },
    async refresh() { throw new Error("unused"); },
    async authenticate() { throw new Error("unused"); },
    async listWorkspaces() { throw new Error("unused"); },
    async switchWorkspace() { throw new Error("unused"); },
    async revoke() { throw new Error("unused"); },
    ...overrides,
  };
}
