import type { Metadata } from "next";
import {
  ChatDemo,
  type ChatFixtureScope,
} from "@/components/workspace/ChatDemo";
import {
  DemoNotice,
  PageIntro,
  StatePreview,
  WorkspacePage,
} from "@/components/workspace/WorkspacePrimitives";

export const metadata: Metadata = {
  title: "Trợ lý AI",
};

type ChatSearchParams = Readonly<{
  prompt?: string | string[];
  scope?: string | string[];
}>;

function getFirstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getFixtureScope(value: string | undefined): ChatFixtureScope {
  switch (value) {
    case "hr":
    case "operations":
    case "atlas":
      return value;
    default:
      return "workspace";
  }
}

export default async function ChatPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<ChatSearchParams>;
}>) {
  const query = await searchParams;
  const initialPrompt = getFirstSearchParam(query.prompt) ?? "";
  const initialScope = getFixtureScope(getFirstSearchParam(query.scope));

  return (
    <WorkspacePage>
      <PageIntro
        eyebrow="AI Chat · Prototype"
        title="Hỏi đáp có nguồn để kiểm tra"
        description="Trải nghiệm bố cục câu trả lời và trình đọc trích dẫn. Màn hình này dùng nội dung giả lập, không gửi câu hỏi hay mở tài liệu thật."
      />
      <DemoNotice className="mt-6" />
      <ChatDemo
        key={`${initialScope}:${initialPrompt}`}
        initialPrompt={initialPrompt}
        initialScope={initialScope}
      />
      <StatePreview
        id="chat-state-heading"
        title="Bằng chứng trong câu trả lời"
        description="Năm thẻ dưới đây chỉ là đặc tả trình bày [PROPOSED UI] · [PROTOTYPE LOCAL STATE]; không có bộ chọn runtime và backend chưa cung cấp hợp đồng trạng thái [SHARED CONTRACT GAP]."
        states={[
          {
            label: "Có đủ nguồn",
            description: "Cho biết câu trả lời có thể trình bày cùng nguồn, đồng thời vẫn nêu rõ trạng thái fixture chưa được backend xác minh.",
            tone: "emerald",
          },
          {
            label: "Dữ liệu hạn chế",
            description: "Nêu giới hạn của phần bằng chứng đang có và tránh diễn đạt suy đoán như một sự thật.",
            tone: "amber",
          },
          {
            label: "Nguồn có nội dung mâu thuẫn",
            description: "Cảnh báo có khác biệt giữa các nguồn và yêu cầu người đọc kiểm tra trước khi sử dụng.",
            tone: "rose",
          },
          {
            label: "Không có nguồn được cấp quyền",
            description: "Thông báo an toàn rằng không có nguồn khả dụng; không tiết lộ tiêu đề, vị trí hoặc trích đoạn bị hạn chế.",
            tone: "slate",
          },
          {
            label: "Nguồn đã hết hiệu lực",
            description: "Yêu cầu làm mới phạm vi hoặc chọn nguồn khác mà không hiển thị metadata của nguồn không còn hiệu lực.",
            tone: "rose",
          },
        ]}
      />
    </WorkspacePage>
  );
}
