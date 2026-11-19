"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileUp,
  FolderInput,
  FolderPlus,
  GitCompareArrows,
  History,
  Loader2,
  MessageSquarePlus,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import type { DocumentSummaryView, SpaceSummaryView } from "@/features/knowledge/model";

export function CreateSpaceButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accessScope, setAccessScope] = useState<"WORKSPACE" | "DEPARTMENT" | "ADMIN_ONLY">("WORKSPACE");
  const [allowedDepartmentKey, setAllowedDepartmentKey] = useState<"SALES" | "HR" | "IT" | "FINANCE">("IT");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = name.trim();
    if (cleaned.length < 2) {
      setError("Tên không gian tối thiểu 2 ký tự.");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch("/api/v1/workspace/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cleaned,
          description: description.trim(),
          accessScope,
          allowedDepartmentKey: accessScope === "DEPARTMENT" ? allowedDepartmentKey : null,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: { message?: string };
      } | null;

      if (!res.ok || !data?.ok) {
        setError(data?.error?.message ?? "Không thể tạo không gian.");
        return;
      }

      setName("");
      setDescription("");
      setAccessScope("WORKSPACE");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Không thể kết nối máy chủ.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#0D1321]/14 bg-white px-3.5 text-xs font-semibold text-[#0D1321] transition-colors hover:border-[#1B44FF] hover:text-[#1635C7]"
      >
        <FolderPlus aria-hidden="true" className="size-3.5" />
        <span>Tạo không gian</span>
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 w-full rounded-2xl border border-[#C8D2FF] bg-[#F6F8FF] p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#1635C7]">
          Tạo không gian tri thức mới (hỗ trợ phân quyền ACL)
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Đóng tạo không gian"
          className="inline-flex size-7 items-center justify-center rounded-full text-[#505A6E] hover:bg-white"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[13rem_1fr_12rem_auto]">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Tên không gian (vd: Pháp lý)"
          className="h-10 rounded-xl border border-[#0D1321]/14 bg-white px-3 text-sm text-[#0D1321] outline-none focus:border-[#1B44FF]"
          required
        />
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          placeholder="Mô tả ngắn gọn mục đích lưu trữ…"
          className="h-10 rounded-xl border border-[#0D1321]/14 bg-white px-3 text-sm text-[#0D1321] outline-none focus:border-[#1B44FF]"
        />
        <div className="flex gap-1.5">
          <select
            aria-label="Phạm vi quyền truy cập"
            value={accessScope}
            onChange={(e) =>
              setAccessScope(
                e.currentTarget.value as "WORKSPACE" | "DEPARTMENT" | "ADMIN_ONLY",
              )
            }
            className="h-10 flex-1 rounded-xl border border-[#0D1321]/14 bg-white px-2.5 text-xs font-semibold text-[#0D1321] outline-none focus:border-[#1B44FF]"
          >
            <option value="WORKSPACE">Toàn công ty</option>
            <option value="DEPARTMENT">Theo phòng ban</option>
            <option value="ADMIN_ONLY">Chỉ Quản trị (Admin)</option>
          </select>
          {accessScope === "DEPARTMENT" ? (
            <select
              aria-label="Phòng ban được phép"
              value={allowedDepartmentKey}
              onChange={(e) =>
                setAllowedDepartmentKey(
                  e.currentTarget.value as "SALES" | "HR" | "IT" | "FINANCE",
                )
              }
              className="h-10 w-24 rounded-xl border border-[#0D1321]/14 bg-white px-2 text-xs font-semibold text-[#0D1321] outline-none focus:border-[#1B44FF]"
            >
              <option value="IT">IT</option>
              <option value="HR">HR</option>
              <option value="SALES">SALES</option>
              <option value="FINANCE">FINANCE</option>
            </select>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-[#1B44FF] px-4 text-xs font-semibold [color:#FFFFFF] hover:bg-[#1635C7] disabled:opacity-70"
        >
          {isSaving ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <Plus aria-hidden="true" className="size-3.5" />
          )}
          Lưu không gian
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-[#B91C1C]">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function DocumentRowQuickActions({
  document,
}: Readonly<{
  document: DocumentSummaryView;
}>) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/v1/workspace/documents/${encodeURIComponent(document.id)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Link
        href={`/chat?prompt=${encodeURIComponent(`Tóm tắt tài liệu ${document.name}`)}`}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#C8D2FF] bg-[#EEF1FF] px-3 text-xs font-semibold text-[#1635C7] transition-colors hover:bg-[#DCE3FF]"
      >
        <Sparkles aria-hidden="true" className="size-3" />
        Hỏi AI
      </Link>

      <a
        href={`/api/v1/workspace/documents/${encodeURIComponent(document.id)}/download`}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#0D1321]/14 bg-white px-3 text-xs font-semibold text-[#323B4D] transition-colors hover:bg-[#F3F4F8]"
      >
        <Download aria-hidden="true" className="size-3" />
        Tải xuống
      </a>

      <Link
        href={`/documents/${encodeURIComponent(document.id)}`}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#0D1321]/14 bg-white px-3 text-xs font-semibold text-[#0D1321] transition-colors hover:border-[#1B44FF] hover:text-[#1635C7]"
      >
        Chi tiết
      </Link>

      {confirmDelete ? (
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            disabled={isDeleting}
            onClick={() => void handleDelete()}
            className="inline-flex h-8 items-center rounded-full bg-[#DC2626] px-3 text-xs font-semibold [color:#FFFFFF] hover:bg-[#B91C1C]"
          >
            {isDeleting ? "Đang xóa…" : "Xác nhận xóa"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="inline-flex h-8 items-center rounded-full border border-[#0D1321]/14 bg-white px-2.5 text-xs font-medium text-[#505A6E]"
          >
            Hủy
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Xóa tài liệu ${document.name}`}
          className="inline-flex size-8 items-center justify-center rounded-full border border-[#0D1321]/10 bg-white text-[#505A6E] transition-colors hover:border-[#FACACA] hover:bg-[#FDECEC] hover:text-[#B32018]"
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function DocumentDetailActions({
  document,
  spaces,
}: Readonly<{
  document: DocumentSummaryView;
  spaces: readonly SpaceSummaryView[];
}>) {
  const router = useRouter();
  const [spaceId, setSpaceId] = useState<string>(document.space.id);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const isDeprecated = document.governance.some((g) => g.kind === "deprecated");

  async function patchDocument(patch: {
    spaceId?: string;
    governanceKind?: "verified" | "deprecated";
  }) {
    setIsUpdating(true);
    setStatusMessage(null);
    try {
      const res = await fetch(
        `/api/v1/workspace/documents/${encodeURIComponent(document.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (res.ok) {
        setStatusMessage("Đã cập nhật tài liệu.");
        router.refresh();
      } else {
        const errData = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setStatusMessage(
          errData?.error?.message ?? "Không thể cập nhật trạng thái.",
        );
      }
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/v1/workspace/documents/${encodeURIComponent(document.id)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        router.push("/documents");
        router.refresh();
      }
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-2">
        <a
          href={`/api/v1/workspace/documents/${encodeURIComponent(document.id)}/download`}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[#0B1220] px-4 text-sm font-semibold [color:#FFFFFF] transition-colors hover:bg-[#172136]"
        >
          <Download aria-hidden="true" className="size-4" />
          Tải xuống tệp gốc
        </a>

        <Link
          href={`/chat?prompt=${encodeURIComponent(`Tóm tắt nội dung chính của tài liệu ${document.name}`)}`}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#C8D2FF] bg-[#EEF1FF] px-4 text-sm font-semibold text-[#1635C7] transition-colors hover:bg-[#DCE3FF]"
        >
          <Sparkles aria-hidden="true" className="size-4" />
          Hỏi AI về tài liệu này
        </Link>

        <button
          type="button"
          disabled={isUpdating}
          onClick={() =>
            void patchDocument({
              governanceKind: isDeprecated ? "verified" : "deprecated",
            })
          }
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#0D1321]/14 bg-white px-4 text-xs font-semibold text-[#0D1321] transition-colors hover:bg-[#F3F4F8] disabled:opacity-60"
        >
          <CheckCircle2 aria-hidden="true" className="size-3.5 text-[#076944]" />
          {isDeprecated ? "Khôi phục thành Đã xác minh" : "Đánh dấu phiên bản cũ"}
        </button>
      </div>

      {spaces.length > 0 ? (
        <div className="pt-1">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#505A6E]">
            <FolderInput aria-hidden="true" className="size-3.5" />
            <span>Di chuyển không gian</span>
          </label>
          <select
            aria-label="Di chuyển không gian"
            value={spaceId}
            disabled={isUpdating}
            onChange={(e) => {
              const nextSpace = e.currentTarget.value;
              setSpaceId(nextSpace);
              void patchDocument({ spaceId: nextSpace });
            }}
            className="mt-1.5 h-10 w-full rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3 text-xs font-medium text-[#0D1321] outline-none focus:border-[#1B44FF]"
          >
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <button
        type="button"
        disabled={isDeleting}
        onClick={() => void handleDelete()}
        className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-full border border-[#FACACA] bg-[#FDECEC] px-4 text-xs font-semibold text-[#B32018] transition-colors hover:bg-[#FAD6D6] disabled:opacity-60"
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
        {isDeleting ? "Đang xóa…" : "Xóa khỏi thư viện"}
      </button>

      {statusMessage ? (
        <p aria-live="polite" className="text-xs font-medium text-[#076944]">
          {statusMessage}
        </p>
      ) : null}
    </div>
  );
}

export function DocumentInlineOriginalViewer({
  documentId,
  fileName,
  fileType,
}: Readonly<{
  documentId: string;
  fileName: string;
  fileType: string;
}>) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#1B44FF]/25 bg-[#EEF3FF] px-3.5 text-xs font-semibold text-[#1635C7] transition-colors hover:bg-[#DCE7FF]"
      >
        <Eye aria-hidden="true" className="size-3.5" />
        <span>
          {open
            ? "Ẩn trình xem tài liệu gốc"
            : `Xem trực tiếp bản gốc (${fileType.toUpperCase()}) ngay trong trang`}
        </span>
      </button>

      {open ? (
        <div className="mt-3 overflow-hidden rounded-2xl border border-[#0D1321]/14 bg-[#F8FAFC]">
          <div className="flex items-center justify-between border-b border-[#0D1321]/10 bg-white px-4 py-2.5 text-xs">
            <span className="font-semibold text-[#0D1321]">
              Trình xem tài liệu gốc · {fileName}
            </span>
            <a
              href={`/api/v1/workspace/documents/${encodeURIComponent(documentId)}/download?inline=1`}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[#1635C7] hover:underline"
            >
              Mở toàn màn hình ↗
            </a>
          </div>
          <iframe
            title={`Bản gốc ${fileName}`}
            src={`/api/v1/workspace/documents/${encodeURIComponent(documentId)}/download?inline=1`}
            className="h-[460px] w-full bg-white"
          />
        </div>
      ) : null}
    </div>
  );
}

export function DocumentVersionLifecyclePanel({
  documentId,
  currentVersionLabel,
  versions,
}: Readonly<{
  documentId: string;
  currentVersionLabel: string;
  versions: ReadonlyArray<{ id: string; label: string; updatedLabel: string }>;
}>) {
  const router = useRouter();
  const [showUpload, setShowUpload] = useState(false);
  const [versionNote, setVersionNote] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleUploadVersion(e: FormEvent) {
    e.preventDefault();
    if (!selectedFile) return;
    setBusy("upload");
    setErrorMsg(null);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.set("file", selectedFile);
      if (versionNote.trim()) {
        formData.set("note", versionNote.trim());
      }
      const res = await fetch(
        `/api/v1/workspace/documents/${encodeURIComponent(documentId)}`,
        {
          method: "POST",
          body: formData,
        },
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        document?: { versionLabel?: string };
        error?: { message?: string };
      } | null;
      if (!res.ok || !data?.ok) {
        setErrorMsg(data?.error?.message ?? "Không thể tải lên phiên bản mới.");
        return;
      }
      setFeedback(
        `Đã phát hành phiên bản mới ${data.document?.versionLabel ?? ""} và lưu snapshot phiên bản cũ.`,
      );
      setShowUpload(false);
      setSelectedFile(null);
      setVersionNote("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleRollback(versionId: string, label: string) {
    setBusy(versionId);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/v1/workspace/documents/${encodeURIComponent(documentId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "rollback",
            versionId,
          }),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: { message?: string };
      } | null;
      if (!res.ok || !data?.ok) {
        setErrorMsg(data?.error?.message ?? "Không thể khôi phục phiên bản.");
        return;
      }
      setFeedback(`Đã khôi phục nội dung từ phiên bản ${label}.`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const latestVersion = versions[0];

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-[#505A6E]">
          <History aria-hidden="true" className="size-4 text-[#1635C7]" />
          <span>
            Phiên bản hiện hành:{" "}
            <strong className="text-[#0D1321]">{currentVersionLabel}</strong> (
            {versions.length} mốc lưu trữ)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {versions.length >= 2 && latestVersion && versions[1] ? (
            <Link
              href={`/documents/compare?left=${encodeURIComponent(`${documentId}::${versions[1].id}`)}&right=${encodeURIComponent(`${documentId}::${latestVersion.id}`)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#1B44FF]/30 bg-[#EEF3FF] px-3 text-xs font-semibold text-[#1635C7] hover:bg-[#DCE7FF]"
            >
              <GitCompareArrows aria-hidden="true" className="size-3.5" />
              <span>
                So sánh {versions[1].label} → {latestVersion.label}
              </span>
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setShowUpload((prev) => !prev)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#1B44FF] px-3.5 text-xs font-semibold text-white hover:bg-[#1635C7]"
          >
            <FileUp aria-hidden="true" className="size-3.5" />
            <span>Tải lên phiên bản mới (v2.0+)</span>
          </button>
        </div>
      </div>

      {showUpload ? (
        <form
          onSubmit={(e) => void handleUploadVersion(e)}
          className="rounded-2xl border border-[#1B44FF]/25 bg-[#F8FAFF] p-4 space-y-3"
        >
          <p className="text-xs font-semibold text-[#0D1321]">
            Phát hành phiên bản mới cho tài liệu này
          </p>
          <p className="text-xs text-[#505A6E]">
            Hệ thống sẽ tự động lưu snapshot phiên bản hiện tại ({currentVersionLabel}), cập nhật chỉ mục RAG và gắn cờ rà soát các Thẻ tri thức liên quan.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <input
              type="file"
              accept=".pdf,.docx,.md,.txt,.csv,.json"
              required
              onChange={(e) => setSelectedFile(e.currentTarget.files?.[0] ?? null)}
              className="block w-full rounded-xl border border-[#0D1321]/14 bg-white px-3 py-2 text-xs text-[#0D1321]"
            />
            <input
              type="text"
              value={versionNote}
              onChange={(e) => setVersionNote(e.currentTarget.value)}
              placeholder="Ghi chú thay đổi (VD: Cập nhật SLA 2026 & chính sách bảo mật)"
              className="h-9 rounded-xl border border-[#0D1321]/14 bg-white px-3 text-xs text-[#0D1321]"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!selectedFile || busy === "upload"}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#0B1220] px-4 text-xs font-semibold text-white hover:bg-[#172136] disabled:opacity-50"
            >
              {busy === "upload" ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <FileUp aria-hidden="true" className="size-3.5" />
              )}
              <span>Phát hành phiên bản mới</span>
            </button>
            <button
              type="button"
              onClick={() => setShowUpload(false)}
              className="inline-flex h-9 items-center rounded-full border border-[#0D1321]/14 bg-white px-3 text-xs font-medium text-[#505A6E]"
            >
              Đóng
            </button>
          </div>
        </form>
      ) : null}

      {feedback ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-800">
          {feedback}
        </p>
      ) : null}
      {errorMsg ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-800">
          {errorMsg}
        </p>
      ) : null}

      {versions.length > 0 ? (
        <ul className="space-y-2">
          {versions.map((version, idx) => (
            <li
              key={version.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#0D1321]/10 bg-white px-4 py-3 text-sm"
            >
              <div className="flex items-center gap-2.5">
                <span className="font-semibold text-[#0D1321]">{version.label}</span>
                {idx === 0 ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    Đang áp dụng
                  </span>
                ) : null}
                <span className="glean-tabular text-xs text-[#505A6E]">
                  {version.updatedLabel}
                </span>
              </div>
              {idx > 0 && latestVersion ? (
                <div className="flex items-center gap-2">
                  <Link
                    href={`/documents/compare?left=${encodeURIComponent(`${documentId}::${version.id}`)}&right=${encodeURIComponent(`${documentId}::${latestVersion.id}`)}`}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-[#0D1321]/14 bg-[#FAF9FB] px-2.5 text-xs font-semibold text-[#1635C7] hover:bg-[#EEF3FF]"
                  >
                    <GitCompareArrows aria-hidden="true" className="size-3" />
                    <span>Diff với {latestVersion.label}</span>
                  </Link>
                  <button
                    type="button"
                    disabled={busy === version.id}
                    onClick={() => void handleRollback(version.id, version.label)}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-[#0D1321]/14 bg-white px-2.5 text-xs font-semibold text-[#0D1321] hover:bg-[#F3F4F8] disabled:opacity-50"
                  >
                    <RotateCcw aria-hidden="true" className="size-3" />
                    <span>
                      {busy === version.id ? "Đang khôi phục…" : "Khôi phục bản này"}
                    </span>
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface CommentItem {
  readonly id: string;
  readonly authorLabel: string;
  readonly authorRole: string;
  readonly commentKind: "COMMENT" | "OUTDATED_FLAG" | "APPROVAL_NOTE";
  readonly body: string;
  readonly createdAtIso: string;
}

export function DocumentCommentsAndGovernancePanel({
  documentId,
}: Readonly<{
  documentId: string;
}>) {
  const [comments, setComments] = useState<readonly CommentItem[]>([]);
  const [body, setBody] = useState("");
  const [commentKind, setCommentKind] = useState<
    "COMMENT" | "OUTDATED_FLAG" | "APPROVAL_NOTE"
  >("COMMENT");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/workspace/documents/${encodeURIComponent(documentId)}`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { comments?: CommentItem[] } | null) => {
        if (active && data?.comments) {
          setComments(data.comments);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [documentId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (body.trim().length < 2) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/v1/workspace/documents/${encodeURIComponent(documentId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "comment",
            commentKind,
            body: body.trim(),
          }),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        comments?: CommentItem[];
        error?: { message?: string };
      } | null;
      if (!res.ok || !data?.ok) {
        setErrorMsg(data?.error?.message ?? "Không thể gửi phản hồi.");
        return;
      }
      if (data.comments) setComments(data.comments);
      setBody("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[#0D1321]/10 bg-white p-5 shadow-[0_8px_20px_-8px_rgba(11,18,32,0.08)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1635C7]">
            Quản trị tri thức & Thảo luận (Knowledge Governance SLA)
          </p>
          <h3 className="mt-1 text-base font-bold text-[#0D1321]">
            Bình luận, Đề xuất phê duyệt & Báo cáo nội dung lỗi thời
          </h3>
        </div>
        <span className="rounded-full bg-[#EEF3FF] px-3 py-1 text-xs font-semibold text-[#1635C7]">
          Chu kỳ tái xác minh SLA: 90 ngày
        </span>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCommentKind("COMMENT")}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              commentKind === "COMMENT"
                ? "bg-[#0B1220] text-white"
                : "border border-[#0D1321]/12 bg-[#FAF9FB] text-[#505A6E]"
            }`}
          >
            Thảo luận / Câu hỏi
          </button>
          <button
            type="button"
            onClick={() => setCommentKind("OUTDATED_FLAG")}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              commentKind === "OUTDATED_FLAG"
                ? "bg-amber-600 text-white"
                : "border border-amber-300 bg-amber-50 text-amber-900"
            }`}
          >
            <AlertTriangle aria-hidden="true" className="size-3" />
            <span>Báo thông tin lỗi thời</span>
          </button>
          <button
            type="button"
            onClick={() => setCommentKind("APPROVAL_NOTE")}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              commentKind === "APPROVAL_NOTE"
                ? "bg-[#1635C7] text-white"
                : "border border-[#C8D2FF] bg-[#EEF1FF] text-[#1635C7]"
            }`}
          >
            Đề xuất phê duyệt (Maker-Checker)
          </button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            placeholder={
              commentKind === "OUTDATED_FLAG"
                ? "Mô tả điều khoản hoặc số liệu đã lỗi thời cần cập nhật..."
                : commentKind === "APPROVAL_NOTE"
                  ? "Ghi chú đề xuất OWNER / ADMIN phê duyệt xác minh tài liệu này..."
                  : "Viết bình luận hoặc câu hỏi làm rõ về tài liệu..."
            }
            className="h-10 flex-1 rounded-xl border border-[#0D1321]/14 bg-[#FAF9FB] px-3.5 text-xs text-[#0D1321] outline-none focus:border-[#1B44FF] focus:bg-white"
          />
          <button
            type="submit"
            disabled={submitting || body.trim().length < 2}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-[#1B44FF] px-4 text-xs font-semibold text-white hover:bg-[#1635C7] disabled:opacity-50"
          >
            <MessageSquarePlus aria-hidden="true" className="size-3.5" />
            <span>{submitting ? "Đang gửi…" : "Gửi ghi nhận"}</span>
          </button>
        </div>
        {errorMsg ? (
          <p className="text-xs font-medium text-rose-700">{errorMsg}</p>
        ) : null}
      </form>

      {comments.length > 0 ? (
        <ul className="mt-4 space-y-2.5 border-t border-[#0D1321]/8 pt-4">
          {comments.map((item) => (
            <li
              key={item.id}
              className={`rounded-xl border p-3 text-xs ${
                item.commentKind === "OUTDATED_FLAG"
                  ? "border-amber-200 bg-amber-50/70"
                  : item.commentKind === "APPROVAL_NOTE"
                    ? "border-[#C8D2FF] bg-[#F5F7FF]"
                    : "border-[#0D1321]/8 bg-[#FAF9FB]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#0D1321]">{item.authorLabel}</span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#505A6E]">
                    {item.authorRole}
                  </span>
                  {item.commentKind === "OUTDATED_FLAG" ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      Cảnh báo lỗi thời
                    </span>
                  ) : item.commentKind === "APPROVAL_NOTE" ? (
                    <span className="rounded-full bg-[#DCE7FF] px-2 py-0.5 text-[10px] font-semibold text-[#1635C7]">
                      Kiểm duyệt Maker-Checker
                    </span>
                  ) : null}
                </div>
                <span className="text-[11px] text-[#647084]">
                  {new Date(item.createdAtIso).toLocaleString("vi-VN")}
                </span>
              </div>
              <p className="mt-1.5 leading-5 text-[#323B4D]">{item.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-[#647084]">
          Chưa có bình luận hay cảnh báo lỗi thời nào trên tài liệu này.
        </p>
      )}
    </section>
  );
}
