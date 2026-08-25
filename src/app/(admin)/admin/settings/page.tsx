import type { Metadata } from "next";
import { AdminRouteContent } from "@/components/admin/AdminRouteContent";

export const metadata: Metadata = { title: "Thiết lập workspace" };

export default function AdminSettingsPage() {
  return <AdminRouteContent kind="settings" />;
}
