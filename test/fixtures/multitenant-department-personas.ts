export const TEST_WORKSPACE_IDS = Object.freeze({
  tenantA: "tenant-a",
  tenantB: "tenant-b",
});

export const TEST_WORKSPACE_ID = TEST_WORKSPACE_IDS.tenantA;

export const TEST_SPACES = Object.freeze({
  sales: Object.freeze({ id: "space-sales", name: "Sales" }),
  hr: Object.freeze({ id: "space-hr", name: "HR" }),
});

export const TEST_DOCUMENTS = Object.freeze({
  sales: Object.freeze({
    workspaceId: TEST_WORKSPACE_ID,
    spaceId: TEST_SPACES.sales.id,
    documentId: "document-sales-confidential",
    status: "READY" as const,
    sourceGate: "ALLOW" as const,
    restrictionGate: "ALLOW" as const,
    securityVersionsCurrent: true,
    spaceVersionId: "space-sales-v1",
    documentVersionId: "document-sales-v1",
    sourceVersionId: "source-sales-v1",
    sourceAclVersionId: "source-sales-acl-v1",
    restrictionVersionId: "document-sales-restriction-v1",
  }),
  hr: Object.freeze({
    workspaceId: TEST_WORKSPACE_ID,
    spaceId: TEST_SPACES.hr.id,
    documentId: "document-hr-confidential",
    status: "READY" as const,
    sourceGate: "ALLOW" as const,
    restrictionGate: "ALLOW" as const,
    securityVersionsCurrent: true,
    spaceVersionId: "space-hr-v1",
    documentVersionId: "document-hr-v1",
    sourceVersionId: "source-hr-v1",
    sourceAclVersionId: "source-hr-acl-v1",
    restrictionVersionId: "document-hr-restriction-v1",
  }),
  tenantBSales: Object.freeze({
    workspaceId: TEST_WORKSPACE_IDS.tenantB,
    spaceId: TEST_SPACES.sales.id,
    documentId: "document-tenant-b-sales-confidential",
    status: "READY" as const,
    sourceGate: "ALLOW" as const,
    restrictionGate: "ALLOW" as const,
    securityVersionsCurrent: true,
    spaceVersionId: "tenant-b-space-sales-v1",
    documentVersionId: "tenant-b-document-sales-v1",
    sourceVersionId: "tenant-b-source-sales-v1",
    sourceAclVersionId: "tenant-b-source-sales-acl-v1",
    restrictionVersionId: "tenant-b-document-sales-restriction-v1",
  }),
});

function membershipGrant(
  workspaceId: string,
  membershipId: string,
  spaceId: string,
  versionId: string,
) {
  return Object.freeze({
    workspaceId,
    spaceId,
    principalKind: "MEMBERSHIP" as const,
    principalId: membershipId,
    role: "SPACE_READER" as const,
    status: "ACTIVE" as const,
    versionId,
  });
}

function persona(input: {
  readonly workspaceId: string;
  readonly email: string;
  readonly role: "OWNER" | "MEMBER";
  readonly department: string;
  readonly membershipId: string;
  readonly grantedSpaceIds: readonly string[];
}) {
  return Object.freeze({
    email: input.email,
    role: input.role,
    department: input.department,
    subject: Object.freeze({
      workspaceId: input.workspaceId,
      membershipId: input.membershipId,
      workspaceRole: input.role,
      sessionActive: true,
      workspaceStatus: "ACTIVE" as const,
      membershipStatus: "ACTIVE" as const,
      directGroupEdges: Object.freeze([]),
      workspaceVersionId: `${input.workspaceId}-v1`,
      membershipVersionId: `${input.membershipId}-v1`,
      spaceGrants: Object.freeze(
        input.grantedSpaceIds.map((spaceId) =>
          membershipGrant(
            input.workspaceId,
            input.membershipId,
            spaceId,
            `${input.membershipId}-${spaceId}-grant-v1`,
          ),
        ),
      ),
    }),
  });
}

export const TEST_PERSONAS = Object.freeze({
  admin: persona({
    workspaceId: TEST_WORKSPACE_IDS.tenantA,
    email: "owner@tenant-a.example",
    role: "OWNER",
    department: "Administration/IT",
    membershipId: "membership-admin",
    grantedSpaceIds: [TEST_SPACES.sales.id, TEST_SPACES.hr.id],
  }),
  sales: persona({
    workspaceId: TEST_WORKSPACE_IDS.tenantA,
    email: "sales-user@tenant-a.example",
    role: "MEMBER",
    department: "Sales",
    membershipId: "membership-sales",
    grantedSpaceIds: [TEST_SPACES.sales.id],
  }),
  hr: persona({
    workspaceId: TEST_WORKSPACE_IDS.tenantA,
    email: "hr-user@tenant-a.example",
    role: "MEMBER",
    department: "HR",
    membershipId: "membership-hr",
    grantedSpaceIds: [TEST_SPACES.hr.id],
  }),
  tenantBSales: persona({
    workspaceId: TEST_WORKSPACE_IDS.tenantB,
    email: "sales-user@tenant-b.example",
    role: "MEMBER",
    department: "Sales",
    membershipId: "membership-tenant-b-sales",
    grantedSpaceIds: [TEST_SPACES.sales.id],
  }),
});
