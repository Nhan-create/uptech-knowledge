"use client";

import {
  Bell,
  BookOpen,
  Building2,
  CircleHelp,
  Files,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Search as SearchIcon,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import Logo from "@/components/Logo";
import { usePreferences } from "@/components/preferences/PreferencesProvider";
import { requestPreferencesClose } from "@/components/preferences/preferences-events";
import type { Locale } from "@/lib/preferences";
import { cn } from "@/lib/utils";

type AppShellProps = Readonly<{
  children: ReactNode;
}>;

type NavigationItem = Readonly<{
  href: string;
  label: Readonly<Record<Locale, string>>;
  description: Readonly<Record<Locale, string>>;
  icon: LucideIcon;
}>;

type AppShellCopy = Readonly<{
  prototype: string;
  demoSpace: string;
  currentWorkspace: string;
  workspace: string;
  demoData: string;
  primaryNavigation: string;
  prototypeInterface: string;
  prototypeDescription: string;
  appNavigation: string;
  dashboardLink: string;
  closeNavigation: string;
  navigationMenu: string;
  closeMenu: string;
  openNavigation: string;
  globalSearch: string;
  searchPlaceholder: string;
  notifications: string;
  help: string;
  profile: string;
  skipNavigation: string;
}>;

const appShellCopy: Readonly<Record<Locale, AppShellCopy>> = {
  vi: {
    prototype: "Bản mẫu",
    demoSpace: "Không gian minh hoạ",
    currentWorkspace: "Không gian làm việc hiện tại",
    workspace: "Không gian làm việc",
    demoData: "Dữ liệu mẫu",
    primaryNavigation: "Điều hướng chính",
    prototypeInterface: "Giao diện thử nghiệm",
    prototypeDescription:
      "Nội dung và trạng thái đang hiển thị chỉ dùng để minh hoạ UI.",
    appNavigation: "Thanh điều hướng ứng dụng",
    dashboardLink: "UPTECH Knowledge — về Tổng quan",
    closeNavigation: "Đóng menu điều hướng",
    navigationMenu: "Menu điều hướng",
    closeMenu: "Đóng menu",
    openNavigation: "Mở menu điều hướng",
    globalSearch: "Tìm kiếm toàn cục — phím tắt Ctrl hoặc Command K",
    searchPlaceholder: "Tìm trong không gian...",
    notifications: "Mở thông báo",
    help: "Mở trợ giúp",
    profile: "Mở hồ sơ An Nguyễn — dữ liệu mẫu",
    skipNavigation: "Bỏ qua điều hướng",
  },
  en: {
    prototype: "Prototype",
    demoSpace: "Demo workspace",
    currentWorkspace: "Current workspace",
    workspace: "Workspace",
    demoData: "Demo data",
    primaryNavigation: "Primary navigation",
    prototypeInterface: "Prototype interface",
    prototypeDescription:
      "The content and states shown here are for UI demonstration only.",
    appNavigation: "Application navigation",
    dashboardLink: "UPTECH Knowledge — go to Overview",
    closeNavigation: "Close navigation menu",
    navigationMenu: "Navigation menu",
    closeMenu: "Close menu",
    openNavigation: "Open navigation menu",
    globalSearch: "Global search — keyboard shortcut Control or Command K",
    searchPlaceholder: "Search this workspace...",
    notifications: "Open notifications",
    help: "Open help",
    profile: "Open An Nguyen's profile — demo data",
    skipNavigation: "Skip navigation",
  },
};

const navigationItems: readonly NavigationItem[] = [
  {
    href: "/dashboard",
    label: { vi: "Tổng quan", en: "Overview" },
    description: { vi: "Hoạt động và lối tắt", en: "Activity and shortcuts" },
    icon: LayoutDashboard,
  },
  {
    href: "/chat",
    label: { vi: "Trợ lý AI", en: "AI assistant" },
    description: { vi: "Hỏi đáp cùng nguồn trích dẫn", en: "Answers with citations" },
    icon: MessageSquareText,
  },
  {
    href: "/search",
    label: { vi: "Tìm kiếm", en: "Search" },
    description: { vi: "Khám phá tri thức nội bộ", en: "Explore internal knowledge" },
    icon: SearchIcon,
  },
  {
    href: "/documents",
    label: { vi: "Tài liệu", en: "Documents" },
    description: { vi: "Thư viện và không gian tri thức", en: "Library and knowledge spaces" },
    icon: Files,
  },
  {
    href: "/knowledge",
    label: { vi: "Thẻ tri thức", en: "Knowledge cards" },
    description: {
      vi: "Cards & Packs · bản mẫu",
      en: "Cards & Packs · prototype",
    },
    icon: BookOpen,
  },
  {
    href: "/utility",
    label: { vi: "Tiện ích AI", en: "AI utilities" },
    description: { vi: "Tóm tắt, dịch và soạn nội dung", en: "Summarize, translate, and draft" },
    icon: Sparkles,
  },
];

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function PrototypeBadge({
  compact = false,
  copy,
}: {
  compact?: boolean;
  copy: AppShellCopy;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-violet-400/25 bg-violet-400/10 font-semibold uppercase tracking-[0.12em] text-violet-200",
        compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1 text-xs",
      )}
    >
      {copy.prototype}
    </span>
  );
}

