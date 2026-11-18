"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Download,
  FolderInput,
  FolderPlus,
  Loader2,
  Plus,
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
        body: JSON.stringify({ name: cleaned, description: description.trim() }),
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
          Tạo không gian tri thức mới
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
      <div className="mt-3 grid gap-2.5 sm:grid-cols-[14rem_1fr_auto]">
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
        setStatusMessage("Không thể cập nhật trạng thái.");
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
