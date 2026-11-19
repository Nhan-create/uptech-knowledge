import { AdminAuditLogsClient } from "./AdminAuditLogsClient";
import { AdminBillingClient } from "./AdminBillingClient";
import { AdminConnectorsClient } from "./AdminConnectorsClient";
import { AdminPermissionsClient } from "./AdminPermissionsClient";
import { AdminSettingsClient } from "./AdminSettingsClient";
import { AdminUsersClient } from "./AdminUsersClient";

export type AdminRouteKind =
  | "users"
  | "permissions"
  | "connectors"
  | "billing"
  | "audit-logs"
  | "settings";

export function AdminRouteContent({ kind }: { kind: AdminRouteKind }) {
  switch (kind) {
    case "users":
      return <AdminUsersClient />;
    case "permissions":
      return <AdminPermissionsClient />;
    case "connectors":
      return <AdminConnectorsClient />;
    case "billing":
      return <AdminBillingClient />;
    case "audit-logs":
      return <AdminAuditLogsClient />;
    case "settings":
      return <AdminSettingsClient />;
  }
}