function WorkspaceContext({
  compact = false,
  copy,
}: {
  compact?: boolean;
  copy: AppShellCopy;
}) {
  if (compact) {
    return (
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-100">
          UPTECH Knowledge
        </p>
        <p className="truncate text-xs text-slate-400">{copy.demoSpace}</p>
      </div>
    );
  }

  return (
    <div
      className="flex min-w-0 items-center gap-3"
      aria-label={copy.currentWorkspace}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10 text-blue-200">
        <Building2 className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-400">
          {copy.workspace}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-100">
            UPTECH Knowledge
          </span>
          <span className="shrink-0 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
            {copy.demoData}
          </span>
        </span>
      </span>
    </div>
  );
}

function PrimaryNavigation({
  pathname,
  onNavigate,
  labelledBy,
  locale,
  copy,
}: {
  pathname: string;
  onNavigate?: () => void;
  labelledBy: string;
  locale: Locale;
  copy: AppShellCopy;
}) {
  return (
    <nav aria-labelledby={labelledBy}>
      <p
        id={labelledBy}
        className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
      >
        {copy.primaryNavigation}
      </p>
      <ul className="space-y-1.5">
        {navigationItems.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "group relative flex min-h-12 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-slate-300 transition-[background-color,color,box-shadow] duration-150",
                  "hover:bg-slate-800/70 hover:text-white active:bg-slate-800",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
                  active &&
                    "bg-gradient-to-r from-blue-500/20 to-violet-500/10 text-slate-100 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.22)]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-transparent",
                    active && "bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.75)]",
                  )}
                />
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 group-hover:text-blue-200",
                    active && "bg-blue-400/10 text-blue-200",
                  )}
                >
                  <Icon className="size-5" strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {item.label[locale]}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block truncate text-xs text-slate-400 transition-colors duration-150 group-hover:text-slate-300",
                      active && "text-slate-400",
                    )}
                  >
                    {item.description[locale]}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function PrototypeNotice({ copy }: { copy: AppShellCopy }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3.5">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-400/10 text-violet-200">
          <ShieldCheck className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-200">
            {copy.prototypeInterface}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            {copy.prototypeDescription}
          </p>
        </div>
      </div>
    </div>
  );
}

function Sidebar({
  pathname,
  locale,
  copy,
}: {
  pathname: string;
  locale: Locale;
  copy: AppShellCopy;
}) {
  return (
    <aside
      className="sticky top-0 z-20 hidden h-dvh w-72 shrink-0 flex-col border-r border-slate-800/80 bg-slate-950/90 px-4 py-5 shadow-[18px_0_60px_-32px_rgba(30,64,175,0.45)] backdrop-blur-xl xl:flex"
      aria-label={copy.appNavigation}
    >
      <div className="flex min-h-11 items-center justify-between gap-3 px-2">
        <Link
          href="/dashboard"
          className="flex min-h-11 min-w-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          aria-label={copy.dashboardLink}
        >
          <Logo className="max-w-32" />
        </Link>
        <PrototypeBadge compact copy={copy} />
      </div>

      <div className="mt-7 min-h-0 flex-1 overflow-y-auto pb-4">
        <PrimaryNavigation
          pathname={pathname}
          labelledBy="desktop-primary-navigation"
          locale={locale}
          copy={copy}
        />
      </div>

      <PrototypeNotice copy={copy} />
    </aside>
  );
}

