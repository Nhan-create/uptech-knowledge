import { headers } from "next/headers";

import { NotificationCenterPrototype } from "@/components/workspace/NotificationCenterPrototype";
import { resolveWorkspaceServerAccess } from "@/server/knowledge/access-context";
import {
  listWorkspaceNotifications,
  type WorkspaceNotificationRecord,
} from "@/server/knowledge/repository";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const access = await resolveWorkspaceServerAccess(await headers());
  const initialNotifications: readonly WorkspaceNotificationRecord[] = access
    ? await listWorkspaceNotifications(access).catch(() => [])
    : [];

  return <NotificationCenterPrototype initialNotifications={initialNotifications} />;
}
