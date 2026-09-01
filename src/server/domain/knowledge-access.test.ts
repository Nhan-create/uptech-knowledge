import assert from "node:assert/strict";
import test from "node:test";

import {
  TEST_DOCUMENTS,
  TEST_PERSONAS,
} from "../../../test/fixtures/multitenant-department-personas.ts";
import {
  authorizeKnowledgeAccess,
  retrieveAuthorizedKnowledgeResource,
} from "./knowledge-access.ts";

test("Owner/Admin GET is allowed for explicitly granted Sales and HR spaces", () => {
  assert.equal(
    authorizeKnowledgeAccess(
      TEST_PERSONAS.admin.subject,
      "document.read",
      TEST_DOCUMENTS.sales,
    ).decision,
    "ALLOW",
  );
  assert.equal(
    authorizeKnowledgeAccess(
      TEST_PERSONAS.admin.subject,
      "document.read",
      TEST_DOCUMENTS.hr,
    ).decision,
    "ALLOW",
  );
});

test("Sales GET allows Sales while denying HR", () => {
  assert.equal(
    authorizeKnowledgeAccess(
      TEST_PERSONAS.sales.subject,
      "document.read",
      TEST_DOCUMENTS.sales,
    ).decision,
    "ALLOW",
  );
  assert.equal(
    authorizeKnowledgeAccess(
      TEST_PERSONAS.sales.subject,
      "document.read",
      TEST_DOCUMENTS.hr,
    ).decision,
    "DENY",
  );
});

test("tenant-a Sales is denied the explicit tenant-b Sales resource", () => {
  const tenantA = TEST_PERSONAS.sales;
  const tenantB = TEST_PERSONAS.tenantBSales;
  const tenantBResource = TEST_DOCUMENTS.tenantBSales;

  assert.equal(tenantA.subject.workspaceId, "tenant-a");
  assert.equal(tenantA.email, "sales-user@tenant-a.example");
  assert.equal(tenantB.subject.workspaceId, "tenant-b");
  assert.equal(tenantB.email, "sales-user@tenant-b.example");
  assert.equal(tenantBResource.workspaceId, "tenant-b");
  assert.equal(
    authorizeKnowledgeAccess(
      tenantA.subject,
      "document.read",
      tenantBResource,
    ).decision,
    "DENY",
  );
});

test("protected retrieval runs only after an ALLOW decision", async () => {
  let retrievalCalls = 0;
  const denied = await retrieveAuthorizedKnowledgeResource(
    TEST_PERSONAS.sales.subject,
    "document.read",
    TEST_DOCUMENTS.hr,
    async () => {
      retrievalCalls += 1;
      return "HR data";
    },
  );
  assert.equal(denied, null);
  assert.equal(retrievalCalls, 0, "denied retrieval must not invoke its adapter");

  const allowed = await retrieveAuthorizedKnowledgeResource(
    TEST_PERSONAS.sales.subject,
    "document.read",
    TEST_DOCUMENTS.sales,
    async () => {
      retrievalCalls += 1;
      return "Sales data";
    },
  );
  assert.equal(allowed, "Sales data");
  assert.equal(retrievalCalls, 1);
});

test("HR GET allows HR while denying Sales", () => {
  assert.equal(
    authorizeKnowledgeAccess(
      TEST_PERSONAS.hr.subject,
      "document.read",
      TEST_DOCUMENTS.hr,
    ).decision,
    "ALLOW",
  );
  assert.equal(
    authorizeKnowledgeAccess(
      TEST_PERSONAS.hr.subject,
      "document.read",
      TEST_DOCUMENTS.sales,
    ).decision,
    "DENY",
  );
});

test("workspace role never bypasses an explicit Knowledge Space grant", () => {
  const ownerWithoutGrants = {
    ...TEST_PERSONAS.admin.subject,
    spaceGrants: [],
  };

  assert.equal(
    authorizeKnowledgeAccess(
      ownerWithoutGrants,
      "document.read",
      TEST_DOCUMENTS.sales,
    ).decision,
    "DENY",
  );
});

test("inactive or cross-workspace state fails closed", () => {
  for (const subject of [
    { ...TEST_PERSONAS.sales.subject, sessionActive: false },
    { ...TEST_PERSONAS.sales.subject, workspaceStatus: "SUSPENDED" },
    { ...TEST_PERSONAS.sales.subject, membershipStatus: "SUSPENDED" },
  ]) {
    assert.equal(
      authorizeKnowledgeAccess(subject, "document.read", TEST_DOCUMENTS.sales)
        .decision,
      "DENY",
    );
  }

  assert.equal(
    authorizeKnowledgeAccess(
      TEST_PERSONAS.sales.subject,
      "document.read",
      TEST_DOCUMENTS.tenantBSales,
    ).decision,
    "DENY",
  );
});

test("stale, restricted, or unavailable resources fail closed", () => {
  const subject = TEST_PERSONAS.sales.subject;
  const resource = TEST_DOCUMENTS.sales;

  for (const deniedResource of [
    { ...resource, status: "ACL_STALE" },
    { ...resource, sourceGate: "DENY" as const },
    { ...resource, restrictionGate: "DENY" as const },
    { ...resource, securityVersionsCurrent: false },
  ]) {
    assert.equal(
      authorizeKnowledgeAccess(subject, "document.read", deniedResource)
        .decision,
      "DENY",
    );
  }
});

test("grants are tenant-bound even when membership and space IDs collide", () => {
  const foreignGrantSubject = {
    ...TEST_PERSONAS.sales.subject,
    spaceGrants: TEST_PERSONAS.sales.subject.spaceGrants.map((grant) => ({
      ...grant,
      workspaceId: "workspace-foreign",
    })),
  };

  assert.equal(
    authorizeKnowledgeAccess(
      foreignGrantSubject,
      "document.read",
      TEST_DOCUMENTS.sales,
    ).decision,
    "DENY",
  );
});

