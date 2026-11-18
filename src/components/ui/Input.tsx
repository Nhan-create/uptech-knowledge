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
          "flex h-11 w-full rounded-xl border border-[#0D1321]/16 bg-white px-3.5 py-2 text-sm text-[#0D1321] placeholder:text-[#505A6E] transition-colors",
          "focus-visible:border-[#1B44FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B44FF]/25",
          "disabled:cursor-not-allowed disabled:bg-[#F3F4F8] disabled:opacity-60",
          error &&
            "border-[#DC2626] text-[#B32018] placeholder:text-[#B32018]/60 focus-visible:border-[#DC2626] focus-visible:ring-[#DC2626]/25",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
