"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import Logo from "@/components/Logo";
import { usePreferences } from "@/components/preferences/PreferencesProvider";

const publicNavCopy = {
  vi: {
    ariaLabel: "Điều hướng chính",
    homeLabel: "UPTECH KNOWLEDGE - Trang chủ",
    signIn: "Đăng nhập",
    mobileSignIn: "Đăng nhập / Xem demo",
    openMenu: "Mở menu",
    closeMenu: "Đóng menu",
    items: [
      { href: "#product", label: "Sản phẩm" },
      { href: "#trust", label: "Nguyên tắc" },
      { href: "#capabilities", label: "Năng lực" },
      { href: "#workflow", label: "Quy trình" },
    ],
  },
  en: {
    ariaLabel: "Primary navigation",
    homeLabel: "UPTECH KNOWLEDGE - Home",
    signIn: "Sign in",
    mobileSignIn: "Sign in / View demo",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    items: [
      { href: "#product", label: "Product" },
      { href: "#trust", label: "Principles" },
      { href: "#capabilities", label: "Capabilities" },
      { href: "#workflow", label: "Workflow" },
    ],
  },
} as const;

export function PublicNav() {
  const { locale } = usePreferences();
  const copy = publicNavCopy[locale === "en" ? "en" : "vi"];
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const desktopLinksRef = useRef<HTMLDivElement>(null);
  const mobileNavigationRef = useRef<HTMLDivElement>(null);

  const closeMenuAndFocusAnchor = (href: string) => {
    setOpen(false);

    window.requestAnimationFrame(() => {
      const target = document.getElementById(href.slice(1));
      if (!target) return;

      const focusTarget = target.matches("h1, h2, h3")
        ? target
        : (target.querySelector<HTMLElement>("h1, h2, h3") ?? target);
      const hadTabIndex = focusTarget.hasAttribute("tabindex");

      if (!hadTabIndex) {
        focusTarget.setAttribute("tabindex", "-1");
      }

      focusTarget.focus({ preventScroll: true });

      if (!hadTabIndex) {
        focusTarget.addEventListener(
          "blur",
          () => focusTarget.removeAttribute("tabindex"),
          { once: true },
        );
      }
    });
  };

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
      data-scrolled={scrolled || open ? "true" : "false"}
      className="landing-public-nav fixed inset-x-0 top-0 z-50 border-b"
    >
      <nav aria-label={copy.ariaLabel}>
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:h-24 lg:px-8">
        <Link
          href="/"
          aria-label={copy.homeLabel}
          className="inline-flex min-h-12 items-center gap-4 rounded-lg"
        >
          <Logo className="h-10 w-auto sm:h-12" />
          <span className="landing-brand-word hidden border-l-2 border-slate-700/80 pl-4 text-base font-bold tracking-[0.24em] text-slate-100 sm:inline">
            KNOWLEDGE
          </span>
        </Link>

        <div ref={desktopLinksRef} className="hidden items-center gap-7 md:flex">
          {copy.items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="landing-nav-link inline-flex min-h-11 items-center text-base font-medium text-slate-400 transition-colors hover:text-slate-100"
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="landing-nav-cta group hidden min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-base font-semibold text-white transition-[background-color,box-shadow,transform] hover:-translate-y-0.5 hover:bg-blue-700 sm:inline-flex"
          >
            {copy.signIn}
            <ArrowRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-hover:translate-x-0.5"
            />
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
              <a
                key={item.href}
                href={item.href}
                onClick={() => closeMenuAndFocusAnchor(item.href)}
                className="flex min-h-12 items-center rounded-lg px-3 text-base font-medium text-slate-300 transition-colors hover:bg-slate-900 hover:text-slate-100"
              >
                {item.label}
              </a>
            ))}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-base font-semibold text-white transition-colors hover:bg-blue-700"
            >
              {copy.mobileSignIn}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>
      </nav>
    </header>
  );
}
