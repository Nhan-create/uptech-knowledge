import type { Metadata } from "next";
import { AdminRouteContent } from "@/components/admin/AdminRouteContent";

export const metadata: Metadata = { title: "Quản trị người dùng" };

export default function AdminUsersPage() {
  return <AdminRouteContent kind="users" />;
}
