import type { Locale } from "@/lib/preferences";

const shared = {
  vi: {
    hero: {
      badge: "Trợ lý tri thức AI dành cho doanh nghiệp",
      title: "Bộ não tri thức dành cho doanh nghiệp",
      description: "Tìm kiếm tức thì, giải đáp chính xác và liên kết trực tiếp tới tài liệu gốc, đồng thời bảo vệ dữ liệu theo quyền hạn của từng nhân sự.",
      productCta: "Xem sản phẩm hoạt động",
      trust: ["Nguồn có thể mở", "Theo phạm vi quyền", "Nêu rõ khi thiếu dữ liệu"],
    },
    preview: {
      aria: "Bản mô phỏng câu trả lời có trích dẫn",
      demo: "Bản mô phỏng",
      sources: "Nguồn đang dùng",
      sourceOneMeta: "Phòng Vận hành · 12 trang",
      sourceTwoMeta: "Phòng Tài chính · 4 sheet",
      permitted: "2 nguồn trong phạm vi quyền",
      prompt: "Quy trình phê duyệt hợp đồng có giá trị trên 500 triệu đồng là gì?",
      verified: "Có nguồn kiểm chứng",
      answerOne: "Với hợp đồng trên 500 triệu đồng, hồ sơ cần được rà soát ngân sách và pháp lý trước khi trình cấp có thẩm quyền phê duyệt.",
      answerTwo: "Hồ sơ trình duyệt gồm đề xuất mua sắm, báo giá hợp lệ, biên bản lựa chọn và dự thảo hợp đồng.",
      citationOne: "Trang 8 · Mục 3.2",
      citationTwo: "Sheet Phê duyệt · Dòng 18",
    },
    trustSection: {
      eyebrow: "Niềm tin ngay từ thiết kế",
      title: "AI hữu ích bắt đầu từ niềm tin vào nguồn.",
      description: "Không chỉ tạo một câu trả lời nghe hợp lý. UPTECH KNOWLEDGE giúp người dùng hiểu câu trả lời đến từ đâu, dùng dữ liệu nào và còn thiếu điều gì.",
    },
    capabilitySection: {
      eyebrow: "Một nơi cho tri thức",
      title: "Từ tài liệu rời rạc đến câu trả lời có thể hành động.",
      description: "Một trải nghiệm thống nhất để nhân viên tìm kiếm, đặt câu hỏi và tiếp tục làm việc với nguồn gốc của thông tin.",
    },
    workflowSection: {
      eyebrow: "Từ nguồn đến quyết định",
      title: "Một quy trình rõ ràng, khép kín và có thể kiểm chứng.",
      description: "Mỗi bước đều giữ nguyên ngữ cảnh nguồn và phạm vi quyền của người dùng.",
    },
    cta: {
      eyebrow: "Sẵn sàng trải nghiệm",
      title: "Đưa tri thức quan trọng tới đúng người, đúng lúc.",
      description: "Khám phá cách UPTECH KNOWLEDGE biến tài liệu doanh nghiệp thành câu trả lời nhanh, rõ nguồn và an toàn theo quyền.",
      secondary: "Tìm hiểu sản phẩm",
    },
    footer: {
      homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
      skipToContent: "Đi đến nội dung chính",
      description: "Trợ lý tri thức AI giúp doanh nghiệp tìm kiếm, hỏi đáp và kiểm chứng thông tin từ đúng nguồn được phép.",
      navigationLabel: "Điều hướng chân trang",
      product: "Sản phẩm",
      principles: "Nguyên tắc",
      workflow: "Quy trình",
      signIn: "Đăng nhập",
      prototype: "© 2026 UPTECH. Bản mẫu trải nghiệm sản phẩm.",
      trustLine: "Có căn cứ · Có thể kiểm chứng · Theo đúng quyền",
    },
  },
  en: {
    hero: {
      badge: "Enterprise AI knowledge assistant",
      title: "The knowledge brain for your enterprise",
      description: "Search instantly, get grounded answers, open the original evidence, and keep every result within each employee’s permissions.",
      productCta: "See the product in action",
      trust: ["Openable sources", "Permission-aware", "Clear when evidence is missing"],
    },
    preview: {
      aria: "A product preview of an answer with citations",
      demo: "Product preview",
      sources: "Sources in use",
      sourceOneMeta: "Operations · 12 pages",
      sourceTwoMeta: "Finance · 4 sheets",
      permitted: "2 sources within your access scope",
      prompt: "What is the approval process for contracts above VND 500 million?",
      verified: "Grounded in sources",
      answerOne: "Contracts above VND 500 million require budget and legal review before submission to the authorized approver.",
      answerTwo: "The approval package includes the purchase proposal, valid quotations, selection record, and draft contract.",
      citationOne: "Page 8 · Section 3.2",
      citationTwo: "Approval sheet · Row 18",
    },
    trustSection: {
      eyebrow: "Trust by design",
      title: "Trust starts with visible evidence.",
      description: "UPTECH KNOWLEDGE does more than produce a plausible answer. It shows where an answer came from, which data it used, and what evidence is still missing.",
    },
    capabilitySection: {
      eyebrow: "One place for knowledge",
      title: "From scattered documents to actionable answers.",
      description: "A unified experience where employees can search, ask, verify, and continue working from the original information.",
    },
    workflowSection: {
      eyebrow: "From source to decision",
      title: "A clear, closed-loop, verifiable workflow.",
      description: "Every step preserves source context and the user’s permission scope.",
    },
    cta: {
      eyebrow: "Ready to explore",
      title: "Put important knowledge in the right hands at the right time.",
      description: "See how UPTECH KNOWLEDGE turns enterprise documents into fast, grounded, permission-aware answers.",
      secondary: "Explore the product",
    },
    footer: {
      homeLabel: "UPTECH KNOWLEDGE - Home",
      skipToContent: "Skip to main content",
      description: "An AI knowledge assistant that helps organizations search, ask, and verify information from the right permitted sources.",
      navigationLabel: "Footer navigation",
      product: "Product",
      principles: "Principles",
      workflow: "Workflow",
      signIn: "Sign in",
      prototype: "© 2026 UPTECH. Product experience prototype.",
      trustLine: "Grounded · Verifiable · Permission-aware",
    },
  },
} as const;

