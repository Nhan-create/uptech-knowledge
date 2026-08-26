import type { LucideIcon } from "lucide-react";
import {
  BookOpenCheck,
  FileCheck2,
  Files,
  FolderSearch2,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import type { Locale } from "@/lib/preferences";

export type PublicInfoSection =
  | "product"
  | "principles"
  | "capabilities"
  | "workflow";

type ValueItem = Readonly<{
  icon: LucideIcon;
  title: string;
  description: string;
}>;

export type PublicInfoContent = Readonly<{
  sectionLabel: string;
  eyebrow: string;
  title: string;
  summary: string;
  marker: string;
  valueTitle: string;
  valueDescription: string;
  values: readonly ValueItem[];
  featureEyebrow: string;
  featureTitle: string;
  featureDescription: string;
  features: readonly ValueItem[];
  proofLabel: string;
  proofTitle: string;
  proofDescription: string;
  proofPoints: readonly string[];
  primaryCta: string;
  secondaryCta: string;
  ctaTitle: string;
  ctaDescription: string;
  homeLabel: string;
  footerDescription: string;
}>;

const vietnamese: Record<PublicInfoSection, PublicInfoContent> = {
  product: {
    sectionLabel: "Sản phẩm",
    eyebrow: "Trợ lý tri thức AI cho doanh nghiệp",
    title: "Biến tri thức doanh nghiệp thành lợi thế vận hành mỗi ngày.",
    summary:
      "UPTECH KNOWLEDGE đưa tài liệu, tìm kiếm và hỏi đáp AI vào một trải nghiệm thống nhất—để nhân viên tìm đúng thông tin, hiểu nguồn gốc và hành động nhanh hơn.",
    marker: "Giá trị sản phẩm",
    valueTitle: "Một nơi để tìm, hỏi và kiểm chứng.",
    valueDescription:
      "Thay vì dò nhiều thư mục và hỏi lại nhiều người, đội ngũ có thể bắt đầu từ một câu hỏi và đi thẳng tới đúng tài liệu gốc.",
    values: [
      {
        icon: MessageSquareText,
        title: "Câu trả lời dùng được ngay",
        description: "Tổng hợp thông tin từ những nguồn người dùng được phép xem.",
      },
      {
        icon: BookOpenCheck,
        title: "Nguồn luôn ở cạnh kết luận",
        description: "Mở lại tài liệu và vị trí liên quan để kiểm tra trong vài giây.",
      },
      {
        icon: LockKeyhole,
        title: "Quyền truy cập đi xuyên suốt",
        description: "Tìm kiếm, câu trả lời và nguồn đều nằm trong đúng phạm vi quyền.",
      },
    ],
    featureEyebrow: "Bên trong sản phẩm",
    featureTitle: "Từ kho tài liệu đến không gian làm việc có trí tuệ.",
    featureDescription:
      "Mỗi khu vực trong UPTECH KNOWLEDGE nối tiếp nhau để tri thức không dừng ở việc lưu trữ.",
    features: [
      {
        icon: Files,
        title: "Kho tri thức có cấu trúc",
        description: "Tổ chức tài liệu theo workspace, phòng ban, dự án hoặc chủ đề.",
      },
      {
        icon: FolderSearch2,
        title: "Tìm kiếm hợp nhất",
        description: "Tìm bằng từ khóa, ý nghĩa và bộ lọc nguồn trong cùng một luồng.",
      },
      {
        icon: Sparkles,
        title: "AI gắn với công việc",
        description: "Hỏi đáp, tóm tắt và so sánh trên chính những nguồn đã chọn.",
      },
    ],
    proofLabel: "Một trải nghiệm liền mạch",
    proofTitle: "Người dùng đi từ câu hỏi đến bằng chứng, không bị ngắt quãng.",
    proofDescription:
      "Sản phẩm được thiết kế để rút ngắn thời gian tìm hiểu nhưng vẫn giữ đủ ngữ cảnh cho quyết định quan trọng.",
    proofPoints: [
      "Đặt câu hỏi bằng ngôn ngữ tự nhiên",
      "Nhận câu trả lời kèm trích dẫn",
      "Mở nguồn, so sánh và tiếp tục xử lý",
    ],
    primaryCta: "Dùng thử sản phẩm",
    secondaryCta: "Về trang Home",
    ctaTitle: "Đưa tri thức quan trọng vào đúng lúc đội ngũ cần.",
    ctaDescription:
      "Đăng nhập để trải nghiệm cách UPTECH KNOWLEDGE biến tài liệu doanh nghiệp thành câu trả lời có thể kiểm chứng.",
    homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
    footerDescription:
      "Trợ lý tri thức AI giúp doanh nghiệp tìm kiếm, hỏi đáp và kiểm chứng thông tin từ đúng nguồn được phép.",
  },
  principles: {
    sectionLabel: "Nguyên tắc",
    eyebrow: "Trust by design",
    title: "AI doanh nghiệp đáng tin bắt đầu từ nguồn và quyền.",
    summary:
      "UPTECH KNOWLEDGE không chỉ tạo câu trả lời nghe hợp lý. Sản phẩm giữ quyền truy cập, bằng chứng và giới hạn dữ liệu trong toàn bộ trải nghiệm.",
    marker: "Niềm tin trong từng câu trả lời",
    valueTitle: "Hữu ích nhưng không đánh đổi khả năng kiểm chứng.",
    valueDescription:
      "Mỗi kết luận cần cho người dùng biết nó đến từ đâu, dùng dữ liệu nào và phần nào vẫn chưa đủ cơ sở.",
    values: [
      {
        icon: LockKeyhole,
        title: "Theo đúng quyền",
        description: "Chỉ nguồn được phép mới đi vào tìm kiếm và câu trả lời.",
      },
      {
        icon: FileCheck2,
        title: "Có thể kiểm chứng",
        description: "Trích dẫn đưa người dùng trở lại tài liệu và vị trí liên quan.",
      },
      {
        icon: ShieldCheck,
        title: "Nêu rõ giới hạn",
        description: "Thiếu bằng chứng, hệ thống nói rõ thay vì tự lấp khoảng trống.",
      },
    ],
    featureEyebrow: "Nguyên tắc thành tính năng",
    featureTitle: "Niềm tin được thể hiện ngay trong giao diện sản phẩm.",
    featureDescription:
      "Các nguyên tắc không nằm trong tài liệu cam kết riêng; chúng xuất hiện ở từng thao tác người dùng.",
    features: [
      {
        icon: BookOpenCheck,
        title: "Citation có thể mở",
        description: "Tên nguồn, vị trí và đoạn liên quan luôn ở gần câu trả lời.",
      },
      {
        icon: Files,
        title: "Phạm vi nguồn rõ ràng",
        description: "Người dùng thấy workspace và bộ tài liệu đang được sử dụng.",
      },
      {
        icon: MessageSquareText,
        title: "Phản hồi có mức độ chắc chắn",
        description: "Câu trả lời phân biệt dữ kiện có nguồn với phần còn thiếu dữ liệu.",
      },
    ],
    proofLabel: "An toàn trong vận hành",
    proofTitle: "Tăng tốc tìm hiểu mà vẫn giữ con người trong vòng kiểm tra.",
    proofDescription:
      "UPTECH KNOWLEDGE hỗ trợ quyết định bằng cách làm rõ bằng chứng, không thay người dùng chịu trách nhiệm cho quyết định đó.",
    proofPoints: [
      "Quyền được kiểm tra trước khi truy xuất",
      "Nguồn đi cùng câu trả lời",
      "Người dùng luôn có đường quay lại tài liệu gốc",
    ],
    primaryCta: "Dùng thử sản phẩm",
    secondaryCta: "Về trang Home",
    ctaTitle: "Đưa AI vào doanh nghiệp với một nền tảng đáng tin.",
    ctaDescription:
      "Trải nghiệm cách nguồn, quyền và trích dẫn được kết hợp trong cùng một luồng làm việc.",
    homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
    footerDescription:
      "Trợ lý tri thức AI giúp doanh nghiệp tìm kiếm, hỏi đáp và kiểm chứng thông tin từ đúng nguồn được phép.",
  },
  capabilities: {
    sectionLabel: "Năng lực",
    eyebrow: "Một nơi cho tri thức",
    title: "Bộ công cụ giúp đội ngũ tìm hiểu và hành động nhanh hơn.",
    summary:
      "UPTECH KNOWLEDGE kết hợp Chat AI, Search, kho tri thức và công cụ tài liệu để người dùng làm việc xuyên suốt mà không mất dấu nguồn.",
    marker: "Bộ công cụ tri thức",
    valueTitle: "Các năng lực được kết nối, không đứng riêng lẻ.",
    valueDescription:
      "Kết quả tìm kiếm có thể trở thành nguồn cho câu hỏi; câu trả lời có thể mở lại, so sánh và tiếp tục xử lý ngay trong sản phẩm.",
    values: [
      {
        icon: MessageSquareText,
        title: "Chat AI có trích dẫn",
        description: "Hỏi toàn bộ kho tri thức bằng ngôn ngữ tự nhiên.",
      },
      {
        icon: FolderSearch2,
        title: "Search theo từ khóa và ý nghĩa",
        description: "Tìm đúng chính sách, hợp đồng hay quy trình dù cách diễn đạt khác nhau.",
      },
      {
        icon: Files,
        title: "Knowledge Spaces",
        description: "Tổ chức nguồn theo phòng ban, dự án, khách hàng hoặc chủ đề.",
      },
    ],
    featureEyebrow: "Năng lực sản phẩm",
    featureTitle: "Làm nhiều hơn sau khi đã tìm thấy thông tin.",
    featureDescription:
      "Các công cụ xử lý tài liệu giúp biến thông tin đã tìm được thành đầu ra phục vụ công việc.",
    features: [
      {
        icon: BookOpenCheck,
        title: "Đọc nguồn trong ngữ cảnh",
        description: "Đi thẳng tới tài liệu và phần nội dung liên quan tới câu trả lời.",
      },
      {
        icon: FileCheck2,
        title: "So sánh tài liệu",
        description: "Đặt các phiên bản hoặc nguồn cạnh nhau để nhận diện điểm khác biệt.",
      },
      {
        icon: Sparkles,
        title: "AI utilities",
        description: "Tóm tắt, tạo nháp và xử lý nội dung trên bộ nguồn đã chọn.",
      },
    ],
    proofLabel: "Từ khả năng đến kết quả",
    proofTitle: "Ít thời gian tìm kiếm hơn, nhiều thời gian giải quyết công việc hơn.",
    proofDescription:
      "Mỗi năng lực được thiết kế để giảm bước chuyển đổi giữa tài liệu, tìm kiếm và công cụ AI.",
    proofPoints: [
      "Một điểm bắt đầu cho nhiều nguồn tri thức",
      "Một luồng xuyên suốt từ Search đến Chat",
      "Một đường kiểm chứng rõ ràng tới nguồn gốc",
    ],
    primaryCta: "Dùng thử năng lực AI",
    secondaryCta: "Về trang Home",
    ctaTitle: "Khám phá bộ công cụ tri thức trong một trải nghiệm thống nhất.",
    ctaDescription:
      "Đăng nhập để thử Chat, Search, kho tri thức và công cụ tài liệu của UPTECH KNOWLEDGE.",
    homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
    footerDescription:
      "Trợ lý tri thức AI giúp doanh nghiệp tìm kiếm, hỏi đáp và kiểm chứng thông tin từ đúng nguồn được phép.",
  },
  workflow: {
    sectionLabel: "Quy trình",
    eyebrow: "Luồng tri thức khép kín",
    title: "Từ tài liệu rời rạc đến câu trả lời có thể hành động.",
    summary:
      "UPTECH KNOWLEDGE giữ nguyên ngữ cảnh nguồn và quyền truy cập từ lúc tài liệu đi vào workspace cho tới khi người dùng mở bằng chứng.",
    marker: "Luồng sử dụng",
    valueTitle: "Nhanh để sử dụng. Rõ để kiểm tra.",
    valueDescription:
      "Một quy trình thống nhất giúp đội ngũ biết phải bắt đầu ở đâu và luôn có đường quay lại dữ liệu gốc.",
    values: [
      {
        icon: Files,
        title: "01 · Tập trung nguồn",
        description: "Đưa tài liệu được phê duyệt về đúng workspace và không gian tri thức.",
      },
      {
        icon: LockKeyhole,
        title: "02 · Giữ nguyên quyền",
        description: "Gắn phạm vi truy cập trước khi nội dung được xử lý và lập chỉ mục.",
      },
      {
        icon: FolderSearch2,
        title: "03 · Tìm hoặc hỏi",
        description: "Truy xuất bằng từ khóa, ý nghĩa hoặc một câu hỏi tự nhiên.",
      },
    ],
    featureEyebrow: "Bước cuối tạo khác biệt",
    featureTitle: "Mở nguồn kiểm chứng trước khi hành động.",
    featureDescription:
      "Câu trả lời không phải điểm kết thúc; người dùng có thể đi tiếp tới đúng tài liệu, vị trí và ngữ cảnh liên quan.",
    features: [
      {
        icon: BookOpenCheck,
        title: "04 · Mở citation",
        description: "Kiểm tra phần nguồn được dùng để tạo ra kết luận.",
      },
      {
        icon: FileCheck2,
        title: "So sánh khi cần",
        description: "Đối chiếu nguồn hoặc phiên bản trước khi ra quyết định.",
      },
      {
        icon: Sparkles,
        title: "Tiếp tục xử lý",
        description: "Tóm tắt hoặc tạo bản nháp mới từ bộ nguồn đã xác nhận.",
      },
    ],
    proofLabel: "Quy trình trong thực tế",
    proofTitle: "Mỗi bước đều giữ lại điều người dùng cần để tin tưởng kết quả.",
    proofDescription:
      "Từ nguồn, quyền, truy xuất đến citation, sản phẩm duy trì một chuỗi ngữ cảnh xuyên suốt.",
    proofPoints: [
      "Nguồn được chuẩn hóa theo workspace",
      "Quyền được áp dụng trước khi truy xuất",
      "Câu trả lời dẫn trở lại đúng bằng chứng",
    ],
    primaryCta: "Dùng thử quy trình",
    secondaryCta: "Về trang Home",
    ctaTitle: "Cho đội ngũ một con đường ngắn hơn từ câu hỏi đến quyết định.",
    ctaDescription:
      "Đăng nhập để trải nghiệm luồng tìm kiếm, hỏi đáp và kiểm chứng của UPTECH KNOWLEDGE.",
    homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
    footerDescription:
      "Trợ lý tri thức AI giúp doanh nghiệp tìm kiếm, hỏi đáp và kiểm chứng thông tin từ đúng nguồn được phép.",
  },
};

const english: Record<PublicInfoSection, PublicInfoContent> = {
  product: {
    ...vietnamese.product,
    sectionLabel: "Product",
    eyebrow: "Enterprise AI knowledge assistant",
    title: "Turn enterprise knowledge into an everyday operating advantage.",
    summary:
      "UPTECH KNOWLEDGE brings documents, search, and grounded AI answers into one experience so teams can find, understand, and act faster.",
    marker: "Product value",
    valueTitle: "One place to find, ask, and verify.",
    valueDescription:
      "Instead of searching across folders and people, teams can start with a question and move directly to the original evidence.",
    values: [
      {
        icon: MessageSquareText,
        title: "Answers ready for work",
        description: "Synthesize information only from sources the user may access.",
      },
      {
        icon: BookOpenCheck,
        title: "Evidence beside every conclusion",
        description: "Open the relevant document and location in seconds.",
      },
      {
        icon: LockKeyhole,
        title: "Permissions preserved end to end",
        description: "Search, answers, and sources stay within the correct access scope.",
      },
    ],
    featureEyebrow: "Inside the product",
    featureTitle: "From document storage to an intelligent workspace.",
    featureDescription:
      "Every area of UPTECH KNOWLEDGE connects so knowledge does not stop at storage.",
    features: [
      {
        icon: Files,
        title: "Structured knowledge spaces",
        description: "Organize documents by workspace, team, project, or topic.",
      },
      {
        icon: FolderSearch2,
        title: "Unified search",
        description: "Search by keywords, meaning, and source filters in one flow.",
      },
      {
        icon: Sparkles,
        title: "AI grounded in real work",
        description: "Ask, summarize, and compare using the exact sources you select.",
      },
    ],
    proofLabel: "One connected experience",
    proofTitle: "Move from a question to evidence without breaking the flow.",
    proofDescription:
      "The product reduces discovery time while preserving the context behind important decisions.",
    proofPoints: [
      "Ask in natural language",
      "Receive answers with citations",
      "Open, compare, and continue from the source",
    ],
    primaryCta: "Try the product",
    secondaryCta: "Back to Home",
    ctaTitle: "Bring important knowledge to the moment your team needs it.",
    ctaDescription:
      "Sign in to experience how UPTECH KNOWLEDGE turns enterprise documents into verifiable answers.",
    homeLabel: "UPTECH KNOWLEDGE - Home",
    footerDescription:
      "An AI knowledge assistant for searching, asking, and verifying information from permitted enterprise sources.",
  },
  principles: {
    ...vietnamese.principles,
    sectionLabel: "Principles",
    eyebrow: "Trust by design",
    title: "Trusted enterprise AI starts with sources and permissions.",
    summary:
      "UPTECH KNOWLEDGE does more than generate plausible answers. It preserves access scope, evidence, and data limits throughout the experience.",
    marker: "Trust in every answer",
    valueTitle: "Useful without sacrificing verifiability.",
    valueDescription:
      "Every conclusion should show where it came from, which data it used, and what remains unsupported.",
    values: [
      {
        icon: LockKeyhole,
        title: "Permission-aware",
        description: "Only authorized sources can enter search and answers.",
      },
      {
        icon: FileCheck2,
        title: "Verifiable",
        description: "Citations return users to the relevant document and location.",
      },
      {
        icon: ShieldCheck,
        title: "Clear about limits",
        description: "When evidence is missing, the system says so instead of guessing.",
      },
    ],
    featureEyebrow: "Principles as product behavior",
    featureTitle: "Trust is visible in the interface, not hidden in a policy.",
    featureDescription:
      "Permission scope, citations, and uncertainty appear in the flow where people make decisions.",
    features: [
      {
        icon: BookOpenCheck,
        title: "Openable citations",
        description: "Source name, location, and relevant context stay close to the answer.",
      },
      {
        icon: Files,
        title: "Visible source scope",
        description: "Users can see which workspace and documents are being used.",
      },
      {
        icon: MessageSquareText,
        title: "Evidence-aware responses",
        description: "Answers distinguish sourced facts from missing information.",
      },
    ],
    proofLabel: "Safe in operation",
    proofTitle: "Accelerate understanding while keeping people in the verification loop.",
    proofDescription:
      "UPTECH KNOWLEDGE supports decisions by clarifying evidence rather than replacing human responsibility.",
    proofPoints: [
      "Permissions checked before retrieval",
      "Sources shown with answers",
      "A clear path back to the original document",
    ],
    primaryCta: "Try the product",
    secondaryCta: "Back to Home",
    ctaTitle: "Bring AI into the enterprise on a trustworthy foundation.",
    ctaDescription:
      "See how sources, permissions, and citations work together in one product flow.",
    homeLabel: "UPTECH KNOWLEDGE - Home",
    footerDescription:
      "An AI knowledge assistant for searching, asking, and verifying information from permitted enterprise sources.",
  },
  capabilities: {
    ...vietnamese.capabilities,
    sectionLabel: "Capabilities",
    eyebrow: "One place for knowledge",
    title: "A toolkit that helps teams understand and act faster.",
    summary:
      "UPTECH KNOWLEDGE connects AI Chat, Search, knowledge spaces, and document tools without losing the source context.",
    marker: "Knowledge toolkit",
    valueTitle: "Connected capabilities, not isolated features.",
    valueDescription:
      "Search results become sources for questions, and answers can be opened, compared, and transformed inside the product.",
    values: [
      {
        icon: MessageSquareText,
        title: "Cited AI Chat",
        description: "Ask across permitted enterprise knowledge in natural language.",
      },
      {
        icon: FolderSearch2,
        title: "Semantic and keyword Search",
        description: "Find policies, contracts, and processes even when wording differs.",
      },
      {
        icon: Files,
        title: "Knowledge Spaces",
        description: "Organize sources around teams, projects, customers, or topics.",
      },
    ],
    featureEyebrow: "Product capabilities",
    featureTitle: "Do more after finding the right information.",
    featureDescription:
      "Document tools turn trusted information into practical outputs for daily work.",
    features: [
      {
        icon: BookOpenCheck,
        title: "Contextual source reader",
        description: "Jump directly to the document section behind an answer.",
      },
      {
        icon: FileCheck2,
        title: "Document comparison",
        description: "Review versions or sources side by side to identify differences.",
      },
      {
        icon: Sparkles,
        title: "AI utilities",
        description: "Summarize, draft, and transform content from selected sources.",
      },
    ],
    proofLabel: "From capability to outcome",
    proofTitle: "Spend less time finding and more time solving.",
    proofDescription:
      "Each capability reduces handoffs between documents, search, and AI tools.",
    proofPoints: [
      "One starting point for many knowledge sources",
      "One flow from Search to Chat",
      "One verifiable path back to evidence",
    ],
    primaryCta: "Try AI capabilities",
    secondaryCta: "Back to Home",
    ctaTitle: "Explore the knowledge toolkit in one connected experience.",
    ctaDescription:
      "Sign in to try Chat, Search, knowledge spaces, and document utilities.",
    homeLabel: "UPTECH KNOWLEDGE - Home",
    footerDescription:
      "An AI knowledge assistant for searching, asking, and verifying information from permitted enterprise sources.",
  },
  workflow: {
    ...vietnamese.workflow,
    sectionLabel: "Workflow",
    eyebrow: "A closed knowledge loop",
    title: "From scattered documents to answers teams can act on.",
    summary:
      "UPTECH KNOWLEDGE preserves source context and permissions from ingestion through to the evidence a user opens.",
    marker: "Product workflow",
    valueTitle: "Fast to use. Clear to verify.",
    valueDescription:
      "A unified workflow gives teams a clear starting point and a reliable path back to source data.",
    values: [
      {
        icon: Files,
        title: "01 · Centralize sources",
        description: "Bring approved documents into the right workspace and knowledge space.",
      },
      {
        icon: LockKeyhole,
        title: "02 · Preserve permissions",
        description: "Attach access scope before content is processed and indexed.",
      },
      {
        icon: FolderSearch2,
        title: "03 · Search or ask",
        description: "Retrieve by keyword, meaning, or a natural-language question.",
      },
    ],
    featureEyebrow: "The step that matters",
    featureTitle: "Open the evidence before taking action.",
    featureDescription:
      "An answer is not the endpoint; users can continue to the exact document, location, and context behind it.",
    features: [
      {
        icon: BookOpenCheck,
        title: "04 · Open the citation",
        description: "Verify the exact source context used for the conclusion.",
      },
      {
        icon: FileCheck2,
        title: "Compare when needed",
        description: "Review sources or versions before making a decision.",
      },
      {
        icon: Sparkles,
        title: "Continue the work",
        description: "Summarize or draft new output from the verified source set.",
      },
    ],
    proofLabel: "Workflow in practice",
    proofTitle: "Every step preserves what users need to trust the result.",
    proofDescription:
      "From source and permission to retrieval and citation, the product maintains one continuous context chain.",
    proofPoints: [
      "Sources structured by workspace",
      "Permissions applied before retrieval",
      "Answers lead back to the right evidence",
    ],
    primaryCta: "Try the workflow",
    secondaryCta: "Back to Home",
    ctaTitle: "Give teams a shorter path from question to decision.",
    ctaDescription:
      "Sign in to experience UPTECH KNOWLEDGE search, answers, and verification.",
    homeLabel: "UPTECH KNOWLEDGE - Home",
    footerDescription:
      "An AI knowledge assistant for searching, asking, and verifying information from permitted enterprise sources.",
  },
};

export function getPublicInfoContent(
  section: PublicInfoSection,
  locale: Locale,
): PublicInfoContent {
  return locale === "en" ? english[section] : vietnamese[section];
}
