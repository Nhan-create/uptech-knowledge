import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeVerifiedGoogleWorkspaceDomains,
} from "./google-workspace-domains.ts";

const customerDomain = "company-a.com";

test("normalizes verified primary, secondary, and alias domains deterministically", () => {
  const result = normalizeVerifiedGoogleWorkspaceDomains({
    customerDomain,
    domains: [
      { domainName: "Company-A.VN", verified: true, isPrimary: false },
      { domainName: "company-a.com", verified: true, isPrimary: true, domainAliases: [{ domainName: "STAFF.company-a.com" }] },
    ],
  });

  assert.deepEqual(result, [
    { normalizedDomain: "company-a.com", kind: "PRIMARY", providerParentDomain: null, verified: true },
    { normalizedDomain: "company-a.vn", kind: "SECONDARY", providerParentDomain: null, verified: true },
    { normalizedDomain: "staff.company-a.com", kind: "ALIAS", providerParentDomain: "company-a.com", verified: true },
  ]);
});

test("rejects non-canonical or unsafe Google domain evidence", () => {
  const valid = { domainName: customerDomain, verified: true, isPrimary: true };
  const invalidInputs = [
    { customerDomain, domains: [{ ...valid, verified: false }] },
    { customerDomain, domains: [valid, { domainName: "company-a.vn", verified: true, isPrimary: true }] },
    { customerDomain: "other.example", domains: [valid] },
    { customerDomain, domains: [{ ...valid, verified: false, domainAliases: [{ domainName: "staff.company-a.com" }] }] },
    { customerDomain, domains: [valid, { domainName: customerDomain, verified: true, isPrimary: false }] },
    { customerDomain, domains: Array.from({ length: 1_001 }, (_, index) => ({ domainName: `domain-${index}.example`, verified: true, isPrimary: index === 0 })) },
    { customerDomain, domains: [{ domainName: `${"a".repeat(250)}.com`, verified: true, isPrimary: true }] },
    { customerDomain, domains: [
      valid,
      ...Array.from({ length: 999 }, (_, index) => ({ domainName: `a${index}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.example`, verified: true, isPrimary: false })),
    ] },
  ];
  for (const input of invalidInputs) {
    assert.throws(() => normalizeVerifiedGoogleWorkspaceDomains(input));
  }
});
