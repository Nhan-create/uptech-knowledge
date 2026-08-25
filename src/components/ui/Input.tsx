import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", error = false, disabled, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        disabled={disabled}
        aria-invalid={error ? "true" : undefined}
        className={cn(
          "flex h-11 w-full rounded-xl bg-slate-900 px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-400",
          "border border-slate-700/80 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70 focus-visible:border-blue-400",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-950",
          error &&
            "border-rose-500/80 focus-visible:ring-rose-500 focus-visible:border-rose-500 text-rose-100 placeholder:text-rose-400/50",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
