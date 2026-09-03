import assert from "node:assert/strict";
import { test } from "node:test";

import { createMobileSessionRepository } from "./repository.ts";

const bytes = (n: number) => Uint8Array.from(Buffer.alloc(32, n));

test("mobile repository maps a fixed exchange result without accepting authority input", async () => {
  const valuesSeen: unknown[][] = [];
  const repository = createMobileSessionRepository({
    async query(_text: string, values?: unknown[]) {
      valuesSeen.push(values ?? []);
      return {
        rows: [{
          outcome: "ISSUED",
          session_id: "7df575e1-c7c4-4774-b5d6-c69ef1bbcc40",
          access_expires_at: new Date("2026-08-27T14:15:00.000Z"),
          refresh_expires_at: new Date("2026-09-26T14:00:00.000Z"),
          active_workspace_id: "44f864e4-bbd5-470f-8878-a68c270ce849",
          memberships: [{
            workspace_id: "44f864e4-bbd5-470f-8878-a68c270ce849",
            membership_id: "13e95eb2-2aee-4aab-8d52-d4b3b96c9e73",
            role: "MEMBER",
          }],
        }],
      } as never;
    },
  } as never);
  const result = await repository.exchangeHandoff({
    networkHmac: bytes(0), handoffHash: bytes(1), appExchangeChallenge: bytes(2),
    installationBinding: bytes(3), accessTokenHash: bytes(4),
    refreshTokenHash: bytes(5),
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  });
  assert.equal(result.outcome, "ISSUED");
  assert.equal(valuesSeen[0].length, 7);
  assert.equal(valuesSeen[0].some((value) => value === "OWNER"), false);
});

test("mobile repository preserves only an authenticated one-time denial category", async () => {
  const repository = createMobileSessionRepository({
    async query() {
      return {
        rows: [{
          outcome: "ACCESS_DENIED",
          session_id: null,
          access_expires_at: null,
          refresh_expires_at: null,
          active_workspace_id: null,
          memberships: null,
          denial_category: "UNKNOWN_WORKSPACE",
        }],
      } as never;
    },
  } as never);

  assert.deepEqual(await repository.exchangeHandoff({
    networkHmac: bytes(0), handoffHash: bytes(1), appExchangeChallenge: bytes(2),
    installationBinding: bytes(3), accessTokenHash: bytes(4), refreshTokenHash: bytes(5),
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  }), { outcome: "ACCESS_DENIED", category: "UNKNOWN_WORKSPACE" });
});

test("mobile repository rejects denial output that carries session authority", async () => {
  const repository = createMobileSessionRepository({
    async query() {
      return {
        rows: [{
          outcome: "ACCESS_DENIED",
          session_id: "7df575e1-c7c4-4774-b5d6-c69ef1bbcc40",
          access_expires_at: null,
          refresh_expires_at: null,
          active_workspace_id: null,
          memberships: null,
          denial_category: "UNKNOWN_WORKSPACE",
        }],
      } as never;
    },
  } as never);

  await assert.rejects(repository.exchangeHandoff({
    networkHmac: bytes(0), handoffHash: bytes(1), appExchangeChallenge: bytes(2),
    installationBinding: bytes(3), accessTokenHash: bytes(4), refreshTokenHash: bytes(5),
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  }), /Denial handoff returned session authority/);
});

test("mobile repository rejects an arbitrary authenticated denial category", async () => {
  const repository = createMobileSessionRepository({
    async query() {
      return {
        rows: [{
          outcome: "ACCESS_DENIED",
          session_id: null,
          access_expires_at: null,
          refresh_expires_at: null,
          active_workspace_id: null,
          memberships: null,
          denial_category: "OWNER",
        }],
      } as never;
    },
  } as never);

  await assert.rejects(repository.exchangeHandoff({
    networkHmac: bytes(0), handoffHash: bytes(1), appExchangeChallenge: bytes(2),
    installationBinding: bytes(3), accessTokenHash: bytes(4), refreshTokenHash: bytes(5),
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  }), /Invalid mobile denial category/);
});

