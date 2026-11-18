import {
  Archive,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileClock,
  FileText,
  Search,
  ShieldCheck,
  TriangleAlert,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui";
import type {
  BadgeVariant,
  DocumentSummaryView,
  GovernanceMarker,
  ProcessingKind,
} from "@/features/knowledge/model";

const processingPresentation: Record<
  ProcessingKind,
  { icon: LucideIcon; variant: BadgeVariant }
> = {
  uploading: { icon: UploadCloud, variant: "info" },
  validating: { icon: ShieldCheck, variant: "warning" },
  extracting: { icon: BookOpen, variant: "info" },
  ocr: { icon: FileClock, variant: "warning" },
  indexing: { icon: Search, variant: "info" },
  ready: { icon: CheckCircle2, variant: "success" },
  failed: { icon: TriangleAlert, variant: "danger" },
};

const governanceIcons: Record<GovernanceMarker["kind"], LucideIcon> = {
  official: BadgeCheck,
  verified: ShieldCheck,
  "needs-review": TriangleAlert,
  expiring: Clock3,
  expired: CircleAlert,
  deprecated: Archive,
};

export function DocumentIdentity({ document }: { document: DocumentSummaryView }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl border ${
          document.fileType === "pdf"
            ? "border-[#FACACA] bg-[#FDECEC] text-[#B32018]"
            : document.fileType === "docx"
              ? "border-[#C8D2FF] bg-[#ECF2FF] text-[#1945C2]"
              : "border-[#0D1321]/10 bg-[#F3F4F8] text-[#323B4D]"
        }`}
      >
        <FileText aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="break-words font-semibold leading-5 text-[#0D1321]">
          {document.name}
        </p>
        <p className="mt-1 text-xs leading-5 text-[#505A6E]">{document.detail}</p>
        <GovernanceBadges document={document} />
      </div>
    </div>
  );
}

export function ProcessingStatus({ document }: { document: DocumentSummaryView }) {
  const presentation = processingPresentation[document.processing.kind];
  const StatusIcon = presentation.icon;
  const progress = document.processing.progress;

  return (
    <div className="min-w-0">
      <Badge variant={presentation.variant} size="sm" title={document.processing.description}>
        <StatusIcon aria-hidden="true" className="size-3 shrink-0" />
        {document.processing.label}
      </Badge>
      {typeof progress === "number" ? (
        <div className="mt-2 w-full min-w-36 max-w-52">
          <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-[#505A6E]">
            <span>Tiến độ xử lý</span>
            <span className="glean-tabular font-medium text-[#0D1321]">{progress}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={`Tiến độ xử lý của ${document.name}`}
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 overflow-hidden rounded-full bg-[#E6E9F2]"
          >
            <div className="h-full rounded-full bg-[#1B44FF]" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-[#505A6E]">Đang chuẩn bị cho tìm kiếm & hỏi đáp.</p>
        </div>
      ) : document.processing.kind === "failed" ? (
        <p className="mt-1 text-[11px] text-[#B32018]">Xử lý thất bại · Vui lòng tải lại tệp.</p>
      ) : null}
    </div>
  );
}

export function GovernanceBadges({ document }: { document: DocumentSummaryView }) {
  if (!document.governance.length) return null;

  return (
    <ul aria-label={`Nhãn quản trị của ${document.name}`} className="mt-2 flex flex-wrap gap-1.5">
      {document.governance.map((marker) => {
        const Icon = governanceIcons[marker.kind];
        return (
          <li key={marker.kind}>
            <Badge
              variant={marker.variant}
              size="sm"
              title={marker.description}
            >
              <Icon aria-hidden="true" className="size-3 shrink-0" />
              {marker.label}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
