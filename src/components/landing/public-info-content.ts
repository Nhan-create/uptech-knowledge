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
  section: PublicInfoSection;
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
  ctaTitle: string;
  ctaDescription: string;
  homeLabel: string;
  footerDescription: string;
}>;

const vietnamese: Record<PublicInfoSection, PublicInfoContent> = {
  product: {
    section: "product",
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
        title: "Thư viện & Không gian tri thức",
        description:
          "Tổ chức tài liệu theo không gian (Nhân sự, Vận hành, Dự án Atlas) và theo dõi trạng thái Sẵn sàng hay đang OCR.",
      },
      {
        icon: FolderSearch2,
        title: "Tìm kiếm & Tìm nhanh (Ctrl K)",
        description:
          "Tra cứu trong kho tài liệu Sẵn sàng với bộ lọc Không gian tri thức, Loại tệp hoặc nhảy nhanh từ mọi trang.",
      },
      {
        icon: Sparkles,
        title: "Trợ lý AI, So sánh Diff & Tiện ích AI",
        description:
          "Hỏi đáp theo phạm vi nguồn, đối chiếu thay đổi giữa hai tài liệu và chạy 6 tác vụ tạo bản nháp cần rà soát.",
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
    ctaTitle: "Đưa tri thức quan trọng vào đúng lúc đội ngũ cần.",
    ctaDescription:
      "Đăng nhập để trải nghiệm cách UPTECH KNOWLEDGE biến tài liệu doanh nghiệp thành câu trả lời có thể kiểm chứng.",
    homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
    footerDescription:
      "Trợ lý tri thức AI giúp doanh nghiệp tìm kiếm, hỏi đáp và kiểm chứng thông tin từ đúng nguồn được phép.",
  },
  principles: {
    section: "principles",
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
        title: "Chỉ dùng nguồn Sẵn sàng & đúng quyền",
        description:
          "Quy tắc Ready-Only loại trừ tệp đang OCR, đang tải hoặc lỗi; quyền được kiểm tra lại lúc mở tài liệu.",
      },
      {
        icon: FileCheck2,
        title: "Trình đọc nguồn trích dẫn",
        description:
          "Thẻ [1]..[N] mở ngay đoạn trích gốc, số trang/mục và liên kết về trang chi tiết tài liệu.",
      },
      {
        icon: ShieldCheck,
        title: "Minh bạch phạm vi & giới hạn",
        description:
          "Hiển thị rõ không gian đang hỏi, số tệp Sẵn sàng và số tệp bị loại trừ thay vì suy đoán.",
      },
    ],
    featureEyebrow: "Nguyên tắc thành tính năng",
    featureTitle: "Niềm tin được thể hiện ngay trong giao diện sản phẩm.",
    featureDescription:
      "Các nguyên tắc không nằm trong tài liệu cam kết riêng; chúng xuất hiện ở từng tab của web.",
    features: [
      {
        icon: BookOpenCheck,
        title: "Trình đọc trích dẫn song song",
        description:
          "Tên nguồn, phiên bản, vị trí trang/mục và trích đoạn gốc luôn mở được ngay bên cạnh hội thoại.",
      },
      {
        icon: Files,
        title: "Phạm vi nguồn & nhãn hiệu lực",
        description:
          "Người dùng chọn Toàn workspace, từng không gian hoặc tệp đính kèm và thấy rõ nhãn Official, Verified, Expiring.",
      },
      {
        icon: MessageSquareText,
        title: "Mở đích an toàn & rà soát bản nháp",
        description:
          "Thông báo chặn liên kết hết hiệu lực; Tiện ích AI luôn giữ bản nháp ở trạng thái chờ rà soát.",
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
    ctaTitle: "Đưa AI vào doanh nghiệp với một nền tảng đáng tin.",
    ctaDescription:
      "Trải nghiệm cách nguồn, quyền và trích dẫn được kết hợp trong cùng một luồng làm việc.",
    homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
    footerDescription:
      "Trợ lý tri thức AI giúp doanh nghiệp tìm kiếm, hỏi đáp và kiểm chứng thông tin từ đúng nguồn được phép.",
  },
  capabilities: {
    section: "capabilities",
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
        title: "Trợ lý AI có trích dẫn",
        description:
          "Hỏi đáp theo Toàn workspace, từng Không gian tri thức hoặc tài liệu đính kèm trên nguồn Sẵn sàng.",
      },
      {
        icon: FolderSearch2,
        title: "Tìm kiếm & Tìm nhanh (Ctrl K)",
        description:
          "Tìm theo từ khóa trên kho tài liệu Sẵn sàng, lọc theo Không gian tri thức và Loại tệp.",
      },
      {
        icon: Files,
        title: "Thư viện & Không gian tri thức",
        description:
          "Quản lý tài liệu theo Nhân sự, Vận hành, Dự án Atlas kèm trạng thái xử lý và lịch sử phiên bản.",
      },
    ],
    featureEyebrow: "Năng lực sản phẩm",
    featureTitle: "Làm nhiều hơn sau khi đã tìm thấy thông tin.",
    featureDescription:
      "Các công cụ xử lý tài liệu trên web giúp biến thông tin đã tìm được thành đầu ra phục vụ công việc.",
    features: [
      {
        icon: BookOpenCheck,
        title: "Trình đọc nguồn trích dẫn",
        description:
          "Bấm thẻ [1]..[N] để mở đoạn trích gốc ngay bên cạnh câu trả lời và đi tới chi tiết tài liệu.",
      },
      {
        icon: FileCheck2,
        title: "So sánh tài liệu (Diff)",
        description:
          "Đặt hai tài liệu Sẵn sàng cạnh nhau để nhận diện rõ từng điểm Bổ sung và Thay đổi.",
      },
      {
        icon: Sparkles,
        title: "Tiện ích AI (6 tác vụ)",
        description:
          "Tóm tắt, Dịch thuật, Checklist, Báo cáo, Email và So sánh từ nguồn đã chọn để rà soát trước khi dùng.",
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
    ctaTitle: "Khám phá bộ công cụ tri thức trong một trải nghiệm thống nhất.",
    ctaDescription:
      "Đăng nhập để thử Chat, Search, kho tri thức và công cụ tài liệu của UPTECH KNOWLEDGE.",
    homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
    footerDescription:
      "Trợ lý tri thức AI giúp doanh nghiệp tìm kiếm, hỏi đáp và kiểm chứng thông tin từ đúng nguồn được phép.",
  },
  workflow: {
    section: "workflow",
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
        title: "01 · Đưa nguồn vào Thư viện",
        description:
          "Tải tệp vào đúng Không gian tri thức và theo dõi xử lý (tải lên, OCR, lập chỉ mục) tới Sẵn sàng.",
      },
      {
        icon: LockKeyhole,
        title: "02 · Lọc nguồn Sẵn sàng",
        description:
          "Chỉ tài liệu đạt Sẵn sàng mới vào Tìm kiếm và Trợ lý AI; tệp đang xử lý hoặc lỗi được tách riêng.",
      },
      {
        icon: FolderSearch2,
        title: "03 · Tìm kiếm hoặc hỏi Trợ lý AI",
        description:
          "Lọc theo Không gian và Loại tệp ở Tìm kiếm hoặc đặt câu hỏi theo phạm vi trên Trợ lý AI.",
      },
    ],
    featureEyebrow: "Bước cuối tạo khác biệt",
    featureTitle: "Kiểm chứng trích dẫn, đối chiếu và tạo đầu ra.",
    featureDescription:
      "Câu trả lời không phải điểm kết thúc; người dùng mở đoạn gốc, so sánh hai tài liệu hoặc chuyển sang Tiện ích AI.",
    features: [
      {
        icon: BookOpenCheck,
        title: "04 · Mở Trình đọc trích dẫn",
        description:
          "Bấm thẻ [1]..[N] để đối chiếu đoạn văn bản gốc và trang/mục trong tài liệu.",
      },
      {
        icon: FileCheck2,
        title: "So sánh Diff khi cần",
        description:
          "Chọn hai tài liệu Sẵn sàng ở So sánh Diff để xem phần Bổ sung và Thay đổi.",
      },
      {
        icon: Sparkles,
        title: "Tạo bản nháp ở Tiện ích AI",
        description:
          "Chạy Tóm tắt, Dịch thuật, Checklist, Báo cáo hoặc Email từ nguồn đã chọn rồi rà soát trước khi dùng.",
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
        title: "Library & Knowledge Spaces",
        description:
          "Organize files into spaces (HR, Operations, Project Atlas) and track Ready vs. OCR/processing status.",
      },
      {
        icon: FolderSearch2,
        title: "Search & Quick Find (Ctrl K)",
        description:
          "Query Ready documents by keyword, Knowledge Space, and file type, or jump from any view.",
      },
      {
        icon: Sparkles,
        title: "AI Assistant, Document Diff & AI Utilities",
        description:
          "Ask scoped questions, compare two Ready documents, and run 6 review-first drafting utilities.",
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
        description:
          "Ask across the whole workspace, a Knowledge Space, or attached Ready files.",
      },
      {
        icon: FolderSearch2,
        title: "Search & Quick Find (Ctrl K)",
        description:
          "Filter Ready documents by keyword, Knowledge Space, and file format.",
      },
      {
        icon: Files,
        title: "Library & Knowledge Spaces",
        description:
          "Organize documents across HR, Operations, and Project Atlas with processing states and versions.",
      },
    ],
    featureEyebrow: "Product capabilities",
    featureTitle: "Do more after finding the right information.",
    featureDescription:
      "Web workspace tools turn verified information into practical outputs for daily work.",
    features: [
      {
        icon: BookOpenCheck,
        title: "Inline Citation Reader",
        description:
          "Click [1]..[N] chips to inspect the exact source excerpt beside the answer and open the document.",
      },
      {
        icon: FileCheck2,
        title: "Document comparison",
        description:
          "Compare two Ready documents side by side to review Additions and Changes.",
      },
      {
        icon: Sparkles,
        title: "AI utilities (6 tasks)",
        description:
          "Summarize, Translate, Checklist, Report, Email, and Compare from selected sources before review.",
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