const localizedCards = {
  vi: {
    trust: [
      ["Theo đúng quyền", "Nguồn được phép mới đi vào câu trả lời.", "Phạm vi workspace và quyền tài liệu được giữ xuyên suốt quá trình tìm kiếm, hỏi đáp và mở nguồn."],
      ["Có thể kiểm chứng", "Mỗi kết luận luôn đi cùng ngữ cảnh nguồn.", "Tên tài liệu, vị trí và đoạn liên quan giúp người đọc kiểm tra thông tin thay vì chỉ tin vào AI."],
      ["Không suy đoán", "Thiếu bằng chứng, hệ thống nói rõ.", "Câu trả lời phân biệt dữ kiện có nguồn với phần chưa đủ cơ sở để đội ngũ ra quyết định an toàn hơn."],
    ],
    capabilities: [
      ["Hỏi toàn bộ kho tri thức", "Đặt câu hỏi bằng ngôn ngữ tự nhiên và nhận câu trả lời tổng hợp từ những tài liệu bạn được phép xem.", "AI chat · Trích dẫn · Cảnh báo thiếu dữ liệu"],
      ["Tìm đúng, không chỉ tìm giống", "Kết hợp từ khoá và ngữ nghĩa để tìm chính sách, hợp đồng hay quy trình dù cách diễn đạt không hoàn toàn trùng khớp.", "Toàn văn · Ngữ nghĩa · Bộ lọc theo nguồn"],
      ["Biến tài liệu thành tri thức dùng được", "Tổ chức nguồn theo phòng ban, dự án hoặc khách hàng; tóm tắt, so sánh và tạo đầu ra nháp từ đúng tài liệu.", "Không gian tri thức · Phiên bản · AI utilities"],
    ],
    workflow: [
      ["Tập trung nguồn", "Đưa tài liệu và nguồn được phê duyệt về đúng workspace."],
      ["Giữ nguyên quyền", "Gắn phạm vi truy cập trước khi nội dung được xử lý và lập chỉ mục."],
      ["Tìm hoặc hỏi", "Truy xuất bằng từ khoá, ý nghĩa hoặc một câu hỏi tự nhiên."],
      ["Mở nguồn kiểm chứng", "Đi từ câu trả lời đến đúng tài liệu và vị trí liên quan."],
    ],
  },
  en: {
    trust: [
      ["Permission-aware", "Only permitted sources enter an answer.", "Workspace and document access remain enforced across search, chat, and source viewing."],
      ["Verifiable", "Every conclusion carries its source context.", "Document names, locations, and relevant passages let people verify information instead of simply trusting AI."],
      ["No guesswork", "When evidence is missing, the system says so.", "Answers separate grounded facts from unsupported gaps so teams can make safer decisions."],
    ],
    capabilities: [
      ["Ask your entire knowledge base", "Use natural language to get an answer synthesized from documents you are allowed to access.", "AI chat · Citations · Missing-evidence alerts"],
      ["Find meaning, not just matching words", "Combine keyword and semantic search to locate policies, contracts, and procedures even when wording differs.", "Full text · Semantic search · Source filters"],
      ["Turn documents into working knowledge", "Organize sources by team, project, or customer, then summarize, compare, and draft from the right evidence.", "Knowledge spaces · Versions · AI utilities"],
    ],
    workflow: [
      ["Centralize sources", "Bring approved documents and connected sources into the right workspace."],
      ["Preserve permissions", "Apply access scope before content is processed and indexed."],
      ["Search or ask", "Retrieve by keyword, meaning, or a natural-language question."],
      ["Open and verify", "Move from the answer to the exact document and relevant location."],
    ],
  },
} as const;

export function getHomeContent(locale: Locale) {
  return { ...shared[locale], ...localizedCards[locale] };
}

export type HomeContent = ReturnType<typeof getHomeContent>;
