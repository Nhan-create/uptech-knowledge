"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Bell,
  Check,
  Expand,
  FileCheck2,
  FolderOpen,
  GitCompareArrows,
  LayoutDashboard,
  MessageSquareText,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";

import type { PublicInfoSection } from "@/components/landing/public-info-content";
import type { Locale } from "@/lib/preferences";

type PreviewTab = Readonly<{
  id: string;
  label: string;
  heading: string;
  route: string;
  image: string;
  imageAlt: string;
  caption: string;
  points: readonly string[];
  icon: LucideIcon;
}>;

type PreviewCopy = Readonly<{
  preview: "dashboard" | "trust" | "capabilities" | "workflow";
  eyebrow: string;
  title: string;
  purposeLabel: string;
  purpose: string;
  zoomLabel: string;
  closeZoomLabel: string;
  tabsAriaLabel: string;
  tabs: readonly PreviewTab[];
}>;

const vietnameseCopy: Record<PublicInfoSection, PreviewCopy> = {
  product: {
    preview: "dashboard",
    eyebrow: "Tổng quan workspace",
    title: "Giao diện thống nhất trên từng tab.",
    purposeLabel: "Dùng để",
    purpose:
      "Theo dõi tài liệu Sẵn sàng, hỏi Trợ lý AI và tìm kiếm ngay trên cùng một không gian.",
    zoomLabel: "Phóng to",
    closeZoomLabel: "Đóng xem ảnh lớn",
    tabsAriaLabel: "Các trang trong workspace sản phẩm",
    tabs: [
      {
        id: "dashboard",
        label: "Tổng quan",
        heading: "Tổng quan không gian tri thức",
        route: "/dashboard",
        image: "/media/workspace-previews/tab-dashboard.png",
        imageAlt:
          "Ảnh chụp tab Tổng quan không gian tri thức trên web UPTECH KNOWLEDGE",
        caption:
          "Theo dõi nhanh trạng thái lập chỉ mục và truy vấn trực tiếp nguồn Sẵn sàng.",
        points: [
          "4 chỉ số: Tài liệu Sẵn sàng, Không gian, OCR, Cần rà soát",
          "Hỏi Trợ lý AI hoặc Tìm tài liệu theo từng không gian",
          "Mở nhanh So sánh Diff và Tải tài liệu",
        ],
        icon: LayoutDashboard,
      },
      {
        id: "chat",
        label: "Trợ lý AI",
        heading: "Hỏi đáp AI kèm trích dẫn gốc",
        route: "/chat",
        image: "/media/workspace-previews/tab-chat-citations.png",
        imageAlt:
          "Ảnh chụp tab Trợ lý AI với câu trả lời và trình đọc nguồn trích dẫn",
        caption:
          "Trả lời theo phạm vi không gian đã chọn và mở ngay đoạn văn bản đối chiếu.",
        points: [
          "Chọn phạm vi Toàn workspace, Không gian hoặc tệp đính kèm",
          "Thẻ trích dẫn [1]..[N] mở Trình đọc nguồn bên phải",
          "Chỉ dùng tài liệu Sẵn sàng theo quy tắc Ready-Only",
        ],
        icon: MessageSquareText,
      },
      {
        id: "documents",
        label: "Thư viện",
        heading: "Thư viện & Không gian tri thức",
        route: "/documents",
        image: "/media/workspace-previews/tab-documents.png",
        imageAlt:
          "Ảnh chụp tab Thư viện tài liệu và Không gian tri thức trên web",
        caption:
          "Tổ chức tài liệu theo phòng ban, dự án và theo dõi tiến độ xử lý tệp.",
        points: [
          "3 Không gian: Nhân sự, Vận hành, Dự án Atlas",
          "Khu vực Thêm tài liệu và bộ lọc trạng thái OCR",
          "Liên kết trực tiếp tới So sánh Diff",
        ],
        icon: FolderOpen,
      },
      {
        id: "search",
        label: "Tìm kiếm",
        heading: "Tìm kiếm kho tri thức Sẵn sàng",
        route: "/search",
        image: "/media/workspace-previews/tab-search.png",
        imageAlt: "Ảnh chụp tab Tìm kiếm trong kho tri thức Sẵn sàng",
        caption:
          "Tra cứu toàn văn trên nguồn Sẵn sàng với bộ lọc không gian và định dạng tệp.",
        points: [
          "Lọc theo Không gian tri thức và Loại tệp",
          "Hiển thị đoạn trích khớp từ khóa và vị trí trang",
          "Mở nhanh từ mọi trang với phím tắt Ctrl K",
        ],
        icon: Search,
      },
    ],
  },
  principles: {
    preview: "trust",
    eyebrow: "Tin cậy & Ready-Only",
    title: "Minh bạch nguồn gốc và quyền truy cập.",
    purposeLabel: "Dùng để",
    purpose:
      "Kiểm tra bằng chứng ngay cạnh câu trả lời, loại trừ tệp chưa sẵn sàng và kiểm tra quyền khi mở nguồn.",
    zoomLabel: "Phóng to",
    closeZoomLabel: "Đóng xem ảnh lớn",
    tabsAriaLabel: "Các màn hình thể hiện nguyên tắc tin cậy trên web",
    tabs: [
      {
        id: "trust-chat",
        label: "Trợ lý AI · Nguồn trích dẫn",
        heading: "Nguồn trích dẫn & Ready-Only",
        route: "/chat",
        image: "/media/workspace-previews/tab-chat-citations.png",
        imageAlt:
          "Ảnh chụp tab Trợ lý AI hiển thị Phạm vi nguồn, quy tắc Ready-Only và Trình đọc nguồn trích dẫn",
        caption:
          "Luôn hiển thị rõ phạm vi nguồn đang dùng, tệp bị loại trừ và trích đoạn đối chiếu.",
        points: [
          "Hiển thị Phạm vi nguồn và trạng thái Nguồn Sẵn sàng",
          "Nêu rõ số tệp đang OCR bị loại trừ theo Ready-Only",
          "Mở trực tiếp Trang mẫu 4 trên Trình đọc nguồn trích dẫn",
        ],
        icon: MessageSquareText,
      },
      {
        id: "trust-detail",
        label: "Chi tiết nguồn & Phiên bản",
        heading: "Nhãn hiệu lực & Lịch sử phiên bản",
        route: "/documents/doc_a91f07",
        image: "/media/workspace-previews/tab-document-detail.png",
        imageAlt:
          "Ảnh chụp trang chi tiết tài liệu hiển thị trạng thái Sẵn sàng, nhãn quản trị và phiên bản",
        caption:
          "Mỗi tài liệu giữ nguyên chủ sở hữu, nhãn hiệu lực và lịch sử phiên bản.",
        points: [
          "Trạng thái Sẵn sàng cùng nhãn Official, Expiring",
          "Trích đoạn gốc gắn số trang để kiểm chứng nhanh",
          "Danh sách phiên bản (1.2, 1.1) theo mốc cập nhật",
        ],
        icon: FileCheck2,
      },
      {
        id: "trust-notifications",
        label: "Được cấp quyền · Mở đích",
        heading: "Kiểm tra quyền khi mở đích",
        route: "/notifications",
        image: "/media/workspace-previews/tab-notifications.png",
        imageAlt:
          "Ảnh chụp Trung tâm thông báo với nguyên tắc Mở đích an toàn và kiểm tra quyền",
        caption:
          "Quyền truy cập luôn được xác thực lại lúc mở thay vì phụ thuộc vào thông báo.",
        points: [
          "Theo dõi tệp vừa Sẵn sàng hoặc đang xử lý",
          "Khóa thao tác mở với đích hết hiệu lực hoặc bị thu hồi",
          "Lọc nhanh tất cả cập nhật và mục chưa đọc",
        ],
        icon: Bell,
      },
    ],
  },
  capabilities: {
    preview: "capabilities",
    eyebrow: "Năng lực trên các tab",
    title: "Tìm kiếm, hỏi đáp, đối chiếu và tạo nháp liền mạch.",
    purposeLabel: "Dùng để",
    purpose:
      "Kết nối AI Chat có trích dẫn, bộ lọc Tìm kiếm Sẵn sàng, So sánh Diff và 6 Tiện ích AI.",
    zoomLabel: "Phóng to",
    closeZoomLabel: "Đóng xem ảnh lớn",
    tabsAriaLabel: "Các tab năng lực chính trên web",
    tabs: [
      {
        id: "cap-chat",
        label: "AI Chat · Trợ lý AI",
        heading: "AI Chat kèm trình đọc trích dẫn",
        route: "/chat",
        image: "/media/workspace-previews/tab-chat-citations.png",
        imageAlt:
          "Ảnh chụp tab Trợ lý AI (AI Chat) hỏi đáp kèm trích dẫn nguồn gốc",
        caption:
          "Hỏi đáp theo từng không gian và đối chiếu câu trả lời trên đoạn văn bản gốc.",
        points: [
          "Hỏi theo Toàn workspace, Không gian hoặc tệp đính kèm",
          "Thẻ [1]..[N] liên kết thẳng tới trang tài liệu gốc",
          "Sao chép, tạo lại và lưu lịch sử hội thoại",
        ],
        icon: MessageSquareText,
      },
      {
        id: "cap-search",
        label: "Tìm kiếm",
        heading: "Tìm kiếm theo Không gian & Loại tệp",
        route: "/search",
        image: "/media/workspace-previews/tab-search.png",
        imageAlt: "Ảnh chụp tab Tìm kiếm với bộ lọc Không gian và Loại tệp",
        caption:
          "Khoanh vùng nhanh đúng tài liệu Sẵn sàng trên toàn kho tri thức.",
        points: [
          "Lọc kết hợp Không gian tri thức và định dạng tệp",
          "Xem trước đoạn trích khớp từ khóa trong kết quả",
          "Truy cập nhanh từ mọi màn hình bằng Ctrl K",
        ],
        icon: Search,
      },
      {
        id: "cap-compare",
        label: "So sánh tài liệu",
        heading: "Đối chiếu khác biệt (Diff)",
        route: "/documents/compare",
        image: "/media/workspace-previews/tab-compare.png",
        imageAlt:
          "Ảnh chụp tab So sánh tài liệu (Diff) đối chiếu Quy định làm việc từ xa và Cẩm nang quản lý",
        caption:
          "Đặt hai tài liệu Sẵn sàng cạnh nhau để nhận diện điểm bổ sung và thay đổi.",
        points: [
          "Chọn hai tài liệu Sẵn sàng cần đối chiếu",
          "Phân tách rõ mục Bổ sung và mục Thay đổi",
          "Rà soát thay đổi chính sách trước khi áp dụng",
        ],
        icon: GitCompareArrows,
      },
      {
        id: "cap-utility",
        label: "Tiện ích AI",
        heading: "6 Tiện ích AI tạo bản nháp",
        route: "/utility",
        image: "/media/workspace-previews/tab-utility.png",
        imageAlt:
          "Ảnh chụp tab Tiện ích AI với 6 tác vụ mẫu và khung bản nháp cần rà soát",
        caption:
          "Biến tài liệu đã chọn thành bản nháp cần rà soát mà không tự gửi hay xuất bản.",
        points: [
          "Tóm tắt, Dịch thuật, Checklist, Báo cáo, Email, So sánh",
          "Ghi rõ nguồn đầu vào trên mỗi bản nháp",
          "Giữ trạng thái Chờ rà soát để con người kiểm tra",
        ],
        icon: Sparkles,
      },
    ],
  },
  workflow: {
    preview: "workflow",
    eyebrow: "Quy trình qua từng tab",
    title: "Từ đưa tài liệu vào kho đến đầu ra đã kiểm chứng.",
    purposeLabel: "Dùng để",
    purpose:
      "Đi tuần tự qua các tab: Thư viện, Tìm kiếm, Trợ lý AI, So sánh Diff và Tiện ích AI.",
    zoomLabel: "Phóng to",
    closeZoomLabel: "Đóng xem ảnh lớn",
    tabsAriaLabel: "Các bước quy trình trên từng tab của web",
    tabs: [
      {
        id: "wf-documents",
        label: "01 · Tải tài liệu",
        heading: "Bước 01 · Tổ chức nguồn trong Thư viện",
        route: "/documents",
        image: "/media/workspace-previews/tab-documents.png",
        imageAlt:
          "Bước 1 quy trình: Tab Thư viện tải tài liệu và phân vào Không gian tri thức",
        caption:
          "Đưa tệp vào đúng Không gian tri thức và theo dõi quá trình xử lý tới Sẵn sàng.",
        points: [
          "Phân loại vào Nhân sự, Vận hành hoặc Dự án Atlas",
          "Theo dõi OCR và lập chỉ mục theo thời gian thực",
          "Tách biệt tệp đang xử lý khỏi nguồn trả lời AI",
        ],
        icon: FolderOpen,
      },
      {
        id: "wf-search",
        label: "02 · Chọn nguồn",
        heading: "Bước 02 · Lọc nguồn Sẵn sàng ở Tìm kiếm",
        route: "/search",
        image: "/media/workspace-previews/tab-search.png",
        imageAlt:
          "Bước 2 quy trình: Tab Tìm kiếm lọc chọn nguồn Sẵn sàng theo không gian và loại tệp",
        caption:
          "Lọc đúng bộ tài liệu Sẵn sàng theo không gian và định dạng trước khi khai thác.",
        points: [
          "Tìm từ khóa kết hợp Không gian và Loại tệp",
          "Kiểm tra đoạn trích khớp ngữ cảnh ngay tại kết quả",
          "Chỉ hiển thị tài liệu đạt trạng thái Sẵn sàng",
        ],
        icon: Search,
      },
      {
        id: "wf-chat",
        label: "03 · Kiểm tra trích dẫn",
        heading: "Bước 03 · Hỏi Trợ lý AI & mở trích dẫn",
        route: "/chat",
        image: "/media/workspace-previews/tab-chat-citations.png",
        imageAlt:
          "Bước 3 quy trình: Tab Trợ lý AI hỏi đáp và mở Trình đọc nguồn trích dẫn",
        caption:
          "Đặt câu hỏi theo phạm vi nguồn rồi bấm thẻ [1]..[N] để kiểm chứng đoạn gốc.",
        points: [
          "Giới hạn câu hỏi theo không gian hoặc tệp đính kèm",
          "Mở Trình đọc nguồn trích dẫn đối chiếu từng luận điểm",
          "Truy cập nhanh trang chi tiết và phiên bản tài liệu",
        ],
        icon: MessageSquareText,
      },
      {
        id: "wf-compare",
        label: "04 · So sánh Diff",
        heading: "Bước 04 · Đối chiếu bằng So sánh Diff",
        route: "/documents/compare",
        image: "/media/workspace-previews/tab-compare.png",
        imageAlt:
          "Bước 4 quy trình: Tab So sánh tài liệu đối chiếu thay đổi giữa hai nguồn Sẵn sàng",
        caption:
          "Đặt hai tài liệu hoặc phiên bản cạnh nhau để xác nhận điểm bổ sung và thay đổi.",
        points: [
          "Chọn hai nguồn Sẵn sàng trực tiếp từ thư viện",
          "Hiển thị rõ mục Bổ sung và mục Thay đổi",
          "Xác minh nội dung mới trước khi áp dụng",
        ],
        icon: GitCompareArrows,
      },
      {
        id: "wf-utility",
        label: "05 · Tạo bản nháp",
        heading: "Bước 05 · Tạo & rà soát ở Tiện ích AI",
        route: "/utility",
        image: "/media/workspace-previews/tab-utility.png",
        imageAlt:
          "Bước 5 quy trình: Tab Tiện ích AI tạo bản nháp Tóm tắt và rà soát trước khi dùng",
        caption:
          "Tổng hợp nguồn đã xác nhận thành bản nháp công việc và rà soát trước khi dùng.",
        points: [
          "Chọn 1 trong 6 tác vụ: Tóm tắt, Dịch, Checklist, Báo cáo…",
          "Bản nháp gắn nhãn nguồn đầu vào rõ ràng",
          "Đánh dấu Đã rà soát trước khi sử dụng",
        ],
        icon: Sparkles,
      },
    ],
  },
};

