import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AdminScaffold } from "@/components/admin/AdminScaffold";

export default function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <AppShell>
      <AdminScaffold>{children}</AdminScaffold>
    </AppShell>
  );
}
