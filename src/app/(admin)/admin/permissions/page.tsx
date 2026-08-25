import type { Metadata } from "next";
import { AdminRouteContent } from "@/components/admin/AdminRouteContent";

export const metadata: Metadata = { title: "Mô hình quyền" };

export default function AdminPermissionsPage() {
  return <AdminRouteContent kind="permissions" />;
}
