import {
  ALLOW,
  DENY,
  can,
  type AuthorizationPolicy,
  type AuthorizationResult,
} from "./authorization.ts";

export type KnowledgeAccessAction = "document.read";

export type DirectGroupEdge = Readonly<{
  workspaceId: string;
  membershipId: string;
  groupId: string;
  status: "ACTIVE" | "REMOVED";
  freshness: "CURRENT" | "STALE";
  versionId: string;
}>;

export type SpaceGrant = Readonly<{
  workspaceId: string;
  spaceId: string;
  principalKind: "MEMBERSHIP" | "GROUP" | "WORKSPACE";
  principalId: string;
  role: "SPACE_READER" | "SPACE_MANAGER";
  status: "ACTIVE" | "REVOKED";
  versionId: string;
}>;

export type KnowledgeSubjectContext = Readonly<{
  workspaceId: string;
  membershipId: string;
  workspaceRole: "OWNER" | "ADMIN" | "MEMBER";
  sessionActive: boolean;
  workspaceStatus: string;
  membershipStatus: string;
  directGroupEdges: readonly DirectGroupEdge[];
  workspaceVersionId: string;
  membershipVersionId: string;
  spaceGrants: readonly SpaceGrant[];
}>;

export type KnowledgeResourceLocator = Readonly<{
  workspaceId: string;
  spaceId: string;
  documentId: string;
  status: string;
  sourceGate: "ALLOW" | "DENY";
  restrictionGate: "ALLOW" | "DENY";
  securityVersionsCurrent: boolean;
  spaceVersionId: string;
  documentVersionId: string;
  sourceVersionId: string;
  sourceAclVersionId: string;
  restrictionVersionId: string;
}>;

type SafeSubject = Readonly<{
  workspaceId: string;
  membershipId: string;
  workspaceRole: "OWNER" | "ADMIN" | "MEMBER";
  directGroupEdges: readonly DirectGroupEdge[];
  workspaceVersionId: string;
  membershipVersionId: string;
  spaceGrants: readonly SpaceGrant[];
}>;

const MAX_AUTHORIZATION_ROWS = 4_096;
const NO_VERSION_IDS: readonly string[] = Object.freeze([]);

function deny(): AuthorizationResult {
  return Object.freeze({
    decision: DENY,
    evaluated_version_ids: NO_VERSION_IDS,
  });
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isWorkspaceRole(
  value: unknown,
): value is "OWNER" | "ADMIN" | "MEMBER" {
  return value === "OWNER" || value === "ADMIN" || value === "MEMBER";
}

function copyDirectGroupEdges(value: unknown): readonly DirectGroupEdge[] | null {
  if (!Array.isArray(value) || value.length > MAX_AUTHORIZATION_ROWS) {
    return null;
  }

  const copied = new Array<DirectGroupEdge>(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index] as unknown;
    if (candidate === null || typeof candidate !== "object") return null;
    const row = candidate as Record<string, unknown>;
    const workspaceId = row.workspaceId;
    const membershipId = row.membershipId;
    const groupId = row.groupId;
    const status = row.status;
    const freshness = row.freshness;
    const versionId = row.versionId;

    if (
      !isNonEmpty(workspaceId) ||
      !isNonEmpty(membershipId) ||
      !isNonEmpty(groupId) ||
      (status !== "ACTIVE" && status !== "REMOVED") ||
      (freshness !== "CURRENT" && freshness !== "STALE") ||
      !isNonEmpty(versionId)
    ) {
      return null;
    }

    copied[index] = Object.freeze({
      workspaceId,
      membershipId,
      groupId,
      status,
      freshness,
      versionId,
    });
  }
  return Object.freeze(copied);
}

function copySpaceGrants(value: unknown): readonly SpaceGrant[] | null {
  if (!Array.isArray(value) || value.length > MAX_AUTHORIZATION_ROWS) {
    return null;
  }

  const copied = new Array<SpaceGrant>(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index] as unknown;
    if (candidate === null || typeof candidate !== "object") return null;
    const row = candidate as Record<string, unknown>;
    const workspaceId = row.workspaceId;
    const spaceId = row.spaceId;
    const principalKind = row.principalKind;
    const principalId = row.principalId;
    const role = row.role;
    const status = row.status;
    const versionId = row.versionId;

    if (
      !isNonEmpty(workspaceId) ||
      !isNonEmpty(spaceId) ||
      (principalKind !== "MEMBERSHIP" &&
        principalKind !== "GROUP" &&
        principalKind !== "WORKSPACE") ||
      !isNonEmpty(principalId) ||
      (role !== "SPACE_READER" && role !== "SPACE_MANAGER") ||
      (status !== "ACTIVE" && status !== "REVOKED") ||
      !isNonEmpty(versionId)
    ) {
      return null;
    }

    copied[index] = Object.freeze({
      workspaceId,
      spaceId,
      principalKind,
      principalId,
      role,
      status,
      versionId,
    });
  }
  return Object.freeze(copied);
}

