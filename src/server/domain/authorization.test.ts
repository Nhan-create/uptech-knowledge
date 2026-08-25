import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOW,
  DENY,
  can,
  type AuthorizationPolicy,
} from "./authorization.ts";

interface Context {
  readonly active: boolean;
}

interface ResourceLocator {
  readonly document_id: string;
}

test("can() defaults to DENY when no exact policy exists", () => {
  assert.deepEqual(
    can(
      { active: true },
      "document.read",
      { document_id: "doc-1" },
    ),
    { decision: DENY, evaluated_version_ids: [] },
  );
  assert.deepEqual(
    can({ active: true }, "", { document_id: "doc-1" }),
    { decision: DENY, evaluated_version_ids: [] },
  );
  assert.deepEqual(
    can(
      { active: true },
      null as unknown as string,
      { document_id: "doc-1" },
    ),
    { decision: DENY, evaluated_version_ids: [] },
  );
});

test("can() allows only an explicit ALLOW decision for the exact action", () => {
  const policies = new Map<
    string,
    AuthorizationPolicy<Context, ResourceLocator>
  >([
    [
      "document.read",
      (context, resource) => ({
        decision:
          context.active && resource.document_id === "doc-1" ? ALLOW : DENY,
        evaluated_version_ids: ["membership-v7", "document-acl-v9"],
      }),
    ],
  ]);

  assert.deepEqual(
    can(
      { active: true },
      "document.read",
      { document_id: "doc-1" },
      policies,
    ),
    {
      decision: ALLOW,
      evaluated_version_ids: ["membership-v7", "document-acl-v9"],
    },
  );
  assert.equal(
    can(
      { active: false },
      "document.read",
      { document_id: "doc-1" },
      policies,
    ).decision,
    DENY,
  );
  assert.equal(
    can(
      { active: true },
      "document.write",
      { document_id: "doc-1" },
      policies,
    ).decision,
    DENY,
  );
});

test("can() fails closed when a policy throws", () => {
  const policies = new Map<
    string,
    AuthorizationPolicy<Context, ResourceLocator>
  >([
    [
      "document.read",
      () => {
        throw new Error("policy state unavailable");
      },
    ],
  ]);

  assert.deepEqual(
    can(
      { active: true },
      "document.read",
      { document_id: "doc-1" },
      policies,
    ),
    { decision: DENY, evaluated_version_ids: [] },
  );
});

test("can() fails closed on a malformed policy result", () => {
  const policies = new Map([
    [
      "document.read",
      () => ({
        decision: "ALLOW",
        evaluated_version_ids: [""],
      }),
    ],
  ]) as unknown as ReadonlyMap<
    string,
    AuthorizationPolicy<Context, ResourceLocator>
  >;

  assert.deepEqual(
    can(
      { active: true },
      "document.read",
      { document_id: "doc-1" },
      policies,
    ),
    { decision: DENY, evaluated_version_ids: [] },
  );
});
