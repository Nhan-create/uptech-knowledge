import type {
  DocumentId,
  FileType,
  SpaceId,
} from "@/features/knowledge/model";
import type {
  StoredDocumentChunk,
  StoredKnowledgeDocument,
} from "./repository";

/**
 * Concise verified summary of UPTECH used when Gemini answers in general
 * conversational mode without matched internal document passages.
 */
export const UPTECH_CORE_SYSTEM_SUMMARY = [
  "THÔNG TIN NỀN TẢNG VỀ UPTECH (trích từ kho nghiệp vụ UPTECH CRM / uptech-baogia):",
  "- Pháp nhân: CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ UPTECH · MST: 0316973414 · Website: uptech.vn · Email: info@uptech.vn · Hotline: 0961163961.",
  "- Địa chỉ: B2 Khu dân cư Kim Sơn, đường Nguyễn Hữu Thọ, Phường Tân Hưng, TP. Hồ Chí Minh.",
  "- Đại diện pháp luật: Trần Nguyễn Gia Huy (Giám đốc).",
  "- 3 mảng sản phẩm/dịch vụ chính: (1) Tài khoản AI & Phần mềm bản quyền (ChatGPT, Claude, Gemini, Grok, Kling AI, Dreamina Seedance, Canva, CapCut, Adobe, Microsoft 365, PDF-XChange, AI API); (2) Dịch vụ Thiết kế thương hiệu, Hồ sơ năng lực, Tài liệu bán hàng, Bao bì & Đồng hành thiết kế; (3) Thiết kế & Phát triển Website (Giới thiệu doanh nghiệp, Branding, Thương mại điện tử, Nền tảng theo yêu cầu, Landing page).",
  "- Chính sách & cam kết: Giá bán công bố là giá chưa VAT (VAT mặc định 10%); xuất hóa đơn VAT điện tử MISA meInvoice; ký hợp đồng điện tử MISA eSign; đối soát thanh toán SePay (ACB 9999746868); bảo hành 1-1 suốt thời hạn với tài khoản AI, hỗ trợ bàn giao & kích hoạt trong 30 phút sau thanh toán.",
].join("\n");

interface SeedSection {
  readonly heading: string;
  readonly locator: string;
  readonly content: string;
}

interface SeedDocSpec {
  readonly id: DocumentId;
  readonly spaceId: SpaceId;
  readonly spaceName: string;
  readonly name: string;
  readonly fileType: FileType;
  readonly versionLabel: string;
  readonly detail: string;
  readonly ownerLabel: string;
  readonly updatedLabel: string;
  readonly sections: readonly SeedSection[];
}

function buildSeedDocument(spec: SeedDocSpec): StoredKnowledgeDocument {
  const chunks: StoredDocumentChunk[] = spec.sections.map((section, idx) => ({
    chunkId: `${spec.id}-chunk-${idx}`,
    documentId: spec.id,
    chunkIndex: idx,
    heading: section.heading,
    locator: section.locator,
    content: section.content,
  }));
  const fullText = spec.sections
    .map((s) => `# ${s.heading}\n${s.content}`)
    .join("\n\n");

  return {
    summary: {
      id: spec.id,
      name: spec.name,
      fileType: spec.fileType,
      versionLabel: spec.versionLabel,
      detail: spec.detail,
      ownerLabel: spec.ownerLabel,
      updatedLabel: spec.updatedLabel,
      space: {
        id: spec.spaceId,
        name: spec.spaceName,
      },
      processing: {
        kind: "ready",
        label: "Sẵn sàng",
        description: spec.detail,
      },
      governance: [
        {
          kind: "verified",
          label: "Dữ liệu UPTECH (uptech-baogia)",
          description: spec.detail,
          variant: "success",
        },
      ],
      chunkCount: chunks.length,
    },
    versions: [
      {
        id: `${spec.id}-v1`,
        label: spec.versionLabel,
        updatedLabel: spec.updatedLabel,
      },
    ],
    isUserUploaded: false,
    byteSize: Buffer.byteLength(fullText, "utf8"),
    rawFileExtension: spec.fileType,
    chunks,
  };
}

