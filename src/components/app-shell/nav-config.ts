import {
  Bell,
  BookOpen,
  BookOpenCheck,
  FolderOpen,
  Home,
  LayoutGrid,
  MessageSquareText,
  Search,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import type { Locale } from "@/lib/preferences";

export type NavItem = Readonly<{
  id: string;
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  matchPrefixes?: readonly string[];
}>;

export type AppShellCopy = Readonly<{
  skipToContent: string;
  announceTag: string;
  announceBody: string;
  announceCta: string;
  dismissAnnounce: string;
  openNavigation: string;
  closeNavigation: string;
  dashboardLink: string;
  appNavigation: string;
  dockLabel: string;
  quickSearch: string;
  quickSearchShort: string;
  notifications: string;
  addDocument: string;
  profileLabel: string;
  prototypeTag: string;
  workspaceName: string;
  commandPlaceholder: string;
  commandEmpty: string;
  commandClose: string;
  commandRoutesGroup: string;
  commandPromptsGroup: string;
  commandRunSearch: string;
  quickAskTitle: string;
  quickAskSub: string;
  quickAskOpen: string;
  quickAskClose: string;
  quickAskPlaceholder: string;
  quickAskSend: string;
}>;

export const APP_SHELL_COPY: Readonly<Record<Locale, AppShellCopy>> = {
  vi: {
    skipToContent: "Chuyển tới nội dung chính",
    announceTag: "UPTECH Knowledge Workspace",
    announceBody:
      "Hỏi đáp AI kèm trích dẫn gốc PDF/DOCX và đối chiếu phiên bản tài liệu tức thời.",
    announceCta: "Mở Trợ lý AI →",
    dismissAnnounce: "Ẩn dải thông báo",
    openNavigation: "Mở điều hướng",
    closeNavigation: "Đóng điều hướng",
    dashboardLink: "Về tổng quan UPTECH Knowledge",
    appNavigation: "Điều hướng chính",
    dockLabel: "Thanh chuyển nhanh không gian",
    quickSearch: "Tìm nhanh tài liệu (Ctrl K)",
    quickSearchShort: "Tìm nhanh…",
    notifications: "Trung tâm thông báo",
    addDocument: "Thêm tài liệu",
    profileLabel: "Hồ sơ & bảo mật",
    prototypeTag: "Live AI",
    workspaceName: "UPTECH · Không gian tri thức",
    commandPlaceholder: "Tìm nhanh trang, tài liệu hoặc đặt câu hỏi cho Trợ lý AI…",
    commandEmpty: "Không khớp lối tắt có sẵn — nhấn Enter để tìm toàn văn trên /search.",
    commandClose: "Đóng bảng lệnh",
    commandRoutesGroup: "Không gian làm việc",
    commandPromptsGroup: "Gợi ý hỏi nhanh Trợ lý AI",
    commandRunSearch: "Tìm trong kho tri thức:",
    quickAskTitle: "Trợ lý UPTECH",
    quickAskSub: "Hỏi nhanh kèm trích dẫn gốc",
    quickAskOpen: "Hỏi nhanh Trợ lý",
    quickAskClose: "Thu gọn trợ lý nổi",
    quickAskPlaceholder: "Đặt câu hỏi về quy trình, chính sách…",
    quickAskSend: "Gửi câu hỏi",
  },
  en: {
    skipToContent: "Skip to main content",
    announceTag: "UPTECH Knowledge Workspace",
    announceBody:
      "Cited AI answers from verified PDF/DOCX sources and side-by-side document diff review.",
    announceCta: "Open AI Assistant →",
    dismissAnnounce: "Dismiss announcement bar",
    openNavigation: "Open navigation",
    closeNavigation: "Close navigation",
    dashboardLink: "Go to UPTECH Knowledge overview",
    appNavigation: "Primary navigation",
    dockLabel: "Quick workspace switcher",
    quickSearch: "Quick search & jump (Ctrl K)",
    quickSearchShort: "Quick find…",
    notifications: "Notification center",
    addDocument: "Add document",
    profileLabel: "Profile & security",
    prototypeTag: "Live AI",
    workspaceName: "UPTECH · Knowledge Workspace",
    commandPlaceholder: "Jump to a workspace view, document search, or AI prompt…",
    commandEmpty: "No direct shortcut matched — press Enter to run keyword search.",
    commandClose: "Close command palette",
    commandRoutesGroup: "Workspace views",
    commandPromptsGroup: "Suggested AI prompts",
    commandRunSearch: "Search knowledge base for:",
    quickAskTitle: "UPTECH Copilot",
    quickAskSub: "Quick answers with source citations",
    quickAskOpen: "Quick Ask AI",
    quickAskClose: "Collapse quick assistant",
    quickAskPlaceholder: "Ask about policies, workflows, handover…",
    quickAskSend: "Ask AI",
  },
};

export function getPrimaryNavItems(locale: Locale): NavItem[] {
  if (locale === "en") {
    return [
      {
        id: "dashboard",
        href: "/dashboard",
        label: "Overview",
        description: "Live workspace hub, spaces, and quick Ask AI showcase",
        icon: Home,
      },
      {
        id: "chat",
        href: "/chat",
        label: "AI Assistant",
        description: "Cited Q&A workspace with inline document evidence reader",
        icon: MessageSquareText,
      },
      {
        id: "documents",
        href: "/documents",
        label: "Library",
        description: "Indexed documents, space filters, versions, and diff compare",
        icon: FolderOpen,
        matchPrefixes: ["/documents"],
      },
      {
        id: "search",
        href: "/search",
        label: "Search",
        description: "Ready-only enterprise search across spaces & file formats",
        icon: Search,
      },
      {
        id: "knowledge",
        href: "/knowledge",
        label: "Knowledge Cards",
        description: "Decision and open-question card schema preview",
        icon: BookOpenCheck,
      },
      {
        id: "utility",
        href: "/utility",
        label: "AI Utilities",
        description: "Summarize, translate, checklist, and diff draft generator",
        icon: Sparkles,
      },
    ];
  }

  return [
    {
      id: "dashboard",
      href: "/dashboard",
      label: "Tổng quan",
      description: "Bảng điều phối hỏi đáp AI, kho tri thức và tài liệu nổi bật",
      icon: Home,
    },
    {
      id: "chat",
      href: "/chat",
      label: "Trợ lý AI",
      description: "Hỏi đáp đa nguồn kèm bảng trích dẫn và trình đọc đoạn gốc",
      icon: MessageSquareText,
    },
    {
      id: "documents",
      href: "/documents",
      label: "Thư viện",
      description: "Quản lý tài liệu theo không gian, trạng thái xử lý & Diff",
      icon: FolderOpen,
      matchPrefixes: ["/documents"],
    },
    {
      id: "search",
      href: "/search",
      label: "Tìm kiếm",
      description: "Tìm kiếm toàn văn trên nhóm tài liệu Sẵn sàng",
      icon: Search,
    },
    {
      id: "knowledge",
      href: "/knowledge",
      label: "Thẻ tri thức",
      description: "Xem trước cấu trúc Decision Card & Open Question",
      icon: BookOpenCheck,
    },
    {
      id: "utility",
      href: "/utility",
      label: "Tiện ích AI",
      description: "Tóm tắt, dịch thuật, checklist và đối chiếu hai phiên bản",
      icon: LayoutGrid,
    },
  ];
}

export function getSecondaryNavItems(locale: Locale): NavItem[] {
  if (locale === "en") {
    return [
      {
        id: "compare",
        href: "/documents/compare",
        label: "Document Diff",
        description: "Compare two ready document versions side by side",
        icon: BookOpen,
      },
      {
        id: "notifications",
        href: "/notifications",
        label: "Notifications",
        description: "Document readiness and status alerts",
        icon: Bell,
      },
      {
        id: "profile",
        href: "/profile",
        label: "Profile & Security",
        description: "Google account details and display preferences",
        icon: UserRound,
      },
    ];
  }

  return [
    {
      id: "compare",
      href: "/documents/compare",
      label: "So sánh Diff",
      description: "Đối chiếu khác biệt giữa hai phiên bản tài liệu Sẵn sàng",
      icon: BookOpen,
    },
    {
      id: "notifications",
      href: "/notifications",
      label: "Thông báo",
      description: "Theo dõi tiến độ xử lý tài liệu và trạng thái nguồn",
      icon: Bell,
    },
    {
      id: "profile",
      href: "/profile",
      label: "Hồ sơ & bảo mật",
      description: "Thông tin tài khoản Google và cài đặt hiển thị",
      icon: UserRound,
    },
  ];
}

export const QUICK_COPILOT_PROMPTS: Readonly<Record<Locale, readonly string[]>> = {
  vi: [
    "Quy trình bàn giao dự án cần chuẩn bị bước nào?",
    "Nguyên tắc đăng ký làm việc từ xa 2026 ra sao?",
  ],
  en: [
    "What steps are required in the project handover workflow?",
    "How is the 2026 remote work schedule registered?",
  ],
};

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true;
  if (item.matchPrefixes) {
    return item.matchPrefixes.some((prefix) => pathname.startsWith(`${prefix}/`));
  }
  return pathname.startsWith(`${item.href}/`);
}
