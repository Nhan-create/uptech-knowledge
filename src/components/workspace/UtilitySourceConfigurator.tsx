"use client";

import { Check, FileText, LockKeyhole } from "lucide-react";
import { cn } from "@/lib/utils";

export type UtilitySourceId =
  | "handover-v21"
  | "handover-v22"
  | "hr-handbook";

export const utilitySources: Array<{
  id: UtilitySourceId;
  title: string;
  detail: string;
}> = [
  {
    id: "handover-v21",
    title: "Quy trình bàn giao · bản mẫu 2.1",
    detail: "PDF fixture · quyền chưa được xác nhận",
  },
  {
    id: "handover-v22",
    title: "Quy trình bàn giao · bản mẫu 2.2",
    detail: "PDF fixture · quyền chưa được xác nhận",
  },
  {
    id: "hr-handbook",
    title: "Cẩm nang vận hành · bản mẫu",
    detail: "PDF fixture · quyền chưa được xác nhận",
  },
];

type UtilitySourceConfiguratorProps = {
  selectedIds: UtilitySourceId[];
  minSources: number;
  maxSources: number;
  allowedSourceIds?: UtilitySourceId[];
  onChange: (ids: UtilitySourceId[]) => void;
};

export function UtilitySourceConfigurator({
  selectedIds,
  minSources,
  maxSources,
  allowedSourceIds,
  onChange,
}: UtilitySourceConfiguratorProps) {
  const singleSource = minSources === 1 && maxSources === 1;
  const availableSources = allowedSourceIds
    ? utilitySources.filter((source) => allowedSourceIds.includes(source.id))
    : utilitySources;

  function toggleSource(id: UtilitySourceId) {
    if (singleSource) {
      onChange([id]);
      return;
    }

    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((sourceId) => sourceId !== id));
      return;
    }

    if (selectedIds.length < maxSources) {
      onChange([...selectedIds, id]);
    }
  }

  const requirement =
    minSources === maxSources
      ? `Chọn đúng ${minSources} nguồn fixture.`
      : `Chọn từ ${minSources} đến ${maxSources} nguồn fixture.`;

  return (
    <fieldset className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
      <legend className="px-1 text-sm font-semibold text-white">
        2. Chọn nguồn đầu vào
      </legend>
      <p
        id="utility-source-requirement"
        className="mt-1 text-sm leading-6 text-slate-400"
      >
        {requirement} Việc hiển thị tại đây không xác nhận quyền truy cập thật.
      </p>

      <div className="mt-4 grid gap-3">
        {availableSources.map((source) => {
          const checked = selectedIds.includes(source.id);
          const unavailable =
            !singleSource && !checked && selectedIds.length >= maxSources;

          return (
            <label
              key={source.id}
              className={cn(
                "flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                checked
                  ? "border-blue-700 bg-blue-950/35"
                  : "border-slate-800 bg-slate-950/45 hover:border-slate-700",
                unavailable &&
                  "cursor-not-allowed opacity-50 hover:border-slate-800",
              )}
            >
              <input
                type={singleSource ? "radio" : "checkbox"}
                name={singleSource ? "utility-source" : undefined}
                checked={checked}
                disabled={unavailable}
                onChange={() => toggleSource(source.id)}
                aria-describedby="utility-source-requirement"
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-slate-950",
                  singleSource && "rounded-full",
                  checked
                    ? "border-blue-500 bg-blue-600 text-white"
                    : "border-slate-600 bg-slate-900 text-transparent",
                )}
              >
                <Check className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start gap-2 text-sm font-semibold text-slate-200">
                  <FileText
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-slate-400"
                  />
                  <span>{source.title}</span>
                </span>
                <span className="mt-1 flex items-start gap-2 text-xs leading-5 text-slate-400">
                  <LockKeyhole
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0"
                  />
                  <span>{source.detail}</span>
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Đã chọn {selectedIds.length}/{maxSources} nguồn fixture.
      </p>
    </fieldset>
  );
}