const SEED_SPECS: readonly SeedDocSpec[] = [
  {
    id: "kb_uptech_baogia_profile_v1" as DocumentId,
    spaceId: "spc_c14d72" as SpaceId,
    spaceName: "Vận hành",
    name: "Hồ sơ pháp nhân UPTECH & Chính sách VAT, Thanh toán, Bảo hành.md",
    fileType: "md",
    versionLabel: "v1.0",
    detail: "Thông tin doanh nghiệp, tài khoản ngân hàng, VAT 10% và SLA bàn giao từ uptech-baogia",
    ownerLabel: "UPTECH CRM",
    updatedLabel: "Đồng bộ uptech-baogia",
    sections: [
      {
        heading: "Thông tin pháp nhân CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ UPTECH",
        locator: "Mục 1 · Pháp nhân & liên hệ",
        content:
          "Tên pháp nhân: CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ UPTECH. Mã số thuế (MST): 0316973414. Địa chỉ trụ sở: B2 Khu dân cư Kim Sơn, đường Nguyễn Hữu Thọ, Phường Tân Hưng, TP. Hồ Chí Minh. Hotline: 0961163961. Email chính thức: info@uptech.vn. Website: uptech.vn. Người đại diện theo pháp luật: Trần Nguyễn Gia Huy (Giám đốc).",
      },
      {
        heading: "Chính sách Thuế VAT, Hiệu lực Báo giá & Thanh toán",
        locator: "Mục 2 · VAT & thanh toán",
        content:
          "Thuế suất VAT mặc định cho chứng từ mới là 10% (thuế nhà thầu nước ngoài áp dụng mức riêng 5% khi phát sinh giao dịch nhà cung cấp ngoại). Thời hạn hiệu lực báo giá mặc định là 7 ngày kể từ ngày phát hành. Tài khoản ngân hàng nhận thanh toán chính của công ty: Ngân hàng ACB - PGD Tân Phong, Số tài khoản 9999746868, Tên chủ tài khoản CONG TY TNHH GIAI PHAP CONG NGHE UPTECH (mã BIN 970416, hỗ trợ VietQR và đối soát tự động qua SePay).",
      },
      {
        heading: "Cam kết dịch vụ & Hóa đơn, Hợp đồng điện tử",
        locator: "Mục 3 · SLA & chứng từ",
        content:
          "UPTECH cam kết xuất hóa đơn VAT điện tử đầy đủ qua MISA meInvoice và hỗ trợ ký hợp đồng điện tử qua MISA eSign. Đối với dịch vụ tài khoản AI bản quyền: bảo hành 1-1 suốt thời hạn gói đăng ký, bàn giao tài khoản và hỗ trợ kích hoạt trong vòng 30 phút sau khi hoàn tất thanh toán.",
      },
    ],
  },
  {
    id: "kb_uptech_baogia_ai_catalog_v1" as DocumentId,
    spaceId: "spc_c14d72" as SpaceId,
    spaceName: "Vận hành",
    name: "Danh mục Sản phẩm AI & Phần mềm bản quyền UPTECH.md",
    fileType: "md",
    versionLabel: "v1.0",
    detail: "5 nhóm sản phẩm AI/phần mềm, tên gói, bí danh khách hay hỏi và quy tắc kỳ hạn từ pricebook.py & catalog_sync.py",
    ownerLabel: "UPTECH CRM",
    updatedLabel: "Đồng bộ uptech-baogia",
    sections: [
      {
        heading: "5 nhóm sản phẩm trên bảng chào giá AI & Phần mềm",
        locator: "Mục 1 · Cấu trúc danh mục",
        content:
          "Bảng chào giá công cụ AI và phần mềm của UPTECH gồm 5 nhóm: (1) Chatbot AI; (2) AI tạo ảnh & video; (3) Thiết kế & dựng video; (4) Văn phòng; (5) API lập trình. Đơn vị tính thống nhất trên báo giá và hợp đồng là 'Gói'. Kỳ hạn chuẩn gồm: 1 tháng, 3 tháng, 6 tháng, 1 năm (12 tháng), Vĩnh viễn (cho gói mua một lần như PDF-XChange), và Theo hợp đồng (cho Canva Enterprise, CapCut Enterprise). Giá bán trên bảng chào giá là giá chưa bao gồm VAT.",
      },
      {
        heading: "Nhóm Chatbot AI & Từ đồng nghĩa khách hàng hay hỏi",
        locator: "Mục 2 · Chatbot AI",
        content:
          "Các sản phẩm Chatbot AI chính: ChatGPT Plus Chính chủ / Cấp mới (cũng được gọi là Chat GPT Plus, GPT Plus), ChatGPT Business workspace (cũng gọi là ChatGPT Team, ChatGPT Business, GPT Team, hỗ trợ biến thể theo số user như 5 user); Claude Pro, Claude Team Standard (Claude cho nhóm), Claude Max 5x, Claude Max 20x; Gemini Pro (cũng gọi là Google AI Pro, Gemini Advanced, Google One AI Premium) và Gemini Ultra (Google AI Ultra); Grok.",
      },
      {
        heading: "Nhóm Sáng tạo Hình ảnh/Video, Thiết kế, Văn phòng & API",
        locator: "Mục 3 · Thiết kế, Văn phòng & API",
        content:
          "Nhóm AI tạo ảnh & video: Kling AI, Dreamina Seedance. Nhóm Thiết kế & dựng video: Canva (gói Pro và Canva Enterprise theo hợp đồng dành cho doanh nghiệp cần quản trị/bảo mật), CapCut (gói Pro và CapCut Enterprise cho doanh nghiệp/agency), Adobe. Nhóm Văn phòng: Microsoft 365, PDF-XChange (kỳ hạn Vĩnh viễn / mua đứt). Nhóm API lập trình: AI API. Lưu ý: giá bán chi tiết từng kỳ hạn được đồng bộ tự động từ bảng chào giá kín UPTECH CRM; trường hợp gói Enterprise ghi 'Liên hệ' hoặc 'Theo hợp đồng' sẽ báo tay theo cấu hình user và hợp đồng riêng.",
      },
    ],
  },
  {
    id: "kb_uptech_baogia_design_catalog_v1" as DocumentId,
    spaceId: "spc_c14d72" as SpaceId,
    spaceName: "Vận hành",
    name: "Bảng giá Dịch vụ Thiết kế, Thương hiệu & Hồ sơ năng lực UPTECH.md",
    fileType: "md",
    versionLabel: "v1.0",
    detail: "Bảng giá bán chưa VAT, phạm vi bàn giao, thời gian & thanh toán dịch vụ Thiết kế và Profile từ design_catalog.py & db.py",
    ownerLabel: "UPTECH CRM",
    updatedLabel: "Đồng bộ uptech-baogia",
    sections: [
      {
        heading: "Dịch vụ Thương hiệu cốt lõi (Logo, Bộ nhận diện, Đặt tên)",
        locator: "Mục 1 · Thương hiệu cốt lõi",
        content:
          "Giá bán chưa VAT: (1) Thiết kế logo - Gói Khởi đầu: 14.900.000đ (8-12 ngày làm việc, 02 phương án, 02 vòng sửa, thanh toán 70%-30%, giao AI/PDF/SVG/PNG/JPG). (2) Thiết kế logo - Gói Phát triển (Khuyến nghị): 28.900.000đ (12-18 ngày làm việc, workshop định hướng, 03 hướng sáng tạo, 03 vòng sửa, cẩm nang logo 12-16 trang + danh thiếp, tiêu đề thư, chữ ký email; tặng 01 ảnh công bố thương hiệu nếu duyệt hướng sáng tạo lượt đầu; thanh toán 50%-30%-20%). (3) Bộ nhận diện thương hiệu - Gói Đồng bộ: 49.900.000đ (18-28 ngày làm việc, 03 hướng logo, 04 vòng sửa, key visual, cẩm nang 24-32 trang và 08 ứng dụng nhận diện; thanh toán 50%-30%-20%). (4) Tư vấn đặt tên thương hiệu: 9.900.000đ (10-15 ngày, 05 tên rút gọn, thanh toán 50%-50%). (5) Định hướng hình ảnh thương hiệu: 8.900.000đ (7-10 ngày, tài liệu 12-16 trang, thanh toán 70%-30%).",
      },
      {
        heading: "Dịch vụ Thiết kế Hồ sơ năng lực (Company Profile)",
        locator: "Mục 2 · Hồ sơ năng lực",
        content:
          "Thanh toán tiêu chuẩn 50%-50%, giá bán chưa VAT: (1) Gói Khởi đầu (tối đa 12 trang): 4.900.000đ (7-10 ngày, 02 vòng sửa, phù hợp khi đã có sẵn nội dung). (2) Gói Phát triển (tối đa 20 trang, Gói khuyến nghị): 8.900.000đ (10-15 ngày, biên tập nội dung, 02 phương án bìa, tối đa 04 infographic, 03 vòng sửa, bàn giao PDF + file nguồn, tặng 01 ảnh giới thiệu hồ sơ). (3) Gói Doanh nghiệp (tối đa 32 trang): 14.900.000đ (15-22 ngày, workshop + biên soạn chuyên sâu cho đấu thầu/B2B, tối đa 08 infographic, 04 vòng sửa, tặng bản tóm tắt 02 trang). Phát sinh thêm: Trang thiết kế bổ sung 450.000đ/trang; Trang infographic bổ sung 650.000đ/trang; Lượt chỉnh sửa bổ sung 900.000đ/lượt.",
      },
      {
        heading: "Tài liệu bán hàng & Truyền thông chiến dịch",
        locator: "Mục 3 · Sales Deck, Catalogue, Social & Sự kiện",
        content:
          "Giá bán chưa VAT: Bài thuyết trình bán hàng (Sales Deck 15 trang): 5.900.000đ (7-10 ngày, PPTX chỉnh sửa được + PDF, 70%-30%). Catalogue sản phẩm 12 trang: 6.900.000đ (8-12 ngày, 70%-30%). Catalogue sản phẩm 24 trang: 11.900.000đ (12-18 ngày, 50%-30%-20%). Brochure bán hàng 04 trang: 3.500.000đ (5-7 ngày, 70%-30%). Trang bổ sung tài liệu bán hàng: 550.000đ/trang. Hình ảnh chủ đạo chiến dịch (Key Visual): 4.900.000đ (7-10 ngày, 70%-30%). Nội dung mạng xã hội: Gói 10 thiết kế 5.900.000đ (7-12 ngày, 100% khi bắt đầu); Gói 20 thiết kế (Khuyến nghị) 9.900.000đ (12-18 ngày, 50%-50%); Bài đăng đơn lẻ 750.000đ/mẫu; Poster/banner quảng cáo 1.500.000đ/mẫu; Bộ hình ảnh sự kiện (05 hạng mục) 5.900.000đ (7-10 ngày, 70%-30%).",
      },
      {
        heading: "Thiết kế số, Bao bì, Ứng dụng văn phòng & Đồng hành thiết kế",
        locator: "Mục 4 · UI, Bao bì & Retainer",
        content:
          "Giá bán chưa VAT: Thiết kế UI Landing page bán hàng (tối đa 08 khối, desktop & mobile, Figma): 8.900.000đ (10-15 ngày, 50%-30%-20%). Thiết kế UI Website doanh nghiệp 05 trang: 16.900.000đ (15-22 ngày, 50%-30%-20%); Màn hình/trang bổ sung: 1.800.000đ/trang. Bộ nhận diện văn phòng Đồng bộ (06 hạng mục): 4.900.000đ (7-10 ngày, 70%-30%); Ứng dụng nhận diện đơn lẻ: 900.000đ/mẫu. Thiết kế bao bì Tiêu chuẩn (1 mã): 6.900.000đ (10-15 ngày, 70%-30%); Bao bì Chiến lược: 12.900.000đ (15-22 ngày, 50%-30%-20%); Biến thể mã bao bì bổ sung: 2.500.000đ/mẫu. Gói Đồng hành thiết kế theo tháng (chu kỳ 30 ngày, điểm không cộng dồn sang kỳ sau): Gói Linh hoạt 12 điểm 5.900.000đ/tháng; Gói Tăng trưởng 30 điểm (Khuyến nghị) 13.900.000đ/tháng; Gói Phòng marketing 60 điểm 24.900.000đ/tháng.",
      },
    ],
  },
  {
    id: "kb_uptech_baogia_website_catalog_v1" as DocumentId,
    spaceId: "spc_c14d72" as SpaceId,
    spaceName: "Vận hành",
    name: "Bảng giá Dịch vụ Thiết kế & Phát triển Website UPTECH.md",
    fileType: "md",
    versionLabel: "v1.0",
    detail: "Bảng giá khởi điểm, thời gian triển khai, bảo hành và phạm vi dự án Website từ WEBSITE_SERVICE_PRODUCTS",
    ownerLabel: "UPTECH CRM",
    updatedLabel: "Đồng bộ uptech-baogia",
    sections: [
      {
        heading: "Gói Website Giới thiệu doanh nghiệp & Thương hiệu",
        locator: "Mục 1 · Website Doanh nghiệp & Branding",
        content:
          "Giá khởi điểm chưa bao gồm VAT, tên miền và hosting: (1) Website Giới thiệu doanh nghiệp: từ 30.000.000đ (20-30 ngày làm việc, tối đa 05 mẫu giao diện thiết kế riêng, nhập tối đa 15 trang nội dung, CMS quản trị, GA4/Search Console/SEO kỹ thuật nền tảng, 03 vòng chỉnh sửa, 60 ngày bảo hành lỗi, tặng 01 giờ đào tạo, thanh toán 50%-50%). (2) Website Thương hiệu (Branding - Gói phổ biến): từ 50.000.000đ (30-45 ngày làm việc, art direction & storytelling, tối đa 08 mẫu giao diện thiết kế riêng, nhập tối đa 20 trang, thư viện thành phần riêng & chuyển động có chủ đích, 04 vòng chỉnh sửa, 90 ngày bảo hành lỗi, tặng 01 landing page chiến dịch + 02 giờ đào tạo, thanh toán 50%-50%).",
      },
      {
        heading: "Gói Website Thương mại điện tử & Nền tảng theo yêu cầu",
        locator: "Mục 2 · TMĐT & Nền tảng tùy chỉnh",
        content:
          "(3) Website Thương mại điện tử: từ 80.000.000đ (40-60 ngày làm việc, tối đa 08 mẫu giao diện, giỏ hàng/mã giảm giá/tài khoản khách, 01 cổng thanh toán + 01 đơn vị vận chuyển tiêu chuẩn, nhập tối đa 100 sản phẩm mẫu, 120 ngày bảo hành lỗi, tặng 02 giờ đào tạo, thanh toán 50%-50%). (4) Website Nền tảng theo yêu cầu (cổng khách hàng, quy trình nội bộ, phân quyền, tích hợp CRM/ERP): từ 120.000.000đ (từ 60 ngày làm việc, chốt giá & bảo hành sau giai đoạn khảo sát đặc tả, thanh toán 40%-30%-30%).",
      },
      {
        heading: "Landing page chiến dịch & Các hạng mục Website bổ sung",
        locator: "Mục 3 · Landing page & phát sinh",
        content:
          "(5) Website Landing page chiến dịch: từ 15.000.000đ/trang (10-15 ngày làm việc, tối đa 08 khối nội dung, form & đo lường cơ bản, 02 vòng chỉnh sửa, 30 ngày bảo hành). Hạng mục bổ sung ngoài gói: Trang nội dung bổ sung 500.000đ/trang; Mẫu giao diện bổ sung từ 3.000.000đ/mẫu (02 vòng chỉnh sửa); Ngôn ngữ bổ sung từ 6.000.000đ/ngôn ngữ (tối đa 15 trang, chưa gồm phí biên dịch); Tích hợp hệ thống ngoài (CRM/ERP/POS/API đặc thù) từ 10.000.000đ/tích hợp (chốt giá theo tài liệu kỹ thuật).",
      },
    ],
  },
  {
    id: "kb_uptech_baogia_sales_policy_v1" as DocumentId,
    spaceId: "spc_8f2a01" as SpaceId,
    spaceName: "Nhân sự",
    name: "Quy trình Báo giá CRM & Quy chế Hoa hồng Sales UPTECH.md",
    fileType: "md",
    versionLabel: "v1.0",
    detail: "Quy trình xử lý Lead – Báo giá – Thanh toán và Quy chế hoa hồng tính trên lãi gộp từ uptech-baogia",
    ownerLabel: "UPTECH CRM",
    updatedLabel: "Đồng bộ uptech-baogia",
    sections: [
      {
        heading: "Quy trình Lead → Báo giá → Đơn hàng → Thanh toán → Hóa đơn",
        locator: "Mục 1 · Vận hành Sales trên CRM",
        content:
          "Lead đi vào từ nhiều kênh (Zalo OA, Zalo cá nhân, Website, Gọi điện, Giới thiệu). Nhân viên Sales tiếp nhận/claim lead (có quy tắc chống claim nhầm, xem trước khi nhận), tư vấn nhu cầu gói dịch vụ/số người dùng/nhu cầu xuất VAT, tạo Báo giá trên CRM (có thể gửi ký điện tử qua MISA eSign), chuyển thành Đơn hàng. Khi khách chuyển khoản về tài khoản ACB 9999746868, hệ thống đối soát qua SePay hoặc sao kê ngân hàng; bộ phận vận hành/kỹ thuật cấp tài khoản trong vòng 30 phút và kế toán phát hành hóa đơn VAT qua MISA meInvoice.",
      },
      {
        heading: "Quy chế Hoa hồng Sales (tính trên Lãi gộp, hiệu lực từ 01/11/2026)",
        locator: "Mục 2 · Quy chế hoa hồng",
        content:
          "Đơn chỉ đủ điều kiện tính hoa hồng khi ĐÃ THU ĐỦ TIỀN và ĐÃ CẤP TÀI KHOẢN / BÀN GIAO; hoa hồng được chi một lần cùng kỳ lương ngày 5 hàng tháng. Công thức tính theo từng dòng đơn: Hoa hồng dòng = (Doanh thu chưa VAT sau chiết khấu − Giá vốn chuẩn) × Tỷ lệ nhóm. Mức mặc định: Khách công ty giao 10% lãi gộp; Khách tự tìm gấp đôi (20%); Đơn gia hạn bằng một nửa (5%). Riêng nhóm hàng biên cao (Nhóm C gồm Gemini, Magnific...) áp tỷ lệ riêng: 5% công ty giao, 10% tự tìm, 2,5% gia hạn. Trưởng Sales được hưởng thêm 1% lãi gộp trên các đơn nhân viên khác chốt.",
      },
      {
        heading: "Điều kiện kiểm soát & Hàng chờ Giám đốc duyệt hoa hồng",
        locator: "Mục 3 · Kiểm soát & KPI",
        content:
          "Các đơn có hoa hồng trên 2.000.000đ, đơn giảm giá thấp hơn bảng giá chuẩn, đơn thiếu giá vốn chuẩn, chưa có người đứng tên, hoặc biên lãi gộp dưới 10% doanh thu sẽ đi vào hàng chờ chủ duyệt trước khi hạch toán chi trả. Nhân viên mới được miễn KPI trong 2 tháng đầu; nếu KPI đạt dưới 50% chỉ tiêu thì phần hoa hồng được nhận giảm còn 50% theo quy chế.",
      },
    ],
  },
];

export const UPTECH_BAOGIA_SEED_DOCUMENTS: readonly StoredKnowledgeDocument[] =
  SEED_SPECS.map(buildSeedDocument);