const englishCopy: Record<PublicInfoSection, PreviewCopy> = {
  product: {
    ...vietnameseCopy.product,
    eyebrow: "Workspace overview",
    title: "A unified interface across every tab.",
    purposeLabel: "Use it to",
    purpose:
      "Track Ready documents, ask the AI Assistant, and search across one connected workspace.",
    zoomLabel: "Enlarge",
    closeZoomLabel: "Close enlarged screenshot",
    tabsAriaLabel: "Workspace product tabs",
    tabs: [
      {
        id: "dashboard",
        label: "Overview",
        heading: "Knowledge workspace overview",
        route: "/dashboard",
        image: "/media/workspace-previews/tab-dashboard.png",
        imageAlt: "Screenshot of the UPTECH KNOWLEDGE Overview tab",
        caption:
          "Monitor indexing status and query Ready sources directly from the starting hub.",
        points: [
          "4 live metrics: Ready docs, Spaces, OCR, Needs Review",
          "Inline Ask AI & Search scoped by Knowledge Space",
          "Quick actions for Document Diff and Upload",
        ],
        icon: LayoutDashboard,
      },
      {
        id: "chat",
        label: "AI Assistant",
        heading: "Cited AI Q&A",
        route: "/chat",
        image: "/media/workspace-previews/tab-chat-citations.png",
        imageAlt:
          "Screenshot of the AI Assistant tab with cited answers and inline source reader",
        caption:
          "Answer questions within a chosen scope and inspect the original passage beside it.",
        points: [
          "Scope by whole workspace, Space, or attached files",
          "[1]..[N] chips open the inline Citation Reader",
          "Uses Ready documents only under Ready-Only rules",
        ],
        icon: MessageSquareText,
      },
      {
        id: "documents",
        label: "Library",
        heading: "Library & Knowledge Spaces",
        route: "/documents",
        image: "/media/workspace-previews/tab-documents.png",
        imageAlt: "Screenshot of the Document Library and Knowledge Spaces tab",
        caption:
          "Organize documents by team and project while tracking processing stages.",
        points: [
          "3 Spaces: HR, Operations, Project Atlas",
          "Document intake and OCR status filters",
          "Direct shortcut to Document Diff comparison",
        ],
        icon: FolderOpen,
      },
      {
        id: "search",
        label: "Search",
        heading: "Search across Ready knowledge",
        route: "/search",
        image: "/media/workspace-previews/tab-search.png",
        imageAlt: "Screenshot of the Enterprise Search tab across Ready files",
        caption:
          "Query Ready documents with Knowledge Space and file-type filters.",
        points: [
          "Filter by Knowledge Space and file format",
          "Displays matched snippet and page locator",
          "Global Quick Find shortcut via Ctrl K",
        ],
        icon: Search,
      },
    ],
  },
  principles: {
    ...vietnameseCopy.principles,
    eyebrow: "Trust & Ready-Only",
    title: "Visible sources and access scope in every view.",
    purposeLabel: "Use it to",
    purpose:
      "Verify evidence beside every answer, exclude unready files, and re-check access on open.",
    zoomLabel: "Enlarge",
    closeZoomLabel: "Close enlarged screenshot",
    tabsAriaLabel: "Web tabs demonstrating trust principles",
    tabs: [
      {
        id: "trust-chat",
        label: "AI Chat · Citations",
        heading: "Citations & Ready-Only",
        route: "/chat",
        image: "/media/workspace-previews/tab-chat-citations.png",
        imageAlt:
          "Screenshot of AI Assistant showing source scope, Ready-Only notice, and Citation Reader",
        caption:
          "Always shows the active source scope, excluded OCR files, and the original excerpt.",
        points: [
          "Explicit source scope and Ready source indicator",
          "Shows excluded OCR count under Ready-Only rules",
          "Opens Page 4 directly in the Citation Reader",
        ],
        icon: MessageSquareText,
      },
      {
        id: "trust-detail",
        label: "Source Detail & Versions",
        heading: "Governance labels & version history",
        route: "/documents/doc_a91f07",
        image: "/media/workspace-previews/tab-document-detail.png",
        imageAlt:
          "Screenshot of document detail view showing Ready state, governance badges, and versions",
        caption:
          "Preserves owner, Ready state, governance labels, and version history.",
        points: [
          "Ready state with Official and Expiring labels",
          "Page-numbered excerpt for rapid verification",
          "Recorded version timeline (1.2, 1.1)",
        ],
        icon: FileCheck2,
      },
      {
        id: "trust-notifications",
        label: "Safe Target Opening",
        heading: "Permission checks on open",
        route: "/notifications",
        image: "/media/workspace-previews/tab-notifications.png",
        imageAlt:
          "Screenshot of Notification Center showing Safe Target Opening permission checks",
        caption:
          "Access permissions are re-validated on click instead of trusting notifications.",
        points: [
          "Tracks newly Ready files and active jobs",
          "Locks expired or revoked targets as Cannot Open",
          "Quick filter for all or unread updates",
        ],
        icon: Bell,
      },
    ],
  },
  capabilities: {
    ...vietnameseCopy.capabilities,
    eyebrow: "Capabilities across tabs",
    title: "Search, ask, compare, and draft in one flow.",
    purposeLabel: "Use it to",
    purpose:
      "Connect Cited AI Chat, Ready-only Search filters, Document comparison, and 6 AI Utilities.",
    zoomLabel: "Enlarge",
    closeZoomLabel: "Close enlarged screenshot",
    tabsAriaLabel: "Core capability tabs in the web app",
    tabs: [
      {
        id: "cap-chat",
        label: "Cited AI Chat",
        heading: "Cited AI Chat & source reader",
        route: "/chat",
        image: "/media/workspace-previews/tab-chat-citations.png",
        imageAlt: "Screenshot of Cited AI Chat with inline source reader",
        caption:
          "Ask across selected scopes and verify every point against original text.",
        points: [
          "Query by workspace, Space, or attached files",
          "[1]..[N] chips link straight to the source page",
          "Copy, regenerate, and revisit thread history",
        ],
        icon: MessageSquareText,
      },
      {
        id: "cap-search",
        label: "Search",
        heading: "Filter by Space & file type",
        route: "/search",
        image: "/media/workspace-previews/tab-search.png",
        imageAlt: "Screenshot of Search with Space and File Type filters",
        caption:
          "Quickly isolate Ready documents across the entire knowledge catalog.",
        points: [
          "Combine Knowledge Space and format filters",
          "Preview matched keyword snippets in results",
          "Open from anywhere with Ctrl K",
        ],
        icon: Search,
      },
      {
        id: "cap-compare",
        label: "Document comparison",
        heading: "Side-by-side Document Diff",
        route: "/documents/compare",
        image: "/media/workspace-previews/tab-compare.png",
        imageAlt: "Screenshot of side-by-side Document comparison (Diff)",
        caption:
          "Compare two Ready documents side by side to review Additions and Changes.",
        points: [
          "Select left and right Ready files",
          "Separates Additions and Changes clearly",
          "Verify policy updates before rollout",
        ],
        icon: GitCompareArrows,
      },
      {
        id: "cap-utility",
        label: "AI Utilities",
        heading: "6 AI Utilities for reviewable drafts",
        route: "/utility",
        image: "/media/workspace-previews/tab-utility.png",
        imageAlt:
          "Screenshot of AI Utilities showing 6 tasks and the reviewable draft pane",
        caption:
          "Turn selected sources into editable drafts without auto-sending or publishing.",
        points: [
          "Summarize, Translate, Checklist, Report, Email, Compare",
          "Explicitly tags input sources on every draft",
          "Held in Needs Review for human sign-off",
        ],
        icon: Sparkles,
      },
    ],
  },
  workflow: {
    ...vietnameseCopy.workflow,
    eyebrow: "Tab-by-tab workflow",
    title: "From document intake to verified outputs.",
    purposeLabel: "Use it to",
    purpose:
      "Move step by step across Library, Search, AI Assistant, Document Diff, and AI Utilities.",
    zoomLabel: "Enlarge",
    closeZoomLabel: "Close enlarged screenshot",
    tabsAriaLabel: "Workflow steps across web tabs",
    tabs: [
      {
        id: "wf-documents",
        label: "01 · Add documents",
        heading: "Step 01 · Organize in Library",
        route: "/documents",
        image: "/media/workspace-previews/tab-documents.png",
        imageAlt:
          "Workflow step 1: Library tab for adding files into Knowledge Spaces",
        caption:
          "Add files into Knowledge Spaces and track processing until Ready.",
        points: [
          "Group into HR, Operations, or Project Atlas",
          "Monitor OCR and indexing stages",
          "Keep unready files out of AI retrieval",
        ],
        icon: FolderOpen,
      },
      {
        id: "wf-search",
        label: "02 · Select sources",
        heading: "Step 02 · Filter Ready files in Search",
        route: "/search",
        image: "/media/workspace-previews/tab-search.png",
        imageAlt:
          "Workflow step 2: Search tab filtering Ready sources by space and format",
        caption:
          "Filter Ready documents by Space and file format before querying.",
        points: [
          "Combine keyword, Space, and format filters",
          "Inspect matched snippets inline",
          "Returns Ready documents only",
        ],
        icon: Search,
      },
      {
        id: "wf-chat",
        label: "03 · Verify citations",
        heading: "Step 03 · Ask AI & check citations",
        route: "/chat",
        image: "/media/workspace-previews/tab-chat-citations.png",
        imageAlt:
          "Workflow step 3: AI Assistant tab with open Citation Reader for verification",
        caption:
          "Ask within scope and click [1]..[N] to inspect the original passage.",
        points: [
          "Limit scope by Space or attached files",
          "Verify every claim in the Citation Reader",
          "Jump to document details and versions",
        ],
        icon: MessageSquareText,
      },
      {
        id: "wf-compare",
        label: "04 · Compare Diff",
        heading: "Step 04 · Review changes with Diff",
        route: "/documents/compare",
        image: "/media/workspace-previews/tab-compare.png",
        imageAlt:
          "Workflow step 4: Document Diff tab comparing two Ready sources",
        caption:
          "Place two Ready documents side by side to confirm Additions and Changes.",
        points: [
          "Compare Ready files from the catalog",
          "Highlight Additions and Changes cleanly",
          "Confirm policy updates before use",
        ],
        icon: GitCompareArrows,
      },
      {
        id: "wf-utility",
        label: "05 · Draft output",
        heading: "Step 05 · Draft & review in AI Utilities",
        route: "/utility",
        image: "/media/workspace-previews/tab-utility.png",
        imageAlt:
          "Workflow step 5: AI Utilities tab generating a reviewable summary draft",
        caption:
          "Turn verified sources into an editable draft and review before use.",
        points: [
          "Pick from 6 task-focused AI Utilities",
          "Every draft labels its input sources",
          "Mark Reviewed before real-world use",
        ],
        icon: Sparkles,
      },
    ],
  },
};