function MobileDrawer({
  open,
  pathname,
  onClose,
  drawerRef,
  locale,
  copy,
}: {
  open: boolean;
  pathname: string;
  onClose: () => void;
  drawerRef: React.RefObject<HTMLElement | null>;
  locale: Locale;
  copy: AppShellCopy;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 xl:hidden">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-slate-950/80 backdrop-blur-sm"
        aria-label={copy.closeNavigation}
        tabIndex={-1}
        onClick={onClose}
      />
      <aside
        id="mobile-navigation-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={copy.navigationMenu}
        className="animate-fade-in relative flex h-dvh w-[min(88vw,21rem)] flex-col border-r border-blue-400/15 bg-slate-950 px-4 py-4 shadow-[24px_0_80px_-24px_rgba(37,99,235,0.55)]"
      >
        <div className="flex min-h-12 items-center justify-between gap-3 px-1">
          <Link
            href="/dashboard"
            onClick={onClose}
            className="flex min-h-11 min-w-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            aria-label={copy.dashboardLink}
          >
            <Logo className="max-w-32" />
          </Link>
          <button
            data-drawer-close
            type="button"
            onClick={onClose}
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-300 transition-colors duration-150 hover:bg-slate-800 hover:text-white active:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            aria-label={copy.closeMenu}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-200">
              <Building2 className="size-5" aria-hidden="true" />
            </span>
            <WorkspaceContext compact copy={copy} />
          </div>
          <PrototypeBadge compact copy={copy} />
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pb-4">
          <PrimaryNavigation
            pathname={pathname}
            onNavigate={onClose}
            labelledBy="mobile-primary-navigation"
            locale={locale}
            copy={copy}
          />
        </div>

        <PrototypeNotice copy={copy} />
      </aside>
    </div>
  );
}

function IconAction({
  href,
  label,
  children,
  active = false,
}: {
  href: string;
  label: string;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={cn(
        "relative flex size-11 shrink-0 items-center justify-center rounded-xl border border-transparent text-slate-400 transition-[background-color,border-color,color] duration-150",
        "hover:border-slate-700 hover:bg-slate-800/80 hover:text-slate-100 active:bg-slate-800",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
        active && "border-blue-400/20 bg-blue-500/10 text-blue-200",
      )}
    >
      {children}
    </Link>
  );
}

