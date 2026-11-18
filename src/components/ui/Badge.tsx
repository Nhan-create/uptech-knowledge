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
      "bg-[#F3F4F8] text-[#323B4D] border-[#0D1321]/10",
    info:
      "bg-[#ECF2FF] text-[#1945C2] border-[#C8D2FF]",
    success:
      "bg-[#E7F7EF] text-[#076944] border-[#BBEAD2]",
    warning:
      "bg-[#FFF3DE] text-[#924D05] border-[#F6D59B]",
    danger:
      "bg-[#FDECEC] text-[#B32018] border-[#FACACA]",
  };

  const dotStyles = {
    neutral: "bg-[#505A6E]",
    info: "bg-[#1B44FF]",
    success: "bg-[#059669]",
    warning: "bg-[#D97706]",
    danger: "bg-[#DC2626]",
  };

  const sizeStyles = {
    sm: "px-2.5 py-0.5 text-[11px] gap-1.5",
    md: "px-3 py-1 text-xs gap-1.5",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium leading-none tracking-tight select-none",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotStyles[variant])}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
