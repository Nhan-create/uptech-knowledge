"use client";

import { ChangeEvent, useRef, useState } from "react";
import { FileUp, RotateCcw, UploadCloud } from "lucide-react";

export function DocumentFilePicker() {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectButtonRef = useRef<HTMLButtonElement>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFile(event.target.files?.[0]?.name ?? null);
  }

  function resetSelection() {
    if (inputRef.current) inputRef.current.value = "";
    setSelectedFile(null);
    requestAnimationFrame(() => selectButtonRef.current?.focus());
  }

  return (
    <section
      aria-labelledby="upload-demo-heading"
      className="rounded-2xl border border-dashed border-blue-800/70 bg-gradient-to-br from-blue-950/45 to-slate-900/70 p-5 sm:p-6"
    >
      <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-blue-800/60 bg-blue-950 text-blue-300">
            <UploadCloud aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="upload-demo-heading" className="font-semibold text-white">
              Thêm tài liệu vào bản mẫu
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              Khu vực kéo thả chỉ minh họa. Nút chọn tệp bên cạnh là phương án bàn
              phím rõ ràng; tệp được chọn không được tải lên hay lưu lại.
            </p>
            <p
              className="mt-2 min-w-0 text-xs text-slate-400 [overflow-wrap:anywhere]"
              aria-live="polite"
            >
              {selectedFile
                ? `Đã chọn cục bộ: ${selectedFile}`
                : "Chưa có tệp nào được chọn."}
            </p>
          </div>
        </div>

        <div className="flex w-full min-w-0 shrink-0 flex-wrap gap-2 sm:w-auto">
          <input
            ref={inputRef}
            id="document-file-picker"
            type="file"
            onChange={selectFile}
            className="hidden"
            tabIndex={-1}
            accept=".pdf,.doc,.docx,.txt,.md"
          />
          <button
            ref={selectButtonRef}
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            <FileUp aria-hidden="true" className="size-4" />
            Chọn tệp từ máy
          </button>
          {selectedFile ? (
            <button
              type="button"
              onClick={resetSelection}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Bỏ chọn
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