function snapshotSubject(value: unknown): SafeSubject | null {
  if (value === null || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const workspaceId = row.workspaceId;
  const membershipId = row.membershipId;
  const workspaceRole = row.workspaceRole;
  const sessionActive = row.sessionActive;
  const workspaceStatus = row.workspaceStatus;
  const membershipStatus = row.membershipStatus;
  const workspaceVersionId = row.workspaceVersionId;
  const membershipVersionId = row.membershipVersionId;
  const directGroupEdges = copyDirectGroupEdges(row.directGroupEdges);
  const spaceGrants = copySpaceGrants(row.spaceGrants);

  if (
    !isNonEmpty(workspaceId) ||
    !isNonEmpty(membershipId) ||
    !isWorkspaceRole(workspaceRole) ||
    sessionActive !== true ||
    workspaceStatus !== "ACTIVE" ||
    membershipStatus !== "ACTIVE" ||
    !isNonEmpty(workspaceVersionId) ||
    !isNonEmpty(membershipVersionId) ||
    directGroupEdges === null ||
    spaceGrants === null
  ) {
    return null;
  }

  return Object.freeze({
    workspaceId,
    membershipId,
    workspaceRole,
    directGroupEdges,
    workspaceVersionId,
    membershipVersionId,
    spaceGrants,
  });
}

function snapshotResource(value: unknown): KnowledgeResourceLocator | null {
  if (value === null || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const workspaceId = row.workspaceId;
  const spaceId = row.spaceId;
  const documentId = row.documentId;
  const status = row.status;
  const sourceGate = row.sourceGate;
  const restrictionGate = row.restrictionGate;
  const securityVersionsCurrent = row.securityVersionsCurrent;
  const spaceVersionId = row.spaceVersionId;
  const documentVersionId = row.documentVersionId;
  const sourceVersionId = row.sourceVersionId;
  const sourceAclVersionId = row.sourceAclVersionId;
  const restrictionVersionId = row.restrictionVersionId;

  if (
    !isNonEmpty(workspaceId) ||
    !isNonEmpty(spaceId) ||
    !isNonEmpty(documentId) ||
    status !== "READY" ||
    sourceGate !== ALLOW ||
    restrictionGate !== ALLOW ||
    securityVersionsCurrent !== true ||
    !isNonEmpty(spaceVersionId) ||
    !isNonEmpty(documentVersionId) ||
    !isNonEmpty(sourceVersionId) ||
    !isNonEmpty(sourceAclVersionId) ||
    !isNonEmpty(restrictionVersionId)
  ) {
    return null;
  }

  return Object.freeze({
    workspaceId,
    spaceId,
    documentId,
    status,
    sourceGate,
    restrictionGate,
    securityVersionsCurrent,
    spaceVersionId,
    documentVersionId,
    sourceVersionId,
    sourceAclVersionId,
    restrictionVersionId,
  });
}

function matchingPrincipalVersionId(
  subject: SafeSubject,
  grant: SpaceGrant,
): string | null {
  if (grant.principalKind === "MEMBERSHIP") {
    return grant.principalId === subject.membershipId
      ? subject.membershipVersionId
      : null;
  }
  if (grant.principalKind === "WORKSPACE") {
    return grant.principalId === subject.workspaceId
      ? subject.workspaceVersionId
      : null;
  }

  for (let index = 0; index < subject.directGroupEdges.length; index += 1) {
    const edge = subject.directGroupEdges[index];
    if (
      edge.workspaceId === subject.workspaceId &&
      edge.membershipId === subject.membershipId &&
      edge.groupId === grant.principalId &&
      edge.status === "ACTIVE" &&
      edge.freshness === "CURRENT"
    ) {
      return edge.versionId;
    }
  }
  return null;
}

function contentDecision(
  subject: SafeSubject,
  resource: KnowledgeResourceLocator,
): AuthorizationResult {
  if (subject.workspaceId !== resource.workspaceId) return deny();

  for (let index = 0; index < subject.spaceGrants.length; index += 1) {
    const grant = subject.spaceGrants[index];
    if (
      grant.workspaceId !== subject.workspaceId ||
      grant.workspaceId !== resource.workspaceId ||
      grant.spaceId !== resource.spaceId ||
      grant.status !== "ACTIVE"
    ) {
      continue;
    }

    const principalVersionId = matchingPrincipalVersionId(subject, grant);
    if (principalVersionId === null) continue;

    return {
      decision: ALLOW,
      evaluated_version_ids: [
        subject.workspaceVersionId,
        subject.membershipVersionId,
        grant.versionId,
        principalVersionId,
        resource.spaceVersionId,
        resource.documentVersionId,
        resource.sourceVersionId,
        resource.sourceAclVersionId,
        resource.restrictionVersionId,
      ],
    };
  }
  return deny();
}

const KNOWLEDGE_ACCESS_POLICIES: ReadonlyMap<
  KnowledgeAccessAction,
  AuthorizationPolicy<SafeSubject, KnowledgeResourceLocator>
> = new Map([
  ["document.read", (subject, resource) => contentDecision(subject, resource)],
]);

export function authorizeKnowledgeAccess(
  subject: KnowledgeSubjectContext,
  action: KnowledgeAccessAction,
  resource: KnowledgeResourceLocator,
): AuthorizationResult {
  try {
    const safeSubject = snapshotSubject(subject);
    const safeResource = snapshotResource(resource);
    if (safeSubject === null || safeResource === null) return deny();
    return can(safeSubject, action, safeResource, KNOWLEDGE_ACCESS_POLICIES);
  } catch {
    return deny();
  }
}

/**
 * Runs a protected retrieval only after the same fail-closed policy that
 * protects individual knowledge resources has returned ALLOW.
 */
export async function retrieveAuthorizedKnowledgeResource<Result>(
  subject: KnowledgeSubjectContext,
  action: KnowledgeAccessAction,
  resource: KnowledgeResourceLocator,
  retrieve: () => Promise<Result>,
): Promise<Result | null> {
  if (authorizeKnowledgeAccess(subject, action, resource).decision !== ALLOW) {
    return null;
  }
  return retrieve();
}
