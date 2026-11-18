import { NotificationCenterPrototype } from "@/components/workspace/NotificationCenterPrototype";
import {
  getPreviewWorkspaceContext,
  isWorkspacePreviewModeEnabled,
} from "@/server/knowledge/access-context";
import {
  listWorkspaceNotifications,
  type WorkspaceNotificationRecord,
} from "@/server/knowledge/repository";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  let initialNotifications: readonly WorkspaceNotificationRecord[] = [];
  if (isWorkspacePreviewModeEnabled()) {
    initialNotifications = await listWorkspaceNotifications(
      getPreviewWorkspaceContext(),
    ).catch(() => []);
  }

  return <NotificationCenterPrototype initialNotifications={initialNotifications} />;
}
