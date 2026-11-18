"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";

import { usePreferences } from "@/components/preferences/PreferencesProvider";

interface SummaryCitation {
  readonly number: number;
  readonly id: string;
  readonly title: string;
  readonly locator: string;
  readonly spaceName: string;
}

interface SummaryPayload {
  readonly available?: boolean;
  readonly model?: string;
  readonly intro?: string;
  readonly points?: readonly Readonly<{
    heading: string;
    detail: string;
    citationNumber: number;
  }>[];
  readonly citations?: readonly SummaryCitation[];
}

export function SearchAiSummaryCard({
  query,
  spaceId,
  fileType,
}: Readonly<{
  query: string;
  spaceId?: string;
  fileType?: string;
}>) {
  const { locale } = usePreferences();
  const [status, setStatus] = useState<"loading" | "ready" | "hidden">("loading");
  const [summary, setSummary] = useState<SummaryPayload | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    fetch("/api/v1/workspace/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        query,
        spaceId: spaceId ?? "all",
        fileType: fileType ?? "all",
        locale,
      }),
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as SummaryPayload;
      })
      .then((data) => {
        if (!active) return;
        if (!data || !data.available || (!data.intro && (!data.points || data.points.length === 0))) {
          setStatus("hidden");
          return;
        }
        setSummary(data);
        setStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setStatus("hidden");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [query, spaceId, fileType, locale]);

  if (status === "hidden") return null;

  return (
    <section
      aria-labelledby="search-ai-overview-heading"
      className="mt-6 rounded-2xl border border-[#C8D2FF] bg-gradient-to-br from-[#F5F7FF] via-white to-white p-5 shadow-[0_10px_24px_-12px_rgba(27,68,255,0.18)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-[#1B44FF] text-white">
            <Sparkles aria-hidden="true" className="size-3.5" />
          </span>
          <h2
            id="search-ai-overview-heading"
            className="text-sm font-bold text-[#0D1321]"
          >
            {locale === "vi" ? "Tóm tắt nhanh bởi Trợ lý AI" : "AI Quick Overview"}
          </h2>
          {summary ? (
            <span className="rounded-full border border-[#C8D2FF] bg-white px-2 py-0.5 text-[11px] font-medium text-[#1635C7]">
              UPTECH AI
            </span>
          ) : null}
        </div>

        <Link
          href={`/chat?prompt=${encodeURIComponent(query)}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#0B1220] px-3 text-xs font-semibold [color:#FFFFFF] transition-colors hover:bg-[#172136]"
        >
          <span>{locale === "vi" ? "Hỏi sâu hơn" : "Ask follow-up"}</span>
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>

      {status === "loading" ? (
        <div className="mt-3 flex items-center gap-2 text-xs font-medium text-[#505A6E]">
          <Loader2 aria-hidden="true" className="size-4 animate-spin text-[#1B44FF]" />
          <span>
            {locale === "vi"
              ? "Đang tổng hợp câu trả lời từ các đoạn tài liệu khớp nhất…"
              : "Synthesizing answer from top matching Ready passages…"}
          </span>
        </div>
      ) : summary ? (
        <div className="mt-3 space-y-2.5 text-sm leading-6 text-[#1F2937]">
          {summary.intro ? <p>{summary.intro}</p> : null}
          {summary.points && summary.points.length > 0 ? (
            <ul className="space-y-1.5 pl-1">
              {summary.points.map((pt, idx) => {
                const cit = summary.citations?.find((c) => c.number === pt.citationNumber);
                return (
                  <li key={`${idx}-${pt.heading}`} className="flex items-start gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#1B44FF]" />
                    <span>
                      <strong className="font-semibold text-[#0D1321]">
                        {pt.heading}:
                      </strong>{" "}
                      {pt.detail}{" "}
                      {cit ? (
                        <Link
                          href={`/documents/${encodeURIComponent(cit.id)}`}
                          className="ml-1 inline-flex items-center rounded-full border border-[#C8D2FF] bg-[#EEF1FF] px-1.5 py-0.5 text-[11px] font-bold text-[#1635C7] hover:bg-[#1B44FF] hover:[color:#FFFFFF]"
                        >
                          [{cit.number}]
                        </Link>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