function Topbar({
  pathname,
  drawerOpen,
  onOpenDrawer,
  menuButtonRef,
  copy,
}: {
  pathname: string;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  copy: AppShellCopy;
}) {
  return (
    <header className="sticky top-0 z-30 flex min-h-16 items-center border-b border-slate-800/80 bg-slate-950/82 px-3 backdrop-blur-xl sm:px-5 lg:min-h-[72px] lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenDrawer}
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-300 transition-colors duration-150 hover:bg-slate-800 hover:text-white active:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 xl:hidden"
          aria-label={copy.openNavigation}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          aria-controls="mobile-navigation-drawer"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>

        <div className="hidden min-w-0 xl:block">
          <WorkspaceContext copy={copy} />
        </div>
        <div className="min-w-0 xl:hidden">
          <WorkspaceContext compact copy={copy} />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <Link
          href="/search"
          aria-label={copy.globalSearch}
          className={cn(
            "mr-0 flex size-11 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-900/80 text-slate-400 transition-[background-color,border-color,color,box-shadow] duration-150",
            "hover:border-blue-400/35 hover:bg-slate-800 hover:text-slate-100 active:bg-slate-800",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
            "md:mr-1 md:w-64 md:justify-start md:gap-2.5 md:px-3.5 xl:w-80",
            isActivePath(pathname, "/search") &&
              "border-blue-400/30 bg-blue-500/10 text-blue-100",
          )}
        >
          <SearchIcon className="size-4.5 shrink-0" aria-hidden="true" />
          <span className="hidden min-w-0 flex-1 truncate text-left text-sm md:block">
            {copy.searchPlaceholder}
          </span>
          <kbd className="hidden shrink-0 rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-400 md:inline-flex">
            Ctrl K
          </kbd>
        </Link>

        <IconAction href="/notifications" label={copy.notifications}>
          <Bell className="size-5" strokeWidth={1.8} aria-hidden="true" />
        </IconAction>
        <IconAction href="/utility#tro-giup" label={copy.help}>
          <CircleHelp className="size-5" strokeWidth={1.8} aria-hidden="true" />
        </IconAction>
        <Link
          href="/profile"
          aria-label={copy.profile}
          className="group flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-transparent p-1.5 text-left transition-[background-color,border-color] duration-150 hover:border-slate-700 hover:bg-slate-800/80 active:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 sm:pr-2.5"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-[0_6px_18px_-8px_rgba(96,165,250,0.9)]">
            <UserRound className="size-4" aria-hidden="true" />
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block max-w-24 truncate text-xs font-semibold text-slate-100">
              An Nguyễn
            </span>
            <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-400">
              {copy.demoData}
            </span>
          </span>
        </Link>
      </div>
    </header>
  );
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale } = usePreferences();
  const copy = appShellCopy[locale];
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const [drawerState, setDrawerState] = useState({
    open: false,
    pathname: "",
  });
  const drawerOpen = drawerState.open && drawerState.pathname === pathname;

  const openDrawer = useCallback(() => {
    requestPreferencesClose();
    setDrawerState({ open: true, pathname });
  }, [pathname]);

  const closeDrawer = useCallback(() => {
    setDrawerState((current) => ({ ...current, open: false }));
  }, []);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

      if (isEditing) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        router.push("/search");
      }
    };

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, [router]);

  useEffect(() => {
    if (!drawerOpen) return;

    const drawer = drawerRef.current;
    const menuButton = menuButtonRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    const desktopQuery = window.matchMedia("(min-width: 1280px)");
    const focusFrame = window.requestAnimationFrame(() => {
      const initialFocus =
        drawer?.querySelector<HTMLElement>("[data-drawer-close]") ??
        drawer?.querySelector<HTMLElement>(focusableSelector);
      initialFocus?.focus({ preventScroll: true });
    });

    document.body.style.overflow = "hidden";

    const handleDrawerKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }

      if (event.key !== "Tab" || !drawer) return;

      const focusableElements = Array.from(
        drawer.querySelectorAll<HTMLElement>(focusableSelector),
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey) {
        if (
          document.activeElement === firstElement ||
          !drawer.contains(document.activeElement)
        ) {
          event.preventDefault();
          lastElement.focus();
        }
      } else if (document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    const handleDesktopViewport = (event: MediaQueryListEvent) => {
      if (event.matches) closeDrawer();
    };

    document.addEventListener("keydown", handleDrawerKeydown);
    desktopQuery.addEventListener("change", handleDesktopViewport);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleDrawerKeydown);
      desktopQuery.removeEventListener("change", handleDesktopViewport);
      document.body.style.overflow = previousBodyOverflow;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      } else {
        menuButton?.focus({ preventScroll: true });
      }
    };
  }, [closeDrawer, drawerOpen]);

  return (
    <div className="relative flex min-h-dvh w-full flex-1 overflow-x-clip bg-slate-950 text-slate-100">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-xl transition-transform duration-150 focus:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      >
        {copy.skipNavigation}
      </a>

      <div
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_72%_-10%,rgba(37,99,235,0.14),transparent_38%),radial-gradient(circle_at_18%_105%,rgba(124,58,237,0.10),transparent_32%)]"
        aria-hidden="true"
      />

      <Sidebar pathname={pathname} locale={locale} copy={copy} />
      <MobileDrawer
        open={drawerOpen}
        pathname={pathname}
        onClose={closeDrawer}
        drawerRef={drawerRef}
        locale={locale}
        copy={copy}
      />

      <div className="relative z-10 flex min-h-dvh min-w-0 flex-1 flex-col">
        <Topbar
          pathname={pathname}
          drawerOpen={drawerOpen}
          onOpenDrawer={openDrawer}
          menuButtonRef={menuButtonRef}
          copy={copy}
        />
        <main
          id="main-content"
          lang={locale === "en" ? "vi" : undefined}
          tabIndex={-1}
          className="relative min-w-0 flex-1 overflow-x-hidden focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
