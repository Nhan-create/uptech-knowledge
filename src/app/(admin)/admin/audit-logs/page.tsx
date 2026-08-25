import type { Metadata } from "next";
import { AdminRouteContent } from "@/components/admin/AdminRouteContent";

export const metadata: Metadata = { title: "Nhật ký kiểm toán" };

export default function AdminAuditLogsPage() {
  return <AdminRouteContent kind="audit-logs" />;
}
