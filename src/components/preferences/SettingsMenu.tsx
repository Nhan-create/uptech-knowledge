"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import type { Locale, Theme } from "@/lib/preferences";

import { usePreferences } from "./PreferencesProvider";
import {
  PREFERENCES_CLOSE_EVENT,
  PREFERENCES_OPEN_EVENT,
  type PreferencesOpenDetail,
} from "./preferences-events";

const copy: Record<
  Locale,
  {
    title: string;
    description: string;
    open: string;
    close: string;
    language: string;
    appearance: string;
    vietnamese: string;
    english: string;
    light: string;
    dark: string;
  }
> = {
  vi: {
    title: "Cài đặt",
    description:
      "Giao diện áp dụng toàn trang; ngôn ngữ hiện áp dụng cho điều hướng và nhãn dùng chung của prototype.",
    open: "Mở cài đặt",
    close: "Đóng cài đặt",
    language: "Ngôn ngữ",
    appearance: "Giao diện",
    vietnamese: "Tiếng Việt",
    english: "Tiếng Anh",
    light: "Sáng",
    dark: "Tối",
  },
  en: {
    title: "Settings",
    description:
      "Appearance applies everywhere; language currently covers shared navigation and prototype labels.",
    open: "Open settings",
    close: "Close settings",
    language: "Language",
    appearance: "Appearance",
    vietnamese: "Vietnamese",
    english: "English",
    light: "Light",
    dark: "Dark",
  },
};

function GearIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className="size-5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z" />
      <path d="M19.2 13.1c.04-.36.04-.74 0-1.1l1.73-1.35-1.8-3.12-2.04.82a8.24 8.24 0 0 0-.95-.55L15.83 5.6h-3.6l-.32 2.2c-.33.16-.65.34-.95.55l-2.04-.82-1.8 3.12L8.85 12c-.04.36-.04.74 0 1.1l-1.73 1.35 1.8 3.12 2.04-.82c.3.21.62.4.95.55l.32 2.2h3.6l.31-2.2c.34-.16.66-.34.96-.55l2.03.82 1.8-3.12-1.73-1.35Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className="size-5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="size-4"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4.5 10.5 3.25 3.25 7.75-8" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className="size-4.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className="size-4.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8a8.5 8.5 0 1 0 11.4 11.4Z" />
    </svg>
  );
}

function LanguageIcon({ locale }: { locale: Locale }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 items-center justify-center rounded-lg border border-current/15 text-[11px] font-bold uppercase"
    >
      {locale}
    </span>
  );
}

type PreferenceOptionProps<T extends string> = Readonly<{
  checked: boolean;
  groupName: string;
  icon: React.ReactNode;
  id: string;
  label: string;
  onChange: (value: T) => void;
  value: T;
}>;

function PreferenceOption<T extends string>({
  checked,
  groupName,
  icon,
  id,
  label,
  onChange,
  value,
}: PreferenceOptionProps<T>) {
  const optionClassName = checked
    ? "border-blue-500/55 bg-blue-500/12 text-[var(--text-primary)]"
    : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-blue-400/45 hover:bg-[var(--bg-subtle)]";

  return (
    <label
      htmlFor={id}
      className={`relative flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-xl border px-3 text-sm font-medium transition-[background-color,border-color,color] duration-150 motion-reduce:transition-none ${optionClassName}`}
    >
      <input
        checked={checked}
        className="peer sr-only"
        id={id}
        name={groupName}
        onChange={() => onChange(value)}
        type="radio"
        value={value}
      />
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 leading-5">{label}</span>
      <span
        aria-hidden="true"
        className={`flex size-5 shrink-0 items-center justify-center rounded-full text-blue-500 transition-opacity ${checked ? "opacity-100" : "opacity-0"}`}
      >
        <CheckIcon />
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-blue-500 ring-offset-2 ring-offset-[var(--bg-elevated)] opacity-0 peer-focus-visible:opacity-100"
      />
    </label>
  );
}

