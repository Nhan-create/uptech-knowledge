import {
  fixtureDocumentId,
  fixtureSpaceId,
  type DocumentId,
  type FileType,
  type GovernanceMarker,
  type ProcessingState,
  type SpaceId,
} from "@/features/knowledge/model";

export type FixtureSpaceRecord = Readonly<{
  id: SpaceId;
  name: string;
  description: string;
}>;

export type FixtureDocumentRecord = Readonly<{
  id: DocumentId;
  name: string;
  fileType: FileType;
  versionLabel: string;
  detail: string;
  ownerLabel: string;
  updatedLabel: string;
  spaceId: SpaceId;
  processing: ProcessingState;
  governance: readonly GovernanceMarker[];
  searchText: string;
  searchSnippet: string;
  locator: string;
  previewHeading: string;
  previewExcerpt: string;
  versions: readonly Readonly<{
    id: string;
    label: string;
    updatedLabel: string;
  }>[];
}>;

const governance = {
  official: {
    kind: "official",
    label: "Official",
    description: "Nhãn nguồn chính thức chỉ dùng cho fixture UI.",
    variant: "info",
  },
  verified: {
    kind: "verified",
    label: "Verified",
    description: "Nhãn đã xác minh chỉ dùng cho fixture UI.",
    variant: "success",
  },
  needsReview: {
    kind: "needs-review",
    label: "Needs Review",
    description: "Nhãn cần xem lại chỉ dùng cho fixture UI.",
    variant: "warning",
  },
  expiring: {
    kind: "expiring",
    label: "Expiring",
    description: "Nhãn sắp hết hạn chỉ dùng cho fixture UI.",
    variant: "warning",
  },
  expired: {
    kind: "expired",
    label: "Expired",
    description: "Nhãn hết hạn chỉ dùng cho fixture UI.",
    variant: "danger",
  },
  deprecated: {
    kind: "deprecated",
    label: "Deprecated",
    description: "Nhãn không còn được khuyến nghị chỉ dùng cho fixture UI.",
    variant: "neutral",
  },
} as const satisfies Record<string, GovernanceMarker>;

const processing = {
  uploading: (progress: number): ProcessingState => ({
    kind: "uploading",
    label: "Đang tải lên",
    description: "Fixture đang chọn/truyền tệp; chưa có upload transport hay lưu trữ.",
    progress,
  }),
  validating: (progress: number): ProcessingState => ({
    kind: "validating",
    label: "Đang kiểm tra",
    description: "Fixture đang kiểm tra định dạng; chưa có xác nhận từ server.",
    progress,
  }),
  extracting: (progress: number): ProcessingState => ({
    kind: "extracting",
    label: "Đang đọc nội dung",
    description: "Fixture đang phân tích nội dung và chưa thể dùng cho truy xuất.",
    progress,
  }),
  ocr: (progress: number): ProcessingState => ({
    kind: "ocr",
    label: "Đang OCR",
    description: "Fixture đang nhận dạng ký tự và chưa thể dùng cho truy xuất.",
    progress,
  }),
  indexing: (progress: number): ProcessingState => ({
    kind: "indexing",
    label: "Đang lập chỉ mục",
    description: "Fixture đang tạo chỉ mục và chưa được coi là sẵn sàng.",
    progress,
  }),
  ready: {
    kind: "ready",
    label: "Sẵn sàng",
    description: "Sẵn sàng trong catalog fixture; backend chưa xác nhận trạng thái này.",
  },
  failed: {
    kind: "failed",
    label: "Thất bại",
    description: "Fixture lỗi xử lý; chưa có worker hoặc hành động thử lại thật.",
  },
} as const;

export const FIXTURE_SPACES = [
  {
    id: fixtureSpaceId("spc_8f2a01"),
    name: "Nhân sự",
    description: "Chính sách, cẩm nang và biểu mẫu nội bộ mẫu.",
  },
  {
    id: fixtureSpaceId("spc_c14d72"),
    name: "Vận hành",
    description: "Quy trình, checklist và hướng dẫn dự kiến.",
  },
  {
    id: fixtureSpaceId("spc_6be903"),
    name: "Dự án Atlas",
    description: "Tài liệu bàn giao và kế hoạch của dự án giả lập.",
  },
] as const satisfies readonly FixtureSpaceRecord[];

const [peopleSpace, operationsSpace, atlasSpace] = FIXTURE_SPACES;

