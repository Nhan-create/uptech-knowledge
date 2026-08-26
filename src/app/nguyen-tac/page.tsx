import type { Metadata } from "next";

import { PublicInfoPage } from "@/components/landing/PublicInfoPage";

export const metadata: Metadata = {
  title: "Nguyên tắc",
  description:
    "Tìm hiểu cách UPTECH KNOWLEDGE giữ nguồn, quyền truy cập và khả năng kiểm chứng trong từng câu trả lời AI.",
};

export default function PrinciplesPage() {
  return <PublicInfoPage section="principles" />;
}
