"use client";

import { useState } from "react";
import {
  AlignLeft,
  Check,
  ClipboardCheck,
  FileChartColumn,
  GitCompareArrows,
  Languages,
  ListChecks,
  Mail,
  PencilLine,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import { IconTile } from "@/components/workspace/WorkspacePrimitives";
import {
  UtilitySourceConfigurator,
  utilitySources,
  type UtilitySourceId,
} from "@/components/workspace/UtilitySourceConfigurator";

type UtilityId =
  | "summary"
  | "translate"
  | "checklist"
  | "report"
  | "email"
  | "compare";

type Tool = {
  id: UtilityId;
  title: string;
  description: string;
  input: string;
  icon: LucideIcon;
  tone: "blue" | "violet" | "emerald" | "amber" | "slate";
  minSources: number;
  maxSources: number;
  allowedSourceIds?: UtilitySourceId[];
};

const tools: Tool[] = [
  {
    id: "summary",
    title: "Tóm tắt",
    description: "Rút ý chính thành bản nháp ngắn, luôn ghi nhãn nguồn fixture.",
    input: "Đúng 1 nguồn fixture",
    icon: AlignLeft,
    tone: "blue",
    minSources: 1,
    maxSources: 1,
  },
  {
    id: "translate",
    title: "Dịch thuật",
    description: "Chuẩn bị bản dịch mẫu để người dùng kiểm tra thuật ngữ.",
    input: "1 nguồn · đích tiếng Anh fixture",
    icon: Languages,
    tone: "violet",
    minSources: 1,
    maxSources: 1,
  },
  {
    id: "checklist",
    title: "Checklist",
    description: "Chuyển nội dung nguồn thành danh sách việc cần rà soát.",
    input: "1–3 nguồn fixture",
    icon: ListChecks,
    tone: "emerald",
    minSources: 1,
    maxSources: 3,
  },
  {
    id: "report",
    title: "Báo cáo",
    description: "Tạo cấu trúc báo cáo nội bộ mẫu có phát hiện và đề xuất.",
    input: "1 nguồn · mẫu đầu ra fixture",
    icon: FileChartColumn,
    tone: "amber",
    minSources: 1,
    maxSources: 1,
  },
  {
    id: "email",
    title: "Email",
    description: "Soạn email nháp để chỉnh sửa; không gửi ra bên ngoài.",
    input: "1 nguồn · người đọc fixture",
    icon: Mail,
    tone: "blue",
    minSources: 1,
    maxSources: 1,
  },
  {
    id: "compare",
    title: "So sánh",
    description: "Đối chiếu hai phiên bản quy trình fixture bằng chữ lẫn ký hiệu.",
    input: "Đúng 2 phiên bản bàn giao fixture",
    icon: GitCompareArrows,
    tone: "violet",
    minSources: 2,
    maxSources: 2,
    allowedSourceIds: ["handover-v21", "handover-v22"],
  },
];

type UtilitySource = (typeof utilitySources)[number];

const sourceNotes: Record<
  UtilitySourceId,
  { vietnamese: string; english: string }
> = {
  "handover-v21": {
    vietnamese:
      "Fixture 2.1 mô tả bước chuẩn bị hồ sơ, kiểm tra tài sản và chốt đầu việc bàn giao.",
    english:
      "Fixture 2.1 describes document preparation, asset review, and confirmation of handover actions.",
  },
  "handover-v22": {
    vietnamese:
      "Fixture 2.2 bổ sung bước rà soát quyền truy cập và người phụ trách cho đầu việc còn mở.",
    english:
      "Fixture 2.2 adds access review and an owner for each outstanding handover action.",
  },
  "hr-handbook": {
    vietnamese:
      "Cẩm nang fixture mô tả kênh phối hợp, đầu mối hỗ trợ và bước xác nhận thông tin nội bộ.",
    english:
      "The handbook fixture describes coordination channels, support contacts, and internal information checks.",
  },
};

function createDraft(toolId: UtilityId, sources: UtilitySource[]) {
  const [primarySource, secondarySource] = sources;

  if (!primarySource) return "";

  const primaryNote = sourceNotes[primarySource.id];
  const sourceLabel = `[Nguồn fixture: ${primarySource.title}]`;

  switch (toolId) {
    case "summary":
      return `${primaryNote.vietnamese}\n\n${sourceLabel}\nBản nháp cần được đối chiếu lại với chính fixture đã chọn trước khi sử dụng.`;
    case "translate":
      return `Fixture translation — ${primarySource.title}\n\n${primaryNote.english}\n\n[Fixture source: ${primarySource.title}]\nTerminology requires human review before use.`;
    case "checklist":
      return `${sources
        .map(
          (source) =>
            `□ Rà soát ${source.title}: ${sourceNotes[source.id].vietnamese}`,
        )
        .join("\n")}\n\n□ Xác nhận người phụ trách và thời hạn\n□ Đối chiếu từng mục với các nguồn fixture đã chọn`;
    case "report":
      return `1. Nguồn fixture\n${primarySource.title}\n\n2. Phát hiện minh họa\n${primaryNote.vietnamese}\n\n3. Đề xuất rà soát\nĐối chiếu phát hiện với nguồn fixture và xác nhận người có thẩm quyền trước khi dùng.`;
    case "email":
      return `Tiêu đề: [Bản nháp fixture] Nội dung cần rà soát từ ${primarySource.title}\n\nChào anh/chị,\n\nMình gửi ghi chú minh họa từ nguồn đã chọn: ${primaryNote.vietnamese}\n\nVui lòng kiểm tra lại fixture trước mọi hành động tiếp theo.\n\nTrân trọng,`;
    case "compare":
      if (!secondarySource) return "";
      return `NGUỒN A · ${primarySource.title}\n${primaryNote.vietnamese}\n\nNGUỒN B · ${secondarySource.title}\n${sourceNotes[secondarySource.id].vietnamese}\n\nĐỐI CHIẾU FIXTURE\nKhác biệt trên được mô phỏng từ đúng hai phiên bản đã chọn; cần đối chiếu tài liệu gốc và không được xem là kết luận pháp lý.`;
  }
}

export function UtilityWorkbench() {
  const [activeTool, setActiveTool] = useState<UtilityId>("summary");
  const [selectedSourceIds, setSelectedSourceIds] = useState<UtilitySourceId[]>(
    [],
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Chưa chạy tác vụ demo. Hãy chọn nguồn fixture hợp lệ.",
  );

  const selectedTool =
    tools.find((tool) => tool.id === activeTool) ?? tools[0];
  const sourceSelectionIsValid =
    selectedSourceIds.length >= selectedTool.minSources &&
    selectedSourceIds.length <= selectedTool.maxSources;
  const selectedSources = utilitySources.filter((source) =>
    selectedSourceIds.includes(source.id),
  );

  function selectTool(tool: Tool) {
    if (tool.id === activeTool) return;
    setActiveTool(tool.id);
    setSelectedSourceIds([]);
    setDraft(null);
    setReviewed(false);
    setStatusMessage(
      `Đã chọn tác vụ ${tool.title}. Hãy chọn nguồn fixture phù hợp.`,
    );
  }

  function updateSources(ids: UtilitySourceId[]) {
    setSelectedSourceIds(ids);
    setReviewed(false);
    setStatusMessage(
      `Đã chọn ${ids.length} nguồn fixture cho tác vụ ${selectedTool.title}.`,
    );
  }

  function runDemo() {
    if (!sourceSelectionIsValid) return;
    setDraft(createDraft(activeTool, selectedSources));
    setReviewed(false);
    setStatusMessage(
      `Đã tạo bản nháp fixture cho tác vụ ${selectedTool.title}. Chưa có dữ liệu nào được lưu hoặc gửi.`,
    );
  }

  function resetDraft() {
    setDraft(createDraft(activeTool, selectedSources));
    setReviewed(false);
    setStatusMessage("Đã đặt lại nội dung về bản nháp fixture ban đầu.");
  }

  function changeConfiguration() {
    setDraft(null);
    setReviewed(false);
    setStatusMessage(
      "Đã quay lại bước cấu hình. Lựa chọn nguồn fixture được giữ lại.",
    );
  }

  function toggleReviewed() {
    setReviewed((current) => !current);
    setStatusMessage(
      reviewed
        ? "Đã bỏ đánh dấu rà soát cho bản nháp fixture."
        : "Đã đánh dấu bản nháp fixture là đã rà soát trong phiên này.",
    );
  }

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.72fr)] xl:items-start">
      <section
        aria-labelledby="utility-tools-heading"
        className="min-w-0 space-y-6"
      >
        <div>
          <h2 id="utility-tools-heading" className="text-lg font-semibold text-white">
            1. Chọn tác vụ mẫu
          </h2>
          <p className="mt-1 text-sm leading-5 text-slate-400">
            Chuyển tác vụ sẽ xóa cấu hình và bản nháp đang mở trong phiên này.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              aria-pressed={activeTool === tool.id}
              onClick={() => selectTool(tool)}
              className={cn(
                "group min-h-48 rounded-2xl border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                activeTool === tool.id
                  ? "border-blue-600 bg-blue-950/35 shadow-lg shadow-blue-950/20"
                  : "border-slate-800 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <IconTile icon={tool.icon} tone={tool.tone} />
                {activeTool === tool.id ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-700 bg-blue-950 px-2 py-1 text-[11px] font-semibold text-blue-300">
                    <Check aria-hidden="true" className="size-3" />
                    Đang chọn
                  </span>
                ) : (
                  <Badge variant="neutral" size="sm">
                    Fixture
                  </Badge>
                )}
              </div>
              <h3 className="mt-5 font-semibold text-white">{tool.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {tool.description}
              </p>
              <p className="mt-4 text-xs text-slate-400">Đầu vào: {tool.input}</p>
            </button>
          ))}
        </div>

        {draft === null ? (
          <div className="space-y-4">
            <UtilitySourceConfigurator
              selectedIds={selectedSourceIds}
              minSources={selectedTool.minSources}
              maxSources={selectedTool.maxSources}
              allowedSourceIds={selectedTool.allowedSourceIds}
              onChange={updateSources}
            />
            <button
              type="button"
              onClick={runDemo}
              disabled={!sourceSelectionIsValid}
              aria-describedby="utility-run-note"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              <Play aria-hidden="true" className="size-4" />
              Chạy demo cục bộ
            </button>
            <p id="utility-run-note" className="text-xs leading-5 text-slate-400">
              Nút chỉ tạo nội dung fixture trong trình duyệt; không gọi AI, API hay
              kiểm tra quyền thật.
            </p>
          </div>
        ) : (
          <Card className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Cấu hình đã chạy</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  {selectedSources.length} nguồn fixture · {selectedTool.title}
                </p>
              </div>
              <button
                type="button"
                onClick={changeConfiguration}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition-colors hover:border-blue-700 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <Settings2 aria-hidden="true" className="size-4" />
                Đổi cấu hình
              </button>
            </div>
          </Card>
        )}
      </section>

      <section
        aria-labelledby="draft-heading"
        className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-2xl shadow-black/20 xl:sticky xl:top-24"
      >
        <header className="flex flex-col gap-3 border-b border-slate-800 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <IconTile icon={PencilLine} tone="blue" />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-400">
                3. Bản nháp và rà soát
              </p>
              <h2 id="draft-heading" className="mt-1 font-semibold text-white">
                {selectedTool.title} · Kết quả fixture
              </h2>
            </div>
          </div>
          <Badge
            variant={
              draft === null ? "neutral" : reviewed ? "success" : "warning"
            }
            dot={draft !== null}
          >
            {draft === null
              ? "Chưa chạy"
              : reviewed
                ? "Đã rà soát"
                : "Chờ rà soát"}
          </Badge>
        </header>

        <div className="p-5">
          {draft === null ? (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/45 px-5 py-10 text-center">
              <IconTile icon={Settings2} tone="slate" className="size-12" />
              <h3 className="mt-4 font-semibold text-white">Chưa có bản nháp</h3>
              <p className="mt-1 max-w-sm text-sm leading-6 text-slate-400">
                Chọn đủ nguồn fixture ở bước 2 rồi chạy demo để tạo nội dung có thể
                chỉnh sửa.
              </p>
            </div>
          ) : (
            <>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
              <span className="text-xs font-medium text-slate-400">
                Nguồn fixture:
              </span>
              {selectedSources.map((source) => (
                <span
                  key={source.id}
                  className="max-w-full rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300"
                >
                  {source.title}
                </span>
              ))}
            </div>

            <label htmlFor="utility-draft" className="mt-3 block text-xs font-semibold text-slate-400">
              Nội dung bản nháp
            </label>
            <textarea
              id="utility-draft"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setReviewed(false);
                setStatusMessage(
                  "Nội dung fixture đã thay đổi; trạng thái rà soát được đặt lại.",
                );
              }}
              rows={12}
              className="mt-2 min-h-72 w-full resize-y rounded-lg border border-slate-700 bg-slate-900 p-3 text-base leading-7 text-slate-200 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 sm:text-sm"
              aria-describedby="draft-safety-note"
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={toggleReviewed}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            >
              <ClipboardCheck aria-hidden="true" className="size-4" />
              {reviewed ? "Bỏ đánh dấu đã rà soát" : "Đánh dấu đã rà soát"}
            </button>
            <button
              type="button"
              onClick={resetDraft}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Đặt lại bản nháp
            </button>
          </div>

          <p
            id="draft-safety-note"
            className="mt-4 flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-xs leading-5 text-amber-200"
          >
            <Sparkles aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Đây là nội dung fixture cục bộ. Các thao tác không lưu, không gửi
            email, không xuất bản, không tạo công việc và không xác nhận quyền truy
            cập.
          </p>
            </>
          )}
          <p
            className="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {statusMessage}
          </p>
        </div>
      </section>
    </div>
  );
}