export function ProductInterfacePreview({
  section,
  locale,
}: {
  readonly section: PublicInfoSection;
  readonly locale: Locale;
}) {
  const copy = (locale === "en" ? englishCopy : vietnameseCopy)[section];
  const [activeTabId, setActiveTabId] = useState(copy.tabs[0].id);
  const [zoomOpen, setZoomOpen] = useState(false);

  const activeTab =
    copy.tabs.find((tab) => tab.id === activeTabId) ?? copy.tabs[0];

  useEffect(() => {
    if (!zoomOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setZoomOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomOpen]);

  return (
    <section className="px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div
        data-product-preview={copy.preview}
        data-color-scheme="light"
        aria-label={copy.eyebrow}
        className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] border border-[#0D1321]/10 bg-gradient-to-b from-[#FFFFFF] via-[#F7F9FF] to-[#EEF1FF] p-6 text-[#0D1321] shadow-[0_32px_90px_rgba(2,6,23,0.45)] sm:p-10 lg:p-12"
      >
        <div className="flex flex-col gap-5 border-b border-[#0D1321]/10 pb-7">
          <div>
            <span className="inline-flex items-center rounded-full border border-[#C8D2FF] bg-[#EEF1FF] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#1635C7]">
              {copy.eyebrow}
            </span>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-[-0.03em] text-[#0D1321] sm:text-4xl">
              {copy.title}
            </h2>
          </div>

          <div
            role="tablist"
            aria-label={copy.tabsAriaLabel}
            className="inline-flex w-fit max-w-full flex-wrap gap-1.5 rounded-2xl border border-[#0D1321]/10 bg-[#F3F4F8] p-1.5 sm:rounded-full"
          >
            {copy.tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.id === activeTab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B44FF] sm:text-[13px] ${
                    isActive
                      ? "bg-[#1B44FF] [color:#FFFFFF] shadow-[0_6px_16px_rgba(27,68,255,0.28)]"
                      : "text-[#323B4D] hover:bg-white hover:text-[#0D1321]"
                  }`}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[0.36fr_0.64fr] lg:items-center lg:gap-10">
          <div className="flex flex-col justify-center">
            <h3 className="text-2xl font-bold tracking-[-0.025em] text-[#0D1321]">
              {activeTab.heading}
            </h3>
            <p className="mt-3 text-[15px] leading-7 text-[#505A6E]">
              {activeTab.caption}
            </p>

            <ul className="mt-5 space-y-2.5">
              {activeTab.points.map((point) => (
                <li
                  key={point}
                  className="flex items-start gap-2.5 text-sm font-medium leading-6 text-[#1E293B]"
                >
                  <span className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-[#E7F7EF] text-[#076944]">
                    <Check className="size-3" aria-hidden="true" />
                  </span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <div
              data-testid="preview-purpose"
              className="mt-6 rounded-xl border border-[#C8D2FF]/80 bg-[#EEF1FF]/75 px-4 py-3"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#1635C7]">
                {copy.purposeLabel}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#323B4D] sm:text-[13px]">
                {copy.purpose}
              </p>
            </div>
          </div>

          <div className="min-w-0">
            <button
              type="button"
              onClick={() => setZoomOpen(true)}
              aria-label={`${copy.zoomLabel}: ${activeTab.label}`}
              className="group relative block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-[#0D1321]/10 bg-white text-left shadow-[0_24px_60px_rgba(13,19,33,0.12)] transition-shadow duration-200 hover:shadow-[0_28px_70px_rgba(27,68,255,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B44FF]"
            >
              <Image
                src={activeTab.image}
                alt={activeTab.imageAlt}
                width={1140}
                height={720}
                unoptimized
                loading="eager"
                priority={activeTab.id === copy.tabs[0].id}
                className="h-auto w-full object-cover transition-transform duration-300 group-hover:scale-[1.006]"
              />
              <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-[#0D1321]/85 px-3 py-1.5 text-[11px] font-semibold [color:#FFFFFF] opacity-0 shadow-lg backdrop-blur-md transition-opacity duration-200 group-hover:opacity-100">
                <Expand className="size-3.5" aria-hidden="true" />
                {copy.zoomLabel}
              </span>
            </button>
          </div>
        </div>
      </div>

      {zoomOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={activeTab.imageAlt}
          onClick={() => setZoomOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1220]/80 p-4 backdrop-blur-sm sm:p-6"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="relative w-full max-w-6xl overflow-hidden rounded-2xl border border-[#0D1321]/15 bg-white text-[#0D1321] shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#0D1321]/10 bg-[#F7F9FF] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-bold text-[#0D1321]">
                  {activeTab.heading}
                </span>
                <span className="rounded-md border border-[#C8D2FF] bg-[#EEF1FF] px-2 py-0.5 font-mono text-xs text-[#1635C7]">
                  {activeTab.route}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setZoomOpen(false)}
                aria-label={copy.closeZoomLabel}
                className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-[#0D1321]/10 bg-white text-[#323B4D] hover:bg-[#F3F4F8] hover:text-[#0D1321] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B44FF]"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[82dvh] overflow-auto bg-[#EEF1FF]/60 p-3 sm:p-5">
              <Image
                src={activeTab.image}
                alt={activeTab.imageAlt}
                width={1140}
                height={720}
                unoptimized
                className="mx-auto h-auto w-full rounded-xl shadow-lg ring-1 ring-[#0D1321]/10"
              />
            </div>
            <div className="border-t border-[#0D1321]/10 bg-[#F7F9FF] px-4 py-3 text-xs leading-6 text-[#505A6E] sm:text-sm">
              {activeTab.caption}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
