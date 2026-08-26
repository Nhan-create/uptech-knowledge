import type { Metadata } from "next";

import { PublicInfoPage } from "@/components/landing/PublicInfoPage";

export const metadata: Metadata = {
  title: "Sản phẩm",
  description:
    "Khám phá cách UPTECH KNOWLEDGE biến tài liệu doanh nghiệp thành câu trả lời có nguồn và đúng phạm vi quyền.",
};

export default function ProductPage() {
  return <PublicInfoPage section="product" />;
}