test("every named subject and resource version is required and nonempty", () => {
  for (const subject of [
    { ...TEST_PERSONAS.sales.subject, workspaceVersionId: "" },
    { ...TEST_PERSONAS.sales.subject, membershipVersionId: "" },
  ]) {
    assert.equal(
      authorizeKnowledgeAccess(subject, "document.read", TEST_DOCUMENTS.sales)
        .decision,
      "DENY",
    );
  }

  for (const resource of [
    { ...TEST_DOCUMENTS.sales, spaceVersionId: "" },
    { ...TEST_DOCUMENTS.sales, documentVersionId: "" },
    { ...TEST_DOCUMENTS.sales, sourceVersionId: "" },
    { ...TEST_DOCUMENTS.sales, sourceAclVersionId: "" },
    { ...TEST_DOCUMENTS.sales, restrictionVersionId: "" },
  ]) {
    assert.equal(
      authorizeKnowledgeAccess(
        TEST_PERSONAS.sales.subject,
        "document.read",
        resource,
      ).decision,
      "DENY",
    );
  }

  const partialResource = { ...TEST_DOCUMENTS.sales };
  delete (partialResource as { sourceAclVersionId?: string })
    .sourceAclVersionId;
  assert.equal(
    authorizeKnowledgeAccess(
      TEST_PERSONAS.sales.subject,
      "document.read",
      partialResource as typeof TEST_DOCUMENTS.sales,
    ).decision,
    "DENY",
  );
});

test("only a current direct same-tenant group edge can satisfy a group grant", () => {
  const groupId = "google-group-sales-stable-id";
  const groupGrant = {
    workspaceId: TEST_PERSONAS.sales.subject.workspaceId,
    spaceId: TEST_DOCUMENTS.sales.spaceId,
    principalKind: "GROUP" as const,
    principalId: groupId,
    role: "SPACE_READER" as const,
    status: "ACTIVE" as const,
    versionId: "group-space-grant-v1",
  };
  const currentEdge = {
    workspaceId: TEST_PERSONAS.sales.subject.workspaceId,
    membershipId: TEST_PERSONAS.sales.subject.membershipId,
    groupId,
    status: "ACTIVE" as const,
    freshness: "CURRENT" as const,
    versionId: "direct-group-edge-v1",
  };
  const groupSubject = {
    ...TEST_PERSONAS.sales.subject,
    spaceGrants: [groupGrant],
    directGroupEdges: [currentEdge],
  };

  assert.equal(
    authorizeKnowledgeAccess(
      groupSubject,
      "document.read",
      TEST_DOCUMENTS.sales,
    ).decision,
    "ALLOW",
  );

  for (const directGroupEdges of [
    [{ ...currentEdge, workspaceId: "workspace-foreign" }],
    [{ ...currentEdge, membershipId: "membership-other" }],
    [{ ...currentEdge, status: "REMOVED" as const }],
    [{ ...currentEdge, freshness: "STALE" as const }],
    [{ ...currentEdge, versionId: "" }],
  ]) {
    assert.equal(
      authorizeKnowledgeAccess(
        { ...groupSubject, directGroupEdges },
        "document.read",
        TEST_DOCUMENTS.sales,
      ).decision,
      "DENY",
    );
  }
});

test("overridden array methods cannot widen or break authorization", () => {
  const spaceGrants = [...TEST_PERSONAS.sales.subject.spaceGrants];
  Object.defineProperty(spaceGrants, "find", {
    value() {
      throw new Error("attacker-controlled find");
    },
  });

  assert.equal(
    authorizeKnowledgeAccess(
      { ...TEST_PERSONAS.sales.subject, spaceGrants },
      "document.read",
      TEST_DOCUMENTS.sales,
    ).decision,
    "ALLOW",
  );

  const foreignGrants = TEST_PERSONAS.sales.subject.spaceGrants.map(
    (grant) => ({ ...grant, workspaceId: "workspace-foreign" }),
  );
  Object.defineProperty(foreignGrants, "find", {
    value() {
      return TEST_PERSONAS.sales.subject.spaceGrants[0];
    },
  });
  assert.equal(
    authorizeKnowledgeAccess(
      { ...TEST_PERSONAS.sales.subject, spaceGrants: foreignGrants },
      "document.read",
      TEST_DOCUMENTS.sales,
    ).decision,
    "DENY",
  );

});

test("throwing getters never escape the top-level authorization boundaries", () => {
  const throwingSubject = Object.create(TEST_PERSONAS.sales.subject, {
    workspaceId: {
      get() {
        throw new Error("attacker-controlled subject getter");
      },
    },
  });
  const throwingResource = Object.create(TEST_DOCUMENTS.sales, {
    documentId: {
      get() {
        throw new Error("attacker-controlled resource getter");
      },
    },
  });

  assert.doesNotThrow(() =>
    authorizeKnowledgeAccess(
      throwingSubject,
      "document.read",
      TEST_DOCUMENTS.sales,
    ),
  );
  assert.equal(
    authorizeKnowledgeAccess(
      throwingSubject,
      "document.read",
      TEST_DOCUMENTS.sales,
    ).decision,
    "DENY",
  );
  assert.doesNotThrow(() =>
    authorizeKnowledgeAccess(
      TEST_PERSONAS.sales.subject,
      "document.read",
      throwingResource,
    ),
  );
  assert.equal(
    authorizeKnowledgeAccess(
      TEST_PERSONAS.sales.subject,
      "document.read",
      throwingResource,
    ).decision,
    "DENY",
  );
});