export function SettingsMenu() {
  const { locale, theme, isLocalePending, setLocale, setTheme } =
    usePreferences();
  const [open, setOpen] = useState(false);
  const instanceId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const labels = copy[locale];
  const panelId = `${instanceId}-preferences-panel`;
  const titleId = `${instanceId}-preferences-title`;
  const descriptionId = `${instanceId}-preferences-description`;
  const localeGroupName = `${instanceId}-locale`;
  const themeGroupName = `${instanceId}-theme`;

  const restoreTriggerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      const target = returnFocusRef.current?.isConnected
        ? returnFocusRef.current
        : triggerRef.current;
      target?.focus({ preventScroll: true });
      returnFocusRef.current = null;
    });
  }, []);

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    restoreTriggerFocus();
  }, [restoreTriggerFocus]);

  useEffect(() => {
    const handleOpenRequest = (event: Event) => {
      const detail = (event as CustomEvent<PreferencesOpenDetail>).detail;
      returnFocusRef.current = detail?.returnFocusTo ?? triggerRef.current;
      setOpen(true);
    };

    const handleCloseRequest = () => {
      returnFocusRef.current = null;
      setOpen(false);
    };

    window.addEventListener(PREFERENCES_OPEN_EVENT, handleOpenRequest);
    window.addEventListener(PREFERENCES_CLOSE_EVENT, handleCloseRequest);
    return () => {
      window.removeEventListener(PREFERENCES_OPEN_EVENT, handleOpenRequest);
      window.removeEventListener(PREFERENCES_CLOSE_EVENT, handleCloseRequest);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeAndRestoreFocus();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target)) return;
      setOpen(false);

      window.requestAnimationFrame(() => {
        if (document.getElementById(panelId)?.isConnected) return;

        const activeElement = document.activeElement;
        const focusMovedOutside =
          activeElement instanceof HTMLElement &&
          activeElement !== document.body &&
          activeElement.isConnected &&
          !rootRef.current?.contains(activeElement);

        if (!focusMovedOutside) {
          restoreTriggerFocus();
        }
      });
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [closeAndRestoreFocus, open, panelId, restoreTriggerFocus]);

  const triggerClassName =
    "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[0_10px_32px_rgba(15,23,42,0.24)] hover:border-blue-400/55 hover:text-blue-500";
  const panelClassName =
    "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_24px_70px_rgba(15,23,42,0.24)]";
  const mutedTextClassName = "text-[var(--text-muted)]";
  const closeClassName =
    "text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]";

  return (
    <div
      ref={rootRef}
      data-testid="settings-menu-root"
      className="settings-menu-position fixed z-40 print:hidden"
    >
      <button
        ref={triggerRef}
        data-testid="settings-menu-trigger"
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={labels.open}
        title={labels.open}
        onClick={() => {
          returnFocusRef.current = triggerRef.current;
          setOpen((current) => !current);
        }}
        className={`relative flex size-11 cursor-pointer items-center justify-center rounded-full border transition-[background-color,border-color,color,box-shadow,transform] duration-150 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] motion-reduce:transform-none motion-reduce:transition-none ${triggerClassName}`}
      >
        <GearIcon />
        <span className="sr-only">{labels.open}</span>
      </button>

      {open ? (
        <section
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-busy={isLocalePending}
          className={`absolute bottom-16 right-0 max-h-[calc(100dvh-6rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border p-4 ${panelClassName}`}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold">
                {labels.title}
              </h2>
              <p
                id={descriptionId}
                className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}
              >
                {labels.description}
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              aria-label={labels.close}
              title={labels.close}
              onClick={closeAndRestoreFocus}
              className={`flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${closeClassName}`}
            >
              <CloseIcon />
            </button>
          </div>

          <fieldset className="mt-4">
            <legend
              className={`mb-2 text-xs font-semibold uppercase tracking-[0.12em] ${mutedTextClassName}`}
            >
              {labels.language}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <PreferenceOption<Locale>
                checked={locale === "vi"}
                groupName={localeGroupName}
                icon={<LanguageIcon locale="vi" />}
                id={`${instanceId}-locale-vi`}
                label={labels.vietnamese}
                onChange={setLocale}
                value="vi"
              />
              <PreferenceOption<Locale>
                checked={locale === "en"}
                groupName={localeGroupName}
                icon={<LanguageIcon locale="en" />}
                id={`${instanceId}-locale-en`}
                label={labels.english}
                onChange={setLocale}
                value="en"
              />
            </div>
          </fieldset>

          <fieldset className="mt-4">
            <legend
              className={`mb-2 text-xs font-semibold uppercase tracking-[0.12em] ${mutedTextClassName}`}
            >
              {labels.appearance}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <PreferenceOption<Theme>
                checked={theme === "light"}
                groupName={themeGroupName}
                icon={<SunIcon />}
                id={`${instanceId}-theme-light`}
                label={labels.light}
                onChange={setTheme}
                value="light"
              />
              <PreferenceOption<Theme>
                checked={theme === "dark"}
                groupName={themeGroupName}
                icon={<MoonIcon />}
                id={`${instanceId}-theme-dark`}
                label={labels.dark}
                onChange={setTheme}
                value="dark"
              />
            </div>
          </fieldset>
        </section>
      ) : null}
    </div>
  );
}
