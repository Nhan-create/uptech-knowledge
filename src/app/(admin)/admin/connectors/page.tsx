import type { Metadata } from "next";
import { AdminRouteContent } from "@/components/admin/AdminRouteContent";

export const metadata: Metadata = { title: "Kết nối dữ liệu" };

export default function AdminConnectorsPage() {
  return <AdminRouteContent kind="connectors" />;
}
