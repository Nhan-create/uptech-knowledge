import {
  requestTransactionContextFromSession,
  type DatabasePool,
  type NormalSessionContext,
  withRequestTransaction,
} from "../db/core.ts";

const LOAD_DIRECTORY_PERMISSION_CONTEXT_SQL =
  "SELECT * FROM uptech.load_people_permission_context_v1()";

type DirectoryRole = "OWNER" | "ADMIN" | "MEMBER";

interface DirectoryPermissionContextRow {
  readonly workspace_id: unknown;
  readonly membership_role: unknown;
  readonly department_key: unknown;
  readonly direct_group_ids: unknown;
}

function isDirectoryRole(value: unknown): value is DirectoryRole {
  return value === "OWNER" || value === "ADMIN" || value === "MEMBER";
}

function isCurrentDirectoryPermissionContext(
  value: unknown,
  workspaceId: string,
  workspaceRole: DirectoryRole,
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const row = value as DirectoryPermissionContextRow;
  const keys = Object.keys(row).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== "department_key" ||
    keys[1] !== "direct_group_ids" ||
    keys[2] !== "membership_role" ||
    keys[3] !== "workspace_id" ||
    row.workspace_id !== workspaceId ||
    row.membership_role !== workspaceRole ||
    !isDirectoryRole(row.membership_role) ||
    !Array.isArray(row.direct_group_ids) ||
    !row.direct_group_ids.every(
      (groupId) =>
        typeof groupId === "string" &&
        groupId.length >= 1 &&
        groupId.length <= 512 &&
        !groupId.includes("\0"),
    )
  ) {
    return false;
  }
  if (workspaceRole === "OWNER" || workspaceRole === "ADMIN") {
    return row.department_key === null;
  }
  // Manual INVITE_ONLY memberships may be intentionally unassigned. SQL
  // returns no Directory groups and null department in that case, which keeps
  // department-scoped data fail-closed while still allowing the employee home.
  if (row.department_key === null) {
    return row.direct_group_ids.length === 0;
  }
  return (
    row.department_key === "SALES" ||
    row.department_key === "HR" ||
    row.department_key === "IT" ||
    row.department_key === "FINANCE"
  );
}

export async function requireCurrentDirectoryAuthority(
  session: {
    readonly context: NormalSessionContext;
    readonly credentialHash: Uint8Array;
  },
  pool: Pick<DatabasePool, "connect">,
): Promise<boolean> {
  const workspaceRole = session.context.workspaceRole;
  if (!isDirectoryRole(workspaceRole)) {
    return false;
  }
  try {
    return await withRequestTransaction(
      requestTransactionContextFromSession(
        session.context,
        session.credentialHash,
      ),
      async (client) => {
        const result = await client.query<DirectoryPermissionContextRow>(
          LOAD_DIRECTORY_PERMISSION_CONTEXT_SQL,
        );
        return (
          result.rows.length === 1 &&
          isCurrentDirectoryPermissionContext(
            result.rows[0],
            session.context.workspaceId,
            workspaceRole,
          )
        );
      },
      pool,
    );
  } catch {
    return false;
  }
}