test("mobile repository preserves only an authenticated refresh replay capsule", async () => {
  const capsule = Uint8Array.from(Buffer.alloc(115, 7));
  const repository = createMobileSessionRepository({
    async query() {
      return { rows: [{
        outcome: "REPLAY",
        replay_capsule: Buffer.from(capsule),
        access_expires_at: new Date("2026-08-27T14:15:00.000Z"),
        refresh_expires_at: new Date("2026-09-26T14:00:00.000Z"),
      }] } as never;
    },
  } as never);
  const result = await repository.refresh({
    predecessorRefreshHash: bytes(1), installationBinding: bytes(2),
    accessTokenHash: bytes(3), refreshTokenHash: bytes(4),
    replayCapsule: capsule, idempotencyKey: "retry-1",
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  });
  assert.equal(result.outcome, "REPLAY");
  if (result.outcome === "REPLAY") assert.deepEqual(result.replayCapsule, capsule);
});

test("mobile repository rejects malformed routine output fail-closed", async () => {
  const repository = createMobileSessionRepository({
    async query() { return { rows: [{ outcome: "ISSUED" }] } as never; },
  } as never);
  await assert.rejects(
    repository.exchangeHandoff({
      networkHmac: bytes(0), handoffHash: bytes(1), appExchangeChallenge: bytes(2),
      installationBinding: bytes(3), accessTokenHash: bytes(4),
      refreshTokenHash: bytes(5),
      requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
    }),
    { name: "MobileSessionRepositoryError" },
  );
});

test("mobile repository preserves workspace-list denial instead of parsing it as an empty list", async () => {
  const repository = createMobileSessionRepository({
    async query() { return { rows: [{ outcome: "DENIED", memberships: null }] } as never; },
  } as never);

  assert.deepEqual(
    await repository.listWorkspaces({ accessTokenHash: bytes(9) }),
    { outcome: "DENIED" },
  );
});

test("mobile repository preserves fixed workspace-list session outcomes", async () => {
  for (const outcome of ["ACCESS_TOKEN_EXPIRED", "SESSION_EXPIRED", "SESSION_REVOKED"] as const) {
    const repository = createMobileSessionRepository({
      async query() { return { rows: [{ outcome, memberships: null }] } as never; },
    } as never);
    assert.deepEqual(
      await repository.listWorkspaces({ accessTokenHash: bytes(9) }),
      { outcome },
    );
  }
});

test("mobile repository returns memberships only with an authorized workspace-list result", async () => {
  const repository = createMobileSessionRepository({
    async query() {
      return { rows: [{
        outcome: "AUTHORIZED",
        memberships: [{
          workspace_id: "44f864e4-bbd5-470f-8878-a68c270ce849",
          membership_id: "13e95eb2-2aee-4aab-8d52-d4b3b96c9e73",
          role: "MEMBER",
        }],
      }] } as never;
    },
  } as never);

  assert.deepEqual(
    await repository.listWorkspaces({ accessTokenHash: bytes(9) }),
    {
      outcome: "AUTHORIZED",
      memberships: [{
        workspaceId: "44f864e4-bbd5-470f-8878-a68c270ce849",
        membershipId: "13e95eb2-2aee-4aab-8d52-d4b3b96c9e73",
        role: "MEMBER",
      }],
    },
  );
});

test("mobile repository preserves fixed terminal and refreshable access outcomes", async () => {
  for (const outcome of ["ACCESS_TOKEN_EXPIRED", "SESSION_EXPIRED", "SESSION_REVOKED"] as const) {
    const repository = createMobileSessionRepository({
      async query() { return { rows: [{ outcome }] } as never; },
    } as never);
    assert.deepEqual(
      await repository.authenticate({ accessTokenHash: bytes(8) }),
      { outcome },
    );
  }
});

