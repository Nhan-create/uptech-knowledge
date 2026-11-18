"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  BookOpen,
  BookOpenCheck,
  CheckCircle2,
  CircleHelp,
  FileUp,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { usePreferences } from "@/components/preferences/PreferencesProvider";
import { Badge, Card } from "@/components/ui";
import { PageIntro, WorkspacePage } from "@/components/workspace/WorkspacePrimitives";
import { normalizeFold } from "@/features/dashboard/hero-matching";
import type { DocumentSummaryView, SpaceSummaryView } from "@/features/knowledge/model";
import type {
  KnowledgeCardKind,
  KnowledgeCardRecord,
  KnowledgeCardStatus,
} from "@/server/knowledge/repository";
import { cn } from "@/lib/utils";

const KIND_META: Record<
  KnowledgeCardKind,
  { label: string; icon: typeof BookOpenCheck; tileClass: string }
> = {
  decision: {
    label: "Quyết định (ADR)",
    icon: BookOpenCheck,
    tileClass: "border-[#DDD6FE] bg-[#F5F3FF] text-[#6D28D9]",
  },
  rule: {
    label: "Quy chuẩn",
    icon: ShieldCheck,
    tileClass: "border-[#C8D2FF] bg-[#EEF1FF] text-[#1B44FF]",
  },
  "open-question": {
    label: "Câu hỏi mở (OQ)",
    icon: CircleHelp,
    tileClass: "border-[#F6D59B] bg-[#FFF3DE] text-[#924D05]",
  },
};

const STATUS_META: Record<
  KnowledgeCardStatus,
  { label: string; variant: "warning" | "success" | "neutral" }
> = {
  draft: { label: "Chờ duyệt", variant: "warning" },
  verified: { label: "Đã xác minh", variant: "success" },
  archived: { label: "Lưu trữ", variant: "neutral" },
};

