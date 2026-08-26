import type { Metadata } from "next";

import { PublicInfoPage } from "@/components/landing/PublicInfoPage";

export const metadata: Metadata = {
  title: "Quy trình",
  description:
    "Theo dõi luồng sử dụng UPTECH KNOWLEDGE từ nguồn tài liệu đến câu trả lời và bằng chứng kiểm chứng.",
};

export default function WorkflowPage() {
  return <PublicInfoPage section="workflow" />;
}
