import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium rounded-xl transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer active:translate-y-px";

    const variantStyles = {
      primary:
        "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-sm shadow-blue-950/30 border border-blue-400/30",
      secondary:
        "bg-slate-800 text-slate-100 hover:bg-slate-700 active:bg-slate-850 border border-slate-700/60",
      outline:
        "bg-transparent text-slate-200 border border-slate-700 hover:bg-slate-800/60 hover:border-slate-600",
      ghost:
        "bg-transparent text-slate-300 hover:bg-slate-800/60 hover:text-slate-100",
      danger:
        "bg-rose-600 text-white hover:bg-rose-500 active:bg-rose-700 border border-rose-500/30 shadow-sm shadow-rose-600/20",
    };

    const sizeStyles = {
      sm: "h-11 px-3 text-xs gap-1.5 min-h-11",
      md: "h-11 px-4 text-sm gap-2 min-h-11",
      lg: "h-12 px-6 text-base gap-2.5 min-h-12",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        {...props}
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-current" />}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
