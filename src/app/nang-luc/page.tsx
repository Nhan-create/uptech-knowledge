import type { Metadata } from "next";

import { PublicInfoPage } from "@/components/landing/PublicInfoPage";

export const metadata: Metadata = {
  title: "Năng lực",
  description:
    "Khám phá Chat AI, Search, Knowledge Spaces và các công cụ tài liệu trong UPTECH KNOWLEDGE.",
};

export default function CapabilitiesPage() {
  return <PublicInfoPage section="capabilities" />;
}
