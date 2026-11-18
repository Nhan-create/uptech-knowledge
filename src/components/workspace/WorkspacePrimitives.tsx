import type { ReactNode } from "react";
import { Info, ShieldAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type IconTone = "blue" | "slate" | "violet" | "emerald" | "amber" | "rose";

const tileTones: Record<IconTone, string> = {
  blue: "border-[#C8D2FF] bg-[#EEF1FF] text-[#1635C7]",
  slate: "border-[#0D1321]/10 bg-[#F3F4F8] text-[#323B4D]",
  violet: "border-[#DDD6FE] bg-[#F5F3FF] text-[#6D28D9]",
  emerald: "border-[#BBEAD2] bg-[#E7F7EF] text-[#076944]",
  amber: "border-[#F6D59B] bg-[#FFF3DE] text-[#924D05]",
  rose: "border-[#FACACA] bg-[#FDECEC] text-[#B32018]",
};

const stateTone: Record<IconTone, string> = {
  blue: "border-[#C8D2FF] bg-[#F6F8FF] text-[#0D1321]",
  slate: "border-[#0D1321]/10 bg-white text-[#0D1321]",
  violet: "border-[#DDD6FE] bg-[#FAF8FF] text-[#0D1321]",
  emerald: "border-[#BBEAD2] bg-[#F4FBF7] text-[#0D1321]",
  amber: "border-[#F6D59B] bg-[#FFF9EF] text-[#0D1321]",
  rose: "border-[#FACACA] bg-[#FFF8F8] text-[#0D1321]",
};

export function WorkspacePage({ children }: { children: ReactNode }) {
  return <div className="min-w-0 space-y-6">{children}</div>;
}

export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}>) {
  return (
    <header className="flex flex-col gap-4 border-b border-[#0D1321]/8 pb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C8D2FF] bg-[#EEF1FF] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#1635C7]">
          {eyebrow}
        </span>
        <h1 className="mt-3 text-2xl font-bold tracking-[-0.03em] text-[#0D1321] sm:text-[2rem] sm:leading-[1.14]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[#505A6E]">
          {description}
        </p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function DemoNotice({ className }: { className?: string }) {
  return (
    <aside
      aria-label="Thông tin phạm vi dữ liệu bản mẫu"
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-[#C8D2FF]/80 bg-[#F6F8FF] px-4 py-3 text-xs leading-5 text-[#323B4D]",
        className,
      )}
    >
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[#EEF1FF] text-[#1635C7]">
        <ShieldAlert aria-hidden="true" className="size-4" />
      </span>
      <p className="min-w-0">
        <span className="font-semibold text-[#0D1321]">
          Không gian dữ liệu mẫu · Chỉ đọc cục bộ.
        </span>{" "}
        Nội dung hiển thị từ catalog fixture để kiểm chứng luồng hỏi đáp, trích
        dẫn nguồn và công cụ xử lý tài liệu; chưa kết nối backend sản xuất hay
        ACL thực.
      </p>
    </aside>
  );
}

export function SectionHeading({
  id,
  title,
  description,
  action,
}: Readonly<{
  id?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}>) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2
          id={id}
          className="text-lg font-bold tracking-[-0.02em] text-[#0D1321] sm:text-xl"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm leading-6 text-[#505A6E]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function IconTile({
  icon: Icon,
  tone = "slate",
  className,
}: Readonly<{
  icon: LucideIcon;
  tone?: IconTone;
  className?: string;
}>) {
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-xl border",
        tileTones[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-5" />
    </span>
  );
}

export function PrototypeHint({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-[#0D1321]/8 bg-[#F3F4F8] px-3.5 py-2.5 text-xs leading-5 text-[#505A6E]">
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#1945C2]" />
      <span>{children}</span>
    </p>
  );
}

export type PreviewStateItem = Readonly<{
  label: string;
  description: string;
  tone?: IconTone;
}>;

export function StatePreview({
  id,
  title,
  description,
  states,
}: Readonly<{
  id?: string;
  title: string;
  description?: string;
  states: readonly PreviewStateItem[];
}>) {
  return (
    <section className="mt-8" aria-labelledby={id}>
      <SectionHeading
        id={id}
        title={`Bộ trạng thái · ${title}`}
        description={description}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {states.map((state) => (
          <article
            key={state.label}
            className={cn(
              "rounded-2xl border p-4 shadow-[0_4px_12px_-6px_rgba(11,18,32,0.06)]",
              stateTone[state.tone ?? "slate"],
            )}
          >
            <h3 className="text-sm font-semibold text-[#0D1321]">{state.label}</h3>
            <p className="mt-1.5 text-xs leading-5 text-[#505A6E]">
              {state.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
