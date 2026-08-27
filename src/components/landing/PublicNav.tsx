"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import Logo from "@/components/Logo";
import { DemoRequestDialog } from "@/components/landing/DemoRequestDialog";
import { usePreferences } from "@/components/preferences/PreferencesProvider";

const publicNavCopy = {
  vi: {
    ariaLabel: "Điều hướng chính",
    homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
    signIn: "Đăng nhập",
    openMenu: "Mở menu",
    closeMenu: "Đóng menu",
    items: [
      { href: "/san-pham", label: "Sản phẩm" },
      { href: "/nguyen-tac", label: "Nguyên tắc" },
      { href: "/nang-luc", label: "Năng lực" },
      { href: "/quy-trinh", label: "Quy trình" },
    ],
  },
  en: {
    ariaLabel: "Primary navigation",
    homeLabel: "UPTECH KNOWLEDGE - Home",
    signIn: "Sign in",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    items: [
      { href: "/san-pham", label: "Product" },
      { href: "/nguyen-tac", label: "Principles" },
      { href: "/nang-luc", label: "Capabilities" },
      { href: "/quy-trinh", label: "Workflow" },
    ],
  },
} as const;

export function PublicNav() {
  const { locale } = usePreferences();
  const pathname = usePathname();
  const copy = publicNavCopy[locale === "en" ? "en" : "vi"];
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const desktopLinksRef = useRef<HTMLDivElement>(null);
  const mobileNavigationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let scrollFrame = 0;

    const updateScrollState = () => {
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = window.requestAnimationFrame(() => {
        setScrolled(window.scrollY > 16);
      });
    };

    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });

    return () => {
      window.cancelAnimationFrame(scrollFrame);
      window.removeEventListener("scroll", updateScrollState);
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 768px)");

    const closeAtDesktopBreakpoint = (event: MediaQueryListEvent) => {
      if (!event.matches) return;

      const activeElement = document.activeElement;
      const focusedHref =
        activeElement instanceof HTMLAnchorElement &&
        mobileNavigationRef.current?.contains(activeElement)
          ? activeElement.getAttribute("href")
          : null;

      setOpen(false);

      if (!focusedHref) return;

      window.requestAnimationFrame(() => {
        const desktopLinks = Array.from(
          desktopLinksRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [],
        );
        const focusTarget =
          desktopLinks.find((link) => link.getAttribute("href") === focusedHref) ??
          desktopLinks[0];
        focusTarget?.focus({ preventScroll: true });
      });
    };

    desktopQuery.addEventListener("change", closeAtDesktopBreakpoint);
    return () =>
      desktopQuery.removeEventListener("change", closeAtDesktopBreakpoint);
  }, []);

  return (
    <header
      data-testid="public-navigation"
      data-media-surface="dark"
      data-scrolled={scrolled || open ? "true" : "false"}
      className="landing-public-nav fixed inset-x-0 top-0 z-50 border-b"
    >
      <nav aria-label={copy.ariaLabel}>
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:h-24 lg:px-8">
        <Link
          data-testid="public-brand"
          translate="no"
          href="/"
          aria-label={copy.homeLabel}
          className="notranslate inline-flex min-h-12 items-center gap-4 border-0 bg-transparent p-0 shadow-none"
        >
          <Logo className="h-10 w-auto sm:h-12" />
          <span className="landing-brand-word hidden border-l-2 border-slate-700/80 pl-4 text-base font-bold tracking-[0.24em] text-slate-100 sm:inline">
            KNOWLEDGE
          </span>
        </Link>

        <div ref={desktopLinksRef} className="hidden items-center gap-7 md:flex">
          {copy.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={`landing-nav-link inline-flex min-h-11 items-center text-base font-medium transition-colors hover:text-slate-100 ${pathname === item.href ? "text-slate-100" : "text-slate-400"}`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <DemoRequestDialog
            triggerTestId="public-nav-trial"
            triggerClassName="landing-nav-cta hidden min-h-11 cursor-pointer items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-base font-semibold text-white transition-[background-color,box-shadow,transform] hover:-translate-y-0.5 hover:bg-blue-700 sm:inline-flex motion-reduce:transform-none"
          />
          <Link
            href="/login"
            data-testid="public-nav-sign-in"
            className="landing-nav-cta hidden min-h-11 items-center rounded-lg border border-slate-700 bg-slate-900/70 px-4 py-2 text-base font-semibold text-slate-100 transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:border-slate-500 hover:bg-slate-800 sm:inline-flex motion-reduce:transform-none"
          >
            {copy.signIn}
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={open ? copy.closeMenu : copy.openMenu}
            onClick={() => setOpen((current) => !current)}
            className="inline-flex size-11 cursor-pointer items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 md:hidden"
          >
            {open ? (
              <X aria-hidden="true" className="size-5" />
            ) : (
              <Menu aria-hidden="true" className="size-5" />
            )}
          </button>
        </div>
        </div>

        <div
          ref={mobileNavigationRef}
          id="mobile-navigation"
          hidden={!open}
          className="animate-fade-in-down border-t border-slate-800 bg-[var(--bg-surface)] px-4 py-4 shadow-[var(--panel-shadow)] md:hidden"
        >
          <div className="mx-auto flex max-w-7xl flex-col gap-1">
            {copy.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`flex min-h-12 items-center rounded-lg px-3 text-base font-medium transition-colors hover:bg-slate-900 hover:text-slate-100 ${pathname === item.href ? "bg-slate-900 text-slate-100" : "text-slate-300"}`}
              >
                {item.label}
              </Link>
            ))}
            <DemoRequestDialog
              triggerTestId="public-mobile-nav-trial"
              triggerClassName="mt-2 inline-flex min-h-12 w-full cursor-pointer items-center justify-center rounded-lg bg-blue-600 px-4 text-base font-semibold text-white transition-colors hover:bg-blue-700"
            />
            <Link
              href="/login"
              data-testid="public-mobile-nav-sign-in"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 px-4 text-base font-semibold text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800"
            >
              {copy.signIn}
            </Link>
          </div>
        </div>
      </nav>
    </header>
  );
}
