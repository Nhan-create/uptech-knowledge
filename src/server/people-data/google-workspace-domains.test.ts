import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeVerifiedGoogleWorkspaceDomains,
} from "./google-workspace-domains.ts";

const customerDomain = "tenant-a.example";

test("normalizes verified primary, secondary, and alias domains deterministically", () => {
  const result = normalizeVerifiedGoogleWorkspaceDomains({
    customerDomain,
    domains: [
      { domainName: "Tenant-B.Example", verified: true, isPrimary: false },
      { domainName: "Tenant-A.Example", verified: true, isPrimary: true, domainAliases: [{ domainAliasName: "UNKNOWN.EXAMPLE", verified: true }] },
    ],
  });

  assert.deepEqual(result, [
    { normalizedDomain: "tenant-a.example", kind: "PRIMARY", providerParentDomain: null, verified: true },
    { normalizedDomain: "tenant-b.example", kind: "SECONDARY", providerParentDomain: null, verified: true },
    { normalizedDomain: "unknown.example", kind: "ALIAS", providerParentDomain: "tenant-a.example", verified: true },
  ]);
});

test("rejects oversized raw domain evidence before ignored provider metadata is normalized away", () => {
  assert.throws(
    () => normalizeVerifiedGoogleWorkspaceDomains({
      customerDomain,
      domains: [
        {
          domainName: "Tenant-A.Example",
          verified: true,
          isPrimary: true,
          domainAliases: [{ domainAliasName: "UNKNOWN.EXAMPLE", verified: true }],
          ignoredProviderMetadata: "x".repeat(256 * 1_024),
        },
        { domainName: "Tenant-B.Example", verified: true, isPrimary: false },
      ],
    }),
    (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.equal(error.message, "Google Workspace domain evidence is invalid");
      return true;
    },
  );
});

test("rejects unserializable raw domain evidence with one closed generic error", () => {
  const cyclic: Record<string, unknown> = {
    domainName: customerDomain,
    verified: true,
    isPrimary: true,
  };
  cyclic.ignoredProviderMetadata = cyclic;
  const hostileGetter = {
    domainName: customerDomain,
    verified: true,
    isPrimary: true,
    get ignoredProviderMetadata(): never {
      throw new Error("tenant-b.example secret provider contents");
    },
  };

  for (const item of [
    cyclic,
    { domainName: customerDomain, verified: true, isPrimary: true, ignoredProviderMetadata: BigInt(1) },
    hostileGetter,
  ]) {
    assert.throws(
      () => normalizeVerifiedGoogleWorkspaceDomains({ customerDomain, domains: [item] }),
      (error: unknown) => {
        assert.ok(error instanceof TypeError);
        assert.equal(error.message, "Google Workspace domain evidence is invalid");
        assert.doesNotMatch(error.message, /tenant-b\.example|secret|BigInt|circular/u);
        return true;
      },
    );
  }
});

test("omits unverified aliases and aliases whose parent Domain resource is unverified", () => {
  const result = normalizeVerifiedGoogleWorkspaceDomains({
    customerDomain,
    domains: [
      {
        domainName: customerDomain,
        verified: true,
        isPrimary: true,
        domainAliases: [{ domainAliasName: "unknown.example", verified: false }],
      },
      {
        domainName: "tenant-b.example",
        verified: false,
        isPrimary: false,
        domainAliases: [{ domainAliasName: "unknown.example", verified: true }],
      },
    ],
  });

  assert.deepEqual(result, [
    { normalizedDomain: "tenant-a.example", kind: "PRIMARY", providerParentDomain: null, verified: true },
  ]);
});

test("rejects non-canonical or unsafe Google domain evidence", () => {
  const valid = { domainName: customerDomain, verified: true, isPrimary: true };
  const invalidInputs = [
    { customerDomain, domains: [{ ...valid, verified: false }] },
    { customerDomain, domains: [valid, { domainName: "tenant-b.example", verified: true, isPrimary: true }] },
    { customerDomain: "tenant-b.example", domains: [valid] },
    { customerDomain, domains: [{ ...valid, verified: false, domainAliases: [{ domainName: "unknown.example" }] }] },
    { customerDomain, domains: [valid, { domainName: customerDomain, verified: true, isPrimary: false }] },
    { customerDomain, domains: Array.from({ length: 1_001 }, (_, index) => ({ ...valid, isPrimary: index === 0 })) },
    { customerDomain, domains: [{ domainName: customerDomain.padStart(254, "a"), verified: true, isPrimary: true }] },
    { customerDomain, domains: [
      valid,
      ...Array.from({ length: 999 }, () => ({ domainName: "unknown.example", verified: true, isPrimary: false })),
    ] },
  ];
  for (const input of invalidInputs) {
    assert.throws(() => normalizeVerifiedGoogleWorkspaceDomains(input));
  }
});
