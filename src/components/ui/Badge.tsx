import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "neutral" | "info" | "success" | "warning" | "danger";
  size?: "sm" | "md";
  dot?: boolean;
}

export function Badge({
  className,
  variant = "neutral",
  size = "md",
  dot = false,
  children,
  ...props
}: BadgeProps) {
  const variantStyles = {
    neutral:
      "bg-slate-800/80 text-slate-300 border-slate-700/60",
    info:
      "bg-sky-950/70 text-sky-300 border-sky-800/50",
    success:
      "bg-emerald-950/70 text-emerald-300 border-emerald-800/50",
    warning:
      "bg-amber-950/70 text-amber-300 border-amber-800/50",
    danger:
      "bg-rose-950/70 text-rose-300 border-rose-800/50",
  };

  const dotStyles = {
    neutral: "bg-slate-400",
    info: "bg-sky-400",
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    danger: "bg-rose-400",
  };

  const sizeStyles = {
    sm: "px-2 py-0.5 text-[11px] gap-1.5",
    md: "px-2.5 py-1 text-xs gap-1.5",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-md border tracking-tight leading-none select-none",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotStyles[variant])}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