export function KnowledgeCardsWorkbench({
  initialCards,
  spaces,
  readyDocuments,
}: Readonly<{
  initialCards: readonly KnowledgeCardRecord[];
  spaces: readonly SpaceSummaryView[];
  readyDocuments: readonly DocumentSummaryView[];
}>) {
  const router = useRouter();
  const { locale } = usePreferences();

  const [cards, setCards] = useState<readonly KnowledgeCardRecord[]>(initialCards);
  const [selectedDocId, setSelectedDocId] = useState<string>(
    readyDocuments[0]?.id ?? "",
  );
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters
  const [kindFilter, setKindFilter] = useState<"all" | KnowledgeCardKind>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | KnowledgeCardStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Manual creation panel
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKind, setNewKind] = useState<KnowledgeCardKind>("decision");
  const [newSpaceId, setNewSpaceId] = useState<string>(spaces[0]?.id ?? "spc_8f2a01");
  const [newSourceDocId, setNewSourceDocId] = useState<string>("");
  const [newTitle, setNewTitle] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newRationale, setNewRationale] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Inline card editor
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editRationale, setEditRationale] = useState("");
  const [busyCardId, setBusyCardId] = useState<string | null>(null);

  const verifiedCount = cards.filter((c) => c.status === "verified").length;
  const draftCount = cards.filter((c) => c.status === "draft").length;
  const openQuestionCount = cards.filter(
    (c) => c.kind === "open-question" && c.status !== "archived",
  ).length;

  const foldedQuery = normalizeFold(searchQuery);
  const filteredCards = cards.filter((card) => {
    if (kindFilter !== "all" && card.kind !== kindFilter) return false;
    if (statusFilter !== "all" && card.status !== statusFilter) return false;
    if (!foldedQuery) return true;
    return normalizeFold(
      `${card.title} ${card.summary} ${card.rationale} ${card.spaceName} ${card.sourceDocumentName ?? ""}`,
    ).includes(foldedQuery);
  });

  async function handleExtractFromDocument() {
    if (!selectedDocId) return;
    setErrorMsg(null);
    setExtractStatus(null);
    setIsExtracting(true);
    try {
      const res = await fetch("/api/v1/workspace/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "extract",
          documentId: selectedDocId,
          locale,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        cards?: KnowledgeCardRecord[];
        error?: { message?: string };
      } | null;

      if (!res.ok || !data?.ok || !Array.isArray(data.cards)) {
        setErrorMsg(data?.error?.message ?? "Không thể rút trích Thẻ tri thức.");
        return;
      }

      setCards((prev) => [...data.cards!, ...prev]);
      setExtractStatus(`AI đã rút trích ${data.cards.length} Thẻ tri thức mới.`);
      router.refresh();
    } catch {
      setErrorMsg("Không thể kết nối máy chủ AI.");
    } finally {
      setIsExtracting(false);
    }
  }

  async function handleCreateManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMsg(null);
    setIsCreating(true);
    try {
      const res = await fetch("/api/v1/workspace/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "manual",
          kind: newKind,
          spaceId: newSpaceId,
          documentId: newSourceDocId || undefined,
          title: newTitle.trim(),
          summary: newSummary.trim(),
          rationale: newRationale.trim(),
          locale,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        cards?: KnowledgeCardRecord[];
        error?: { message?: string };
      } | null;

      if (!res.ok || !data?.ok || !data.cards?.[0]) {
        setErrorMsg(data?.error?.message ?? "Không thể tạo Thẻ tri thức.");
        return;
      }

      setCards((prev) => [...data.cards!, ...prev]);
      setNewTitle("");
      setNewSummary("");
      setNewRationale("");
      setShowCreateForm(false);
      router.refresh();
    } finally {
      setIsCreating(false);
    }
  }

  async function patchCard(
    cardId: string,
    patch: {
      status?: KnowledgeCardStatus;
      title?: string;
      summary?: string;
      rationale?: string;
    },
  ) {
    setBusyCardId(cardId);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/v1/workspace/knowledge/${encodeURIComponent(cardId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...patch, locale }),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        card?: KnowledgeCardRecord;
        error?: { message?: string };
      } | null;

      if (!res.ok || !data?.ok || !data.card) {
        setErrorMsg(data?.error?.message ?? "Không thể cập nhật thẻ.");
        return;
      }

      setCards((prev) => prev.map((c) => (c.id === cardId ? data.card! : c)));
      if (editingId === cardId) setEditingId(null);
      router.refresh();
    } finally {
      setBusyCardId(null);
    }
  }

  async function deleteCard(cardId: string) {
    setBusyCardId(cardId);
    try {
      const res = await fetch(
        `/api/v1/workspace/knowledge/${encodeURIComponent(cardId)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setCards((prev) => prev.filter((c) => c.id !== cardId));
        router.refresh();
      }
    } finally {
      setBusyCardId(null);
    }
  }

  return (
    <WorkspacePage>
      <PageIntro
        eyebrow="Thẻ tri thức · ADR, Quy chuẩn & OQ"
        title="Thẻ tri thức đã chuẩn hóa"
        description="Rút trích các quyết định quan trọng (ADR), quy chuẩn bắt buộc và câu hỏi mở (OQ) từ tài liệu thật bằng AI hoặc ghi nhận trực tiếp để kiểm duyệt & tái sử dụng."
        actions={
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[#0B1220] px-4 text-xs font-semibold [color:#FFFFFF] transition-colors hover:bg-[#172136]"
          >
            <Plus aria-hidden="true" className="size-4" />
            Tạo thẻ thủ công
          </button>
        }
      />

      {/* Live KPIs */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={BookOpenCheck} label="Tổng thẻ tri thức" value={cards.length} tone="violet" />
        <KpiCard icon={CheckCircle2} label="Đã xác minh" value={verifiedCount} tone="emerald" />
        <KpiCard icon={ShieldCheck} label="Chờ duyệt (Nháp)" value={draftCount} tone="blue" />
        <KpiCard icon={CircleHelp} label="Câu hỏi mở (OQ)" value={openQuestionCount} tone="amber" />
      </div>

      {/* AI Extraction Bar */}
      <section
        aria-labelledby="ai-extract-heading"
        className="mt-6 rounded-2xl border border-[#C8D2FF] bg-gradient-to-br from-[#F5F7FF] via-white to-white p-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#1B44FF] text-white">
              <Sparkles aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h2 id="ai-extract-heading" className="text-sm font-bold text-[#0D1321]">
                Rút trích Thẻ tri thức tự động bằng AI
              </h2>
              <p className="mt-0.5 text-xs leading-5 text-[#505A6E]">
                Chọn tài liệu Sẵn sàng để AI tự tách các Quyết định, Quy chuẩn và Câu hỏi mở
                kèm vị trí trích dẫn gốc.
              </p>
            </div>
          </div>

          {readyDocuments.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="knowledge-extract-doc">
                Chọn tài liệu để rút trích
              </label>
              <select
                id="knowledge-extract-doc"
                value={selectedDocId}
                onChange={(e) => setSelectedDocId(e.currentTarget.value)}
                disabled={isExtracting}
                className="h-10 max-w-[260px] rounded-xl border border-[#0D1321]/14 bg-white px-3 text-xs font-medium text-[#0D1321] outline-none focus:border-[#1B44FF]"
              >
                {readyDocuments.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={isExtracting || !selectedDocId}
                onClick={() => void handleExtractFromDocument()}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-[#1B44FF] px-4 text-xs font-semibold [color:#FFFFFF] transition-colors hover:bg-[#1635C7] disabled:cursor-wait disabled:opacity-75"
              >
                {isExtracting ? (
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles aria-hidden="true" className="size-3.5" />
                )}
                {isExtracting ? "Đang rút trích…" : "Rút trích tự động bằng AI"}
              </button>
            </div>
          ) : (
            <Link
              href="/documents#library-upload-zone"
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-[#1B44FF] bg-white px-4 text-xs font-semibold text-[#1635C7] hover:bg-[#EEF1FF]"
            >
              <FileUp aria-hidden="true" className="size-3.5" />
              Tải tài liệu lên Thư viện trước
            </Link>
          )}
        </div>

        {extractStatus ? (
          <p aria-live="polite" className="mt-3 text-xs font-semibold text-[#076944]">
            {extractStatus}
          </p>
        ) : null}
        {errorMsg ? (
          <p role="alert" className="mt-3 text-xs font-medium text-[#B91C1C]">
            {errorMsg}
          </p>
        ) : null}
      </section>

      {/* Manual Create Card Drawer */}
      {showCreateForm ? (
        <form
          onSubmit={handleCreateManual}
          className="mt-5 rounded-2xl border border-[#0D1321]/14 bg-white p-5 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-[#0D1321]">Tạo Thẻ tri thức mới</h2>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              aria-label="Đóng biểu mẫu tạo thẻ"
              className="inline-flex size-8 items-center justify-center rounded-full text-[#505A6E] hover:bg-[#F3F4F8]"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-[#323B4D]">
              Loại thẻ
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.currentTarget.value as KnowledgeCardKind)}
                className="mt-1.5 h-10 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3 text-sm font-normal text-[#0D1321]"
              >
                <option value="decision">Quyết định (ADR)</option>
                <option value="rule">Quy chuẩn</option>
                <option value="open-question">Câu hỏi mở (OQ)</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-[#323B4D]">
              Không gian
              <select
                value={newSpaceId}
                onChange={(e) => setNewSpaceId(e.currentTarget.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3 text-sm font-normal text-[#0D1321]"
              >
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-[#323B4D]">
              Tài liệu nguồn (tuỳ chọn)
              <select
                value={newSourceDocId}
                onChange={(e) => setNewSourceDocId(e.currentTarget.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3 text-sm font-normal text-[#0D1321]"
              >
                <option value="">Không gắn tài liệu</option>
                {readyDocuments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 space-y-3">
            <label className="block text-xs font-semibold text-[#323B4D]">
              Tiêu đề thẻ
              <input
                type="text"
                required
                minLength={3}
                value={newTitle}
                onChange={(e) => setNewTitle(e.currentTarget.value)}
                placeholder="Ví dụ: Quy định ứng trước chi phí công tác"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3 text-sm font-normal text-[#0D1321] outline-none focus:border-[#1B44FF] focus:bg-white"
              />
            </label>
            <label className="block text-xs font-semibold text-[#323B4D]">
              Nội dung cốt lõi / Kết luận
              <textarea
                required
                rows={3}
                minLength={5}
                value={newSummary}
                onChange={(e) => setNewSummary(e.currentTarget.value)}
                placeholder="Ghi rõ nội dung quy định, quyết định hoặc câu hỏi cần xác nhận…"
                className="mt-1.5 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] p-3 text-sm font-normal text-[#0D1321] outline-none focus:border-[#1B44FF] focus:bg-white"
              />
            </label>
            <label className="block text-xs font-semibold text-[#323B4D]">
              Bối cảnh / Cơ sở (tuỳ chọn)
              <input
                type="text"
                value={newRationale}
                onChange={(e) => setNewRationale(e.currentTarget.value)}
                placeholder="Lý do áp dụng hoặc bộ phận chịu trách nhiệm…"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3 text-sm font-normal text-[#0D1321] outline-none focus:border-[#1B44FF] focus:bg-white"
              />
            </label>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="inline-flex h-9 items-center rounded-full border border-[#0D1321]/14 bg-white px-4 text-xs font-semibold text-[#505A6E]"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1B44FF] px-4 text-xs font-semibold [color:#FFFFFF] hover:bg-[#1635C7]"
            >
              {isCreating ? "Đang lưu…" : "Lưu thẻ tri thức"}
            </button>
          </div>
        </form>
      ) : null}

      {/* Filter & Search Bar */}
      <div className="mt-6 grid gap-3 rounded-2xl border border-[#0D1321]/10 bg-white p-3.5 sm:grid-cols-[1fr_11rem_11rem]">
        <label className="relative min-w-0">
          <span className="sr-only">Tìm kiếm thẻ tri thức</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#505A6E]"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="Lọc thẻ theo tiêu đề, nội dung hoặc nguồn…"
            className="h-10 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] pl-10 pr-3 text-sm text-[#0D1321] outline-none focus:border-[#1B44FF] focus:bg-white"
          />
        </label>
        <select
          aria-label="Lọc theo loại thẻ"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.currentTarget.value as "all" | KnowledgeCardKind)}
          className="h-10 rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3 text-xs font-medium text-[#0D1321] outline-none focus:border-[#1B44FF]"
        >
          <option value="all">Mọi loại thẻ</option>
          <option value="decision">Quyết định (ADR)</option>
          <option value="rule">Quy chuẩn</option>
          <option value="open-question">Câu hỏi mở (OQ)</option>
        </select>
        <select
          aria-label="Lọc theo trạng thái duyệt"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.currentTarget.value as "all" | KnowledgeCardStatus)
          }
          className="h-10 rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3 text-xs font-medium text-[#0D1321] outline-none focus:border-[#1B44FF]"
        >
          <option value="all">Mọi trạng thái</option>
          <option value="verified">Đã xác minh</option>
          <option value="draft">Chờ duyệt</option>
          <option value="archived">Lưu trữ</option>
        </select>
      </div>

      {/* Cards Grid */}
      {filteredCards.length > 0 ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {filteredCards.map((card) => {
            const kindInfo = KIND_META[card.kind];
            const statusInfo = STATUS_META[card.status];
            const KindIcon = kindInfo.icon;
            const isEditing = editingId === card.id;
            const isBusy = busyCardId === card.id;

            return (
              <Card key={card.id} className="flex flex-col justify-between p-5">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className={cn(
                        "inline-flex size-10 shrink-0 items-center justify-center rounded-xl border",
                        kindInfo.tileClass,
                      )}
                    >
                      <KindIcon aria-hidden="true" className="size-5" />
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={statusInfo.variant} size="sm">
                        {statusInfo.label}
                      </Badge>
                      <Badge variant="neutral" size="sm">
                        v{card.version}
                      </Badge>
                    </div>
                  </div>

                  <p className="mt-3.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#505A6E]">
                    {kindInfo.label} · {card.spaceName}
                  </p>

                  {isEditing ? (
                    <div className="mt-2 space-y-2">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.currentTarget.value)}
                        className="h-9 w-full rounded-lg border border-[#1B44FF] bg-white px-2.5 text-sm font-bold text-[#0D1321]"
                      />
                      <textarea
                        rows={3}
                        value={editSummary}
                        onChange={(e) => setEditSummary(e.currentTarget.value)}
                        className="w-full rounded-lg border border-[#0D1321]/14 bg-[#FAF9FB] p-2.5 text-sm text-[#323B4D]"
                      />
                      <input
                        type="text"
                        value={editRationale}
                        onChange={(e) => setEditRationale(e.currentTarget.value)}
                        placeholder="Bối cảnh / lý do…"
                        className="h-9 w-full rounded-lg border border-[#0D1321]/14 bg-[#FAF9FB] px-2.5 text-xs text-[#505A6E]"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            void patchCard(card.id, {
                              title: editTitle,
                              summary: editSummary,
                              rationale: editRationale,
                            })
                          }
                          className="h-8 rounded-full bg-[#1B44FF] px-3 text-xs font-semibold [color:#FFFFFF]"
                        >
                          Lưu chỉnh sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="h-8 rounded-full border border-[#0D1321]/14 bg-white px-3 text-xs font-medium text-[#505A6E]"
                        >
                          Hủy
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h3 className="mt-1.5 text-base font-bold leading-6 text-[#0D1321]">
                        {card.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-[#323B4D]">
                        {card.summary}
                      </p>
                      {card.rationale ? (
                        <p className="mt-2 rounded-xl bg-[#FAF9FB] px-3 py-2 text-xs leading-5 text-[#505A6E]">
                          <strong>Cơ sở:</strong> {card.rationale}
                        </p>
                      ) : null}
                    </>
                  )}

                  {card.sourceDocumentId ? (
                    <div className="mt-3">
                      <Link
                        href={`/documents/${encodeURIComponent(card.sourceDocumentId)}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#C8D2FF] bg-[#EEF1FF] px-3 py-1 text-[11px] font-semibold text-[#1635C7] hover:bg-[#DCE3FF]"
                      >
                        <BookOpen aria-hidden="true" className="size-3" />
                        <span>
                          {card.sourceDocumentName}
                          {card.sourceLocator ? ` · ${card.sourceLocator}` : ""}
                        </span>
                      </Link>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#0D1321]/8 pt-3.5">
                  <span className="text-[11px] text-[#505A6E]">
                    {card.ownerLabel} · {card.updatedLabel}
                  </span>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {card.status !== "verified" ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void patchCard(card.id, { status: "verified" })}
                        className="inline-flex h-8 items-center gap-1 rounded-full bg-[#076944] px-3 text-xs font-semibold [color:#FFFFFF] hover:bg-[#055235]"
                      >
                        <CheckCircle2 aria-hidden="true" className="size-3" />
                        Xác minh
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void patchCard(card.id, { status: "draft" })}
                        className="inline-flex h-8 items-center rounded-full border border-[#0D1321]/14 bg-white px-3 text-xs font-semibold text-[#323B4D] hover:bg-[#F3F4F8]"
                      >
                        Về nháp
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(card.id);
                        setEditTitle(card.title);
                        setEditSummary(card.summary);
                        setEditRationale(card.rationale);
                      }}
                      aria-label={`Chỉnh sửa ${card.title}`}
                      className="inline-flex size-8 items-center justify-center rounded-full border border-[#0D1321]/12 bg-white text-[#505A6E] hover:text-[#1635C7]"
                    >
                      <Pencil aria-hidden="true" className="size-3.5" />
                    </button>

                    {card.status !== "archived" ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void patchCard(card.id, { status: "archived" })}
                        aria-label={`Lưu trữ ${card.title}`}
                        className="inline-flex size-8 items-center justify-center rounded-full border border-[#0D1321]/12 bg-white text-[#505A6E] hover:text-[#0D1321]"
                      >
                        <Archive aria-hidden="true" className="size-3.5" />
                      </button>
                    ) : null}

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void deleteCard(card.id)}
                      aria-label={`Xóa ${card.title}`}
                      className="inline-flex size-8 items-center justify-center rounded-full border border-[#0D1321]/12 bg-white text-[#505A6E] hover:border-[#FACACA] hover:bg-[#FDECEC] hover:text-[#B32018]"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-[#0D1321]/18 bg-white p-10 text-center">
          <BookOpenCheck aria-hidden="true" className="mx-auto size-8 text-[#6D28D9]" />
          <h3 className="mt-3 text-base font-bold text-[#0D1321]">
            {cards.length === 0
              ? "Chưa có Thẻ tri thức nào trong kho"
              : "Không có thẻ nào khớp bộ lọc"}
          </h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#505A6E]">
            {cards.length === 0
              ? readyDocuments.length > 0
                ? "Hãy chọn một tài liệu ở thanh phía trên rồi bấm “Rút trích tự động bằng AI” hoặc bấm “Tạo thẻ thủ công”."
                : "Hãy tải tài liệu lên Thư viện trước để AI tự rút trích Quyết định & Quy chuẩn, hoặc tự tạo thẻ thủ công ngay bây giờ."
              : "Thử thay đổi từ khóa hoặc đặt lại bộ lọc loại thẻ / trạng thái."}
          </p>
        </div>
      )}
    </WorkspacePage>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: Readonly<{
  icon: typeof BookOpenCheck;
  label: string;
  value: number;
  tone: "violet" | "emerald" | "blue" | "amber";
}>) {
  const cls = {
    violet: "border-[#DDD6FE] bg-[#F5F3FF] text-[#6D28D9]",
    emerald: "border-[#BBEAD2] bg-[#E7F7EF] text-[#076944]",
    blue: "border-[#C8D2FF] bg-[#EEF1FF] text-[#1B44FF]",
    amber: "border-[#F6D59B] bg-[#FFF3DE] text-[#924D05]",
  }[tone];

  return (
    <Card className="flex items-center gap-3.5 p-4">
      <span
        className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl border ${cls}`}
      >
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-[#505A6E]">{label}</p>
        <p className="glean-tabular mt-0.5 text-xl font-bold text-[#0D1321]">{value}</p>
      </div>
    </Card>
  );
}
