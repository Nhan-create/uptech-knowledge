import type { Metadata } from "next";
import { AdminRouteContent } from "@/components/admin/AdminRouteContent";

export const metadata: Metadata = { title: "Thanh toán" };

export default function AdminBillingPage() {
  return <AdminRouteContent kind="billing" />;
}