export const FIXTURE_DOCUMENTS = [
  {
    id: fixtureDocumentId("doc_a91f07"),
    name: "Quy định làm việc từ xa 2026.pdf",
    fileType: "pdf",
    versionLabel: "Phiên bản mẫu 1.2",
    detail: "PDF · Phiên bản mẫu 1.2",
    ownerLabel: "Nhóm People Ops (mẫu)",
    updatedLabel: "18/08/2026",
    spaceId: peopleSpace.id,
    processing: processing.ready,
    governance: [governance.official, governance.expiring],
    searchText:
      "quy định làm việc từ xa đăng ký lịch theo tuần quản lý trực tiếp bảo mật ngoài văn phòng",
    searchSnippet:
      "Nhân sự có thể đăng ký lịch làm việc từ xa theo chu kỳ tuần, sau khi thống nhất với quản lý trực tiếp…",
    locator: "Trang mẫu 4",
    previewHeading: "Nguyên tắc đăng ký làm việc từ xa",
    previewExcerpt:
      "Lịch làm việc từ xa cần được thống nhất theo chu kỳ tuần và không thay đổi nghĩa vụ bảo mật thông tin của nhân sự.",
    versions: [
      { id: "ver_a91f07_12", label: "1.2 · fixture", updatedLabel: "18/08/2026" },
      { id: "ver_a91f07_11", label: "1.1 · fixture", updatedLabel: "02/07/2026" },
    ],
  },
  {
    id: fixtureDocumentId("doc_b40c22"),
    name: "Cẩm nang quản lý đội nhóm.docx",
    fileType: "docx",
    versionLabel: "Phiên bản mẫu 1.1",
    detail: "DOCX · Phiên bản mẫu 1.1",
    ownerLabel: "PMO (mẫu)",
    updatedLabel: "17/08/2026",
    spaceId: peopleSpace.id,
    processing: processing.ready,
    governance: [governance.verified],
    searchText:
      "cẩm nang quản lý đội nhóm cộng tác làm việc phân tán làm việc từ xa kết quả hỗ trợ",
    searchSnippet:
      "Quản lý cần thống nhất khung giờ cộng tác, cách ghi nhận kết quả và kênh hỗ trợ cho thành viên làm việc phân tán…",
    locator: "Mục mẫu 2.3",
    previewHeading: "Phối hợp đội nhóm phân tán",
    previewExcerpt:
      "Quản lý thống nhất khung giờ cộng tác, đầu ra mong đợi và kênh hỗ trợ trước khi áp dụng lịch làm việc phân tán.",
    versions: [
      { id: "ver_b40c22_11", label: "1.1 · fixture", updatedLabel: "17/08/2026" },
    ],
  },
  {
    id: fixtureDocumentId("doc_c72d15"),
    name: "Hỏi đáp chính sách nhân sự.md",
    fileType: "md",
    versionLabel: "Phiên bản mẫu 2.0",
    detail: "Markdown · Phiên bản mẫu 2.0",
    ownerLabel: "Knowledge Team (mẫu)",
    updatedLabel: "19/08/2026",
    spaceId: peopleSpace.id,
    processing: processing.indexing(86),
    governance: [governance.needsReview],
    searchText: "hỏi đáp chính sách nhân sự đăng ký thay đổi lịch bảo mật làm việc từ xa",
    searchSnippet: "",
    locator: "Đoạn mẫu 12",
    previewHeading: "Nội dung chưa sẵn sàng",
    previewExcerpt: "",
    versions: [
      { id: "ver_c72d15_20", label: "2.0 · fixture", updatedLabel: "19/08/2026" },
    ],
  },
  {
    id: fixtureDocumentId("doc_d18e43"),
    name: "Sổ tay nhân sự 2026.pdf",
    fileType: "pdf",
    versionLabel: "Phiên bản mẫu 1.0",
    detail: "PDF · Phiên bản mẫu 1.0",
    ownerLabel: "People Ops (mẫu)",
    updatedLabel: "23/08/2026",
    spaceId: peopleSpace.id,
    processing: processing.uploading(24),
    governance: [governance.needsReview],
    searchText: "sổ tay nhân sự 2026",
    searchSnippet: "",
    locator: "Chưa có vị trí",
    previewHeading: "Nội dung chưa sẵn sàng",
    previewExcerpt: "",
    versions: [
      { id: "ver_d18e43_10", label: "1.0 · fixture", updatedLabel: "23/08/2026" },
    ],
  },
  {
    id: fixtureDocumentId("doc_e39b80"),
    name: "Cẩm nang vận hành nội bộ.pdf",
    fileType: "pdf",
    versionLabel: "Bản fixture đang xử lý",
    detail: "PDF · 8,4 MB · Fixture xử lý cục bộ",
    ownerLabel: "Vận hành (mẫu)",
    updatedLabel: "23/08/2026",
    spaceId: operationsSpace.id,
    processing: processing.ocr(68),
    governance: [governance.needsReview],
    searchText: "cẩm nang vận hành nội bộ",
    searchSnippet: "",
    locator: "Chưa có vị trí",
    previewHeading: "Nội dung chưa sẵn sàng",
    previewExcerpt: "",
    versions: [],
  },
  {
    id: fixtureDocumentId("doc_f51a26"),
    name: "Checklist nghiệm thu nội bộ.docx",
    fileType: "docx",
    versionLabel: "Phiên bản mẫu 1.4",
    detail: "DOCX · Phiên bản mẫu 1.4",
    ownerLabel: "Dự án Atlas (mẫu)",
    updatedLabel: "16/08/2026",
    spaceId: atlasSpace.id,
    processing: processing.validating(42),
    governance: [governance.needsReview],
    searchText: "checklist nghiệm thu nội bộ quyền truy cập tài liệu hỗ trợ",
    searchSnippet: "",
    locator: "Chưa có vị trí",
    previewHeading: "Nội dung chưa sẵn sàng",
    previewExcerpt: "",
    versions: [
      { id: "ver_f51a26_14", label: "1.4 · fixture", updatedLabel: "16/08/2026" },
    ],
  },
  {
    id: fixtureDocumentId("doc_07ac64"),
    name: "Quy trình bàn giao dự án.pdf",
    fileType: "pdf",
    versionLabel: "Phiên bản mẫu 2.1",
    detail: "PDF · Phiên bản mẫu 2.1",
    ownerLabel: "Dự án Atlas (mẫu)",
    updatedLabel: "20/08/2026",
    spaceId: atlasSpace.id,
    processing: processing.extracting(56),
    governance: [governance.needsReview],
    searchText: "quy trình bàn giao dự án biên bản tài sản đầu việc quyền truy cập",
    searchSnippet: "",
    locator: "Chưa có vị trí",
    previewHeading: "Nội dung chưa sẵn sàng",
    previewExcerpt: "",
    versions: [
      { id: "ver_07ac64_21", label: "2.1 · fixture", updatedLabel: "20/08/2026" },
    ],
  },
  {
    id: fixtureDocumentId("doc_19de58"),
    name: "Hướng dẫn vận hành dự án.pdf",
    fileType: "pdf",
    versionLabel: "Phiên bản mẫu 3.0",
    detail: "PDF · Phiên bản mẫu 3.0",
    ownerLabel: "PMO (mẫu)",
    updatedLabel: "21/08/2026",
    spaceId: atlasSpace.id,
    processing: processing.ready,
    governance: [governance.deprecated],
    searchText: "hướng dẫn vận hành dự án đầu việc người phụ trách thời hạn",
    searchSnippet:
      "Các điểm chưa thống nhất được ghi thành hành động tiếp theo, kèm người phụ trách và thời hạn dự kiến…",
    locator: "Trang mẫu 14",
    previewHeading: "Theo dõi đầu việc sau bàn giao",
    previewExcerpt:
      "Điểm chưa thống nhất được ghi thành hành động tiếp theo, kèm người phụ trách và thời hạn dự kiến.",
    versions: [
      { id: "ver_19de58_30", label: "3.0 · fixture", updatedLabel: "21/08/2026" },
      { id: "ver_19de58_22", label: "2.2 · fixture", updatedLabel: "10/06/2026" },
    ],
  },
  {
    id: fixtureDocumentId("doc_2ad977"),
    name: "Biên bản họp dự án cũ.pdf",
    fileType: "pdf",
    versionLabel: "Bản fixture lỗi",
    detail: "PDF · Cảnh báo định dạng mẫu",
    ownerLabel: "Dự án Atlas (mẫu)",
    updatedLabel: "14/08/2026",
    spaceId: atlasSpace.id,
    processing: processing.failed,
    governance: [governance.expired],
    searchText: "biên bản họp dự án cũ",
    searchSnippet: "",
    locator: "Chưa có vị trí",
    previewHeading: "Nội dung không khả dụng",
    previewExcerpt: "",
    versions: [],
  },
] as const satisfies readonly FixtureDocumentRecord[];
