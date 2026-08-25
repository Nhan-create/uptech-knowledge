import type { Metadata } from "next";
import { NotificationCenterPrototype } from "@/components/workspace/NotificationCenterPrototype";

export const metadata: Metadata = {
  title: "Thông báo",
};

export default function NotificationsPage() {
  return <NotificationCenterPrototype />;
}
