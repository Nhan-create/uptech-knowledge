import type { ReactNode } from "react";
import { FlaskConical, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type PageIntroProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export function WorkspacePage({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {children}
    </div>
  );
}

export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
}: PageIntroProps) {
  return (
    <header className="flex flex-col gap-5 border-b border-slate-800/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">
          {eyebrow}
        </p>
        <h1 className="text-pretty text-2xl font-bold tracking-tight text-white sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
          {description}
        </p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}

export function DemoNotice({ className }: { className?: string }) {
  return (
    <aside
      aria-label="Thông báo dữ liệu minh họa"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-blue-900/70 bg-blue-950/35 px-4 py-3 text-sm text-blue-100",
        className,
      )}
    >
      <FlaskConical
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-blue-400"
      />
      <p className="leading-5">
        <span className="font-semibold text-blue-200">Bản mẫu UI.</span>{" "}
        Tên tài liệu, số liệu và trạng thái trên màn hình đều là dữ liệu minh họa;
        chưa kết nối API hay xác nhận quyền truy cập.
      </p>
    </aside>
  );
}

type SectionHeadingProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  id?: string;
};

export function SectionHeading({
  title,
  description,
  action,
  id,
}: SectionHeadingProps) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight text-white">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm leading-5 text-slate-400">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type IconTileProps = {
  icon: LucideIcon;
  tone?: "blue" | "violet" | "emerald" | "amber" | "slate";
  className?: string;
};

const iconTone = {
  blue: "border-blue-800/60 bg-blue-950/70 text-blue-300",
  violet: "border-violet-800/60 bg-violet-950/70 text-violet-300",
  emerald: "border-emerald-800/60 bg-emerald-950/70 text-emerald-300",
  amber: "border-amber-800/60 bg-amber-950/70 text-amber-300",
  slate: "border-slate-700 bg-slate-800/80 text-slate-300",
};

export function IconTile({
  icon: Icon,
  tone = "blue",
  className,
}: IconTileProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-xl border",
        iconTone[tone],
        className,
      )}
    >
      <Icon className="size-5" strokeWidth={1.8} />
    </span>
  );
}

export function PrototypeHint({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs leading-5 text-slate-400">
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

type StatePreviewItem = {
  label: string;
  description: string;
  tone?: "blue" | "emerald" | "amber" | "rose" | "slate";
};

const stateTone = {
  blue: "border-blue-800/60 bg-blue-950/30 text-blue-200",
  emerald: "border-emerald-800/60 bg-emerald-950/25 text-emerald-200",
  amber: "border-amber-800/60 bg-amber-950/25 text-amber-200",
  rose: "border-rose-800/60 bg-rose-950/25 text-rose-200",
  slate: "border-slate-700 bg-slate-900/60 text-slate-200",
};

export function StatePreview({
  id,
  title,
  description,
  states,
}: {
  id: string;
  title: string;
  description: string;
  states: readonly StatePreviewItem[];
}) {
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
              "rounded-xl border p-4",
              stateTone[state.tone ?? "slate"],
            )}
          >
            <h3 className="text-sm font-semibold">{state.label}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              {state.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
