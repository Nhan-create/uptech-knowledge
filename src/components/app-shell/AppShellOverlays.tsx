"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, Sparkles, X } from "lucide-react";

import {
  type AppShellCopy,
  type NavItem,
  QUICK_COPILOT_PROMPTS,
} from "./nav-config";
import type { Locale } from "@/lib/preferences";

export function CommandPaletteModal({
  open,
  onClose,
  items,
  locale,
  copy,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  items: readonly NavItem[];
  locale: Locale;
  copy: AppShellCopy;
}>) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const frameId = window.requestAnimationFrame(() => inputRef.current?.focus());
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = query.trim().toLowerCase();
  const filteredItems = trimmed
    ? items.filter(
        (item) =>
          item.label.toLowerCase().includes(trimmed) ||
          item.description.toLowerCase().includes(trimmed) ||
          item.href.toLowerCase().includes(trimmed),
      )
    : items;

  const prompts = QUICK_COPILOT_PROMPTS[locale];

  function navigateTo(href: string) {
    onClose();
    setQuery("");
    router.push(href);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#0B1220]/45 px-4 pt-16 backdrop-blur-xs sm:pt-24"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="glean-cmd-title"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#0D1321]/12 bg-white shadow-[0_24px_48px_-12px_rgba(11,18,32,0.28)]"
      >
        <h2 id="glean-cmd-title" className="sr-only">
          {copy.quickSearch}
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) {
              navigateTo(`/search?q=${encodeURIComponent(query.trim())}`);
            } else if (filteredItems[0]) {
              navigateTo(filteredItems[0].href);
            }
          }}
          className="flex items-center gap-3 border-b border-[#0D1321]/10 px-4 py-3"
        >
          <Search aria-hidden="true" className="size-4 shrink-0 text-[#505A6E]" />
          <input
            ref={inputRef}
            id="command-palette-input"
            name="commandQuery"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.commandPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-[#0D1321] placeholder:text-[#505A6E] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.commandClose}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-[#0D1321]/10 text-[#505A6E] hover:bg-[#F3F4F8] hover:text-[#0D1321]"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </form>

        <div className="max-h-96 overflow-y-auto p-3">
          {query.trim() ? (
            <button
              type="button"
              onClick={() =>
                navigateTo(`/search?q=${encodeURIComponent(query.trim())}`)
              }
              className="mb-3 flex w-full items-center justify-between rounded-xl border border-[#C8D2FF] bg-[#EEF1FF] px-3.5 py-2.5 text-left text-sm font-medium text-[#1635C7] hover:bg-[#DCE3FF]/70"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Search aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">
                  {copy.commandRunSearch} “{query.trim()}”
                </span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </button>
          ) : null}

          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#505A6E]">
            {copy.commandRoutesGroup}
          </p>
          {filteredItems.length > 0 ? (
            <ul className="space-y-1">
              {filteredItems.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => navigateTo(item.href)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[#F3F4F8]"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F8] text-[#1635C7]">
                          <Icon aria-hidden="true" className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-[#0D1321]">
                            {item.label}
                          </span>
                          <span className="block truncate text-xs text-[#505A6E]">
                            {item.description}
                          </span>
                        </span>
                      </span>
                      <span className="glean-mono hidden shrink-0 text-[11px] text-[#505A6E] sm:inline">
                        {item.href}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-4 text-center text-xs text-[#505A6E]">
              {copy.commandEmpty}
            </p>
          )}

          <p className="mt-3 px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#505A6E]">
            {copy.commandPromptsGroup}
          </p>
          <div className="space-y-1">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() =>
                  navigateTo(`/chat?prompt=${encodeURIComponent(prompt)}`)
                }
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-[#323B4D] hover:bg-[#F3F4F8] hover:text-[#1635C7]"
              >
                <Sparkles aria-hidden="true" className="size-3.5 shrink-0 text-[#1B44FF]" />
                <span className="truncate">{prompt}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export function QuickCopilotLauncher({
  locale,
  copy,
}: Readonly<{
  locale: Locale;
  copy: AppShellCopy;
}>) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const frameId = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [expanded]);

  function launchChat(promptText: string) {
    const trimmed = promptText.trim();
    if (!trimmed) return;
    setExpanded(false);
    setQuestion("");
    router.push(`/chat?prompt=${encodeURIComponent(trimmed)}`);
  }

  return (
    <aside
      aria-label={copy.quickAskOpen}
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-[4.75rem] z-40"
    >
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={copy.quickAskOpen}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-[#0D1321]/10 bg-white px-3 sm:px-4 text-xs font-semibold text-[#0D1321] shadow-[0_14px_30px_-8px_rgba(11,18,32,0.22)] transition-transform hover:-translate-y-0.5 hover:border-[#C8D2FF]"
        >
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-[#1B44FF] [color:#FFFFFF]">
            <Sparkles aria-hidden="true" className="size-3.5" />
          </span>
          <span className="hidden sm:inline">{copy.quickAskOpen}</span>
        </button>
      ) : (
        <div className="w-[min(320px,calc(100vw-6rem))] rounded-2xl border border-[#0D1321]/12 bg-white p-4 shadow-[0_20px_40px_-8px_rgba(11,18,32,0.24)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-[#1B44FF] [color:#FFFFFF]">
                <Sparkles aria-hidden="true" className="size-4" />
              </span>
              <div>
                <p className="text-xs font-bold leading-tight text-[#0D1321]">
                  {copy.quickAskTitle}
                </p>
                <p className="text-[11px] text-[#505A6E]">{copy.quickAskSub}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label={copy.quickAskClose}
              className="inline-flex size-7 items-center justify-center rounded-full border border-[#0D1321]/10 text-[#505A6E] hover:bg-[#F3F4F8] hover:text-[#0D1321]"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>

          <div className="mt-3 space-y-1.5">
            {QUICK_COPILOT_PROMPTS[locale].map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => launchChat(prompt)}
                className="w-full rounded-xl bg-[#EEF1FF] px-3 py-2 text-left text-xs font-medium text-[#1635C7] transition-colors hover:bg-[#DCE3FF]"
              >
                {prompt}
              </button>
            ))}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              launchChat(question);
            }}
            className="mt-3 flex items-center gap-1.5 rounded-full border border-[#0D1321]/16 bg-[#FAF9FB] p-1 pl-3 focus-within:border-[#1B44FF]"
          >
            <input
              ref={inputRef}
              id="quick-copilot-input"
              name="quickQuestion"
              aria-label={copy.quickAskPlaceholder}
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={copy.quickAskPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-xs text-[#0D1321] placeholder:text-[#505A6E] focus:outline-none"
            />
            <button
              type="submit"
              aria-label={copy.quickAskSend}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[#1B44FF] [color:#FFFFFF] hover:bg-[#1436D6]"
            >
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
