"use client";

import "@/styles/workspace-glean.css";

import { type ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Menu, Plus, Search, Sparkles, UserRound, X } from "lucide-react";

import { usePreferences } from "@/components/preferences/PreferencesProvider";
import { getProfileInitials, type UserProfileSnapshot } from "@/lib/user-profile";
import { cn } from "@/lib/utils";
import { CommandPaletteModal, QuickCopilotLauncher } from "./AppShellOverlays";
import {
  APP_SHELL_COPY,
  getPrimaryNavItems,
  getSecondaryNavItems,
  isNavItemActive,
  type NavItem,
} from "./nav-config";

function GleanBrandMark() {
  return (
    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-[#1B44FF] [color:#FFFFFF]">
      <Sparkles aria-hidden="true" className="size-3.5" />
    </span>
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null);
}

export default function AppShell({
  children,
  userProfile,
}: Readonly<{
  children: ReactNode;
  userProfile?: UserProfileSnapshot | null;
}>) {
  const pathname = usePathname();
  const isChatRoute = pathname.startsWith("/chat");
  const { locale } = usePreferences();
  const copy = APP_SHELL_COPY[locale];
  const primaryItems = getPrimaryNavItems(locale);
  const secondaryItems = getSecondaryNavItems(locale);
  const allPaletteItems: NavItem[] = [...primaryItems, ...secondaryItems];

  const [announceVisible, setAnnounceVisible] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/workspace/notifications", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { unreadCount?: unknown } | null) => {
        if (active && data && typeof data.unreadCount === "number") {
          setUnreadNotifications(data.unreadCount);
        }
      })
      .catch(() => undefined);

    function handleSync(event: Event) {
      const custom = event as CustomEvent<{ unreadCount?: number }>;
      if (typeof custom.detail?.unreadCount === "number") {
        setUnreadNotifications(custom.detail.unreadCount);
      }
    }
    window.addEventListener("uptech:notifications-updated", handleSync);
    return () => {
      active = false;
      window.removeEventListener("uptech:notifications-updated", handleSync);
    };
  }, [pathname]);

  const profileInitials = getProfileInitials(userProfile?.fullName);
  const profileTitle = userProfile?.fullName
    ? `${copy.profileLabel} (${userProfile.fullName})`
    : copy.profileLabel;

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCmdOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeBtn = drawerRef.current?.querySelector<HTMLElement>("[data-drawer-close]");
    closeBtn?.focus();

    function handleDrawerKeys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
        requestAnimationFrame(() => menuButtonRef.current?.focus());
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusables = getFocusableElements(drawerRef.current);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleDrawerKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDrawerKeys);
    };
  }, [drawerOpen]);

  return (
    <div
      className={cn(
        "uptech-glean-shell bg-[#FAF9FB] text-[#0D1321]",
        isChatRoute ? "uptech-glean-shell--chat" : "min-h-dvh",
      )}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[#0B1220] focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:[color:#FFFFFF]"
      >
        {copy.skipToContent}
      </a>

      {!isChatRoute && announceVisible ? (
        <div className="glean-announce-bar">
          <span>
            <strong className="font-semibold [color:#FFFFFF]">{copy.announceTag}:</strong>{" "}
            {copy.announceBody}
          </span>
          <Link href="/chat" className="glean-announce-link">
            {copy.announceCta}
          </Link>
          <button
            type="button"
            onClick={() => setAnnounceVisible(false)}
            aria-label={copy.dismissAnnounce}
            className="absolute right-3 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-[#CBD5E1] transition-colors hover:bg-white/10 hover:[color:#FFFFFF]"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      ) : null}

      <header className="glean-topnav shrink-0">
        <div className="glean-topnav-inner">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 lg:gap-6">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={copy.openNavigation}
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              aria-controls="mobile-navigation-drawer"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-[#0D1321]/10 bg-white text-[#323B4D] hover:bg-[#F3F4F8] hover:text-[#0D1321] xl:hidden"
            >
              <Menu aria-hidden="true" className="size-4" />
            </button>

            <Link
              href="/dashboard"
              aria-label={copy.dashboardLink}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-base font-bold tracking-[-0.03em] text-[#1B44FF] sm:gap-2 sm:text-lg"
            >
              <GleanBrandMark />
              <span>
                uptech
                <span className="hidden font-semibold text-[#0D1321] min-[420px]:inline">
                  .knowledge
                </span>
              </span>
            </Link>

            <nav aria-label={copy.appNavigation} className="hidden items-center gap-1 xl:flex">
              {primaryItems.map((item) => {
                const active = isNavItemActive(pathname, item);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className="glean-nav-pill"
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              title={copy.quickSearch}
              className="inline-flex size-9 items-center justify-center gap-2.5 rounded-full border border-[#0D1321]/10 bg-white text-xs font-medium text-[#505A6E] transition-colors hover:border-[#0D1321]/20 hover:text-[#0D1321] sm:h-9 sm:w-auto sm:px-3.5"
            >
              <Search aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="sr-only sm:not-sr-only">{copy.quickSearchShort}</span>
              <span className="glean-mono hidden rounded-full bg-[#F3F4F8] px-2 py-0.5 text-[11px] text-[#505A6E] md:inline">
                Ctrl K
              </span>
            </button>

            <Link
              href="/notifications"
              aria-label={copy.notifications}
              title={copy.notifications}
              className={cn(
                "relative inline-flex size-9 items-center justify-center rounded-full border border-[#0D1321]/10 bg-white text-[#323B4D] transition-colors hover:bg-[#F3F4F8] hover:text-[#0D1321]",
                pathname.startsWith("/notifications") &&
                  "border-[#C8D2FF] bg-[#EEF1FF] text-[#1635C7]",
              )}
            >
              <Bell aria-hidden="true" className="size-4" />
              {unreadNotifications > 0 ? (
                <span
                  aria-label={`${unreadNotifications}`}
                  className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full border border-white bg-[#1B44FF] px-1 text-[10px] font-bold leading-4 text-white"
                >
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              ) : null}
            </Link>

            <Link
              href="/profile"
              title={profileTitle}
              className={cn(
                "inline-flex size-9 items-center justify-center overflow-hidden rounded-full border border-[#0D1321]/10 bg-[#F3F4F8] text-xs font-bold text-[#0D1321] transition-colors hover:border-[#C8D2FF] hover:bg-[#EEF1FF] hover:text-[#1635C7]",
                pathname.startsWith("/profile") &&
                  "border-[#1B44FF] bg-[#EEF1FF] text-[#1635C7]",
              )}
            >
              {userProfile?.pictureUrl && !avatarError ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={userProfile.pictureUrl}
                  alt=""
                  aria-hidden="true"
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarError(true)}
                  className="size-full object-cover"
                />
              ) : profileInitials ? (
                <span aria-hidden="true">{profileInitials}</span>
              ) : (
                <UserRound aria-hidden="true" className="size-4" />
              )}
              <span className="sr-only">{copy.profileLabel}</span>
            </Link>

            <Link
              href="/documents#library-upload-zone"
              title={copy.addDocument}
              className="glean-btn glean-btn-navy glean-topnav-add"
            >
              <Plus aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="sr-only sm:not-sr-only">{copy.addDocument}</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Glean Floating Left Capsule Dock (Desktop xl+) */}
      <aside
        aria-label={copy.dockLabel}
        className="glean-floating-dock hidden flex-col gap-1.5 xl:flex"
      >
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const active = isNavItemActive(pathname, item);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-label={item.label}
              title={item.label}
              aria-current={active ? "page" : undefined}
              className="glean-dock-btn"
            >
              <Icon aria-hidden="true" className="size-[17px]" />
            </Link>
          );
        })}
        <div className="my-1 h-px bg-[#0D1321]/10" aria-hidden="true" />
        <Link
          href="/profile"
          aria-label={copy.profileLabel}
          title={copy.profileLabel}
          aria-current={pathname.startsWith("/profile") ? "page" : undefined}
          className="glean-dock-btn"
        >
          <UserRound aria-hidden="true" className="size-[17px]" />
        </Link>
      </aside>

      {/* Accessible Mobile Drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label={copy.closeNavigation}
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-[#0B1220]/40 backdrop-blur-xs"
          />
          <aside
            id="mobile-navigation-drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={copy.appNavigation}
            className="relative flex h-dvh w-[min(86vw,20rem)] flex-col border-r border-[#0D1321]/10 bg-white p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[#0D1321]/10 pb-3">
              <Link
                href="/dashboard"
                onClick={() => setDrawerOpen(false)}
                className="inline-flex items-center gap-2 text-base font-bold tracking-[-0.02em] text-[#1B44FF]"
              >
                <GleanBrandMark />
                <span>
                  uptech<span className="text-[#0D1321]">.knowledge</span>
                </span>
              </Link>
              <button
                data-drawer-close
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  requestAnimationFrame(() => menuButtonRef.current?.focus());
                }}
                aria-label={copy.closeNavigation}
                className="inline-flex size-9 items-center justify-center rounded-full border border-[#0D1321]/10 text-[#323B4D] hover:bg-[#F3F4F8]"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>

            <nav className="mt-4 flex-1 space-y-1 overflow-y-auto" aria-label={copy.appNavigation}>
              {allPaletteItems.map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(pathname, item);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                      active
                        ? "bg-[#EEF1FF] font-semibold text-[#1635C7]"
                        : "text-[#323B4D] hover:bg-[#F3F4F8] hover:text-[#0D1321]",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-3 rounded-xl border border-[#0D1321]/8 bg-[#FAF9FB] p-3 text-xs text-[#505A6E]">
              <p className="font-semibold text-[#0D1321]">{copy.workspaceName}</p>
              <p className="mt-0.5">{copy.prototypeTag} · Read-only UI</p>
            </div>
          </aside>
        </div>
      ) : null}

      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          "glean-main-canvas focus:outline-none",
          isChatRoute && "glean-main-canvas--chat",
        )}
      >
        {children}
      </main>

      {!isChatRoute ? <QuickCopilotLauncher locale={locale} copy={copy} /> : null}

      <CommandPaletteModal
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        items={allPaletteItems}
        locale={locale}
        copy={copy}
      />
    </div>
  );
}