test("mobile repository preserves an authenticated workspace-switch replay capsule", async () => {
  const capsule = Uint8Array.from(Buffer.alloc(115, 6));
  const repository = createMobileSessionRepository({
    async query() { return { rows: [{ outcome: "REPLAY", replay_capsule: Buffer.from(capsule),
      access_expires_at: new Date("2026-08-27T14:15:00.000Z"),
      refresh_expires_at: new Date("2026-09-26T14:00:00.000Z") }] } as never; },
  } as never);
  const result = await repository.switchWorkspace({
    accessTokenHash: bytes(1), targetWorkspaceId: "44f864e4-bbd5-470f-8878-a68c270ce849",
    installationBinding: bytes(2), accessTokenHashCandidate: bytes(3),
    refreshTokenHashCandidate: bytes(4), replayCapsule: capsule,
    idempotencyKey: "switch-retry-01", requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  });
  assert.equal(result.outcome, "REPLAY");
  if (result.outcome === "REPLAY") assert.deepEqual(result.replayCapsule, capsule);
});

test("mobile repository preserves terminal refresh expiry and revocation outcomes", async () => {
  for (const outcome of ["SESSION_EXPIRED", "SESSION_REVOKED"] as const) {
    const repository = createMobileSessionRepository({
      async query() { return { rows: [{ outcome }] } as never; },
    } as never);
    assert.deepEqual(await repository.refresh({
      predecessorRefreshHash: bytes(1), installationBinding: bytes(2),
      accessTokenHash: bytes(3), refreshTokenHash: bytes(4),
      replayCapsule: Uint8Array.from(Buffer.alloc(115, 5)), idempotencyKey: "retry-1",
      requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
    }), { outcome });
  }
});

test("mobile repository routes every authority-bearing operation through Directory-gated routines", async () => {
  const sqlSeen: string[] = [];
  const repository = createMobileSessionRepository({
    async query(text: string) {
      sqlSeen.push(text);
      if (text.includes("exchange_mobile_handoff")) {
        return { rows: [{ outcome: "DENIED" }] } as never;
      }
      if (text.includes("rotate_mobile_refresh")) {
        return { rows: [{ outcome: "DENIED" }] } as never;
      }
      if (text.includes("authenticate_mobile_access")) {
        return { rows: [{ outcome: "DENIED" }] } as never;
      }
      if (text.includes("list_mobile_workspaces")) {
        return { rows: [{ outcome: "DENIED", memberships: null }] } as never;
      }
      return { rows: [{ outcome: "DENIED" }] } as never;
    },
  } as never);

  await repository.exchangeHandoff({
    networkHmac: bytes(0), handoffHash: bytes(1), appExchangeChallenge: bytes(2),
    installationBinding: bytes(3), accessTokenHash: bytes(4), refreshTokenHash: bytes(5),
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  });
  await repository.refresh({
    predecessorRefreshHash: bytes(1), installationBinding: bytes(2),
    accessTokenHash: bytes(3), refreshTokenHash: bytes(4),
    replayCapsule: Uint8Array.from(Buffer.alloc(115, 5)), idempotencyKey: "retry-1",
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  });
  await repository.authenticate({ accessTokenHash: bytes(8) });
  await repository.listWorkspaces({ accessTokenHash: bytes(9) });
  await repository.switchWorkspace({
    accessTokenHash: bytes(1), targetWorkspaceId: "44f864e4-bbd5-470f-8878-a68c270ce849",
    installationBinding: bytes(2), accessTokenHashCandidate: bytes(3),
    refreshTokenHashCandidate: bytes(4), replayCapsule: Uint8Array.from(Buffer.alloc(115, 5)),
    idempotencyKey: "switch-retry-01", requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  });

  assert.equal(sqlSeen[0].includes("exchange_mobile_handoff_directory_v1"), true);
  assert.equal(sqlSeen[1].includes("rotate_mobile_refresh_directory_v1"), true);
  assert.equal(sqlSeen[2].includes("authenticate_mobile_access_directory_v1"), true);
  assert.equal(sqlSeen[3].includes("list_mobile_workspaces_directory_v1"), true);
  assert.equal(sqlSeen[4].includes("switch_mobile_workspace_directory_v1"), true);
});
