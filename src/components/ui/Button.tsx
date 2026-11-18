import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
    ref,
  ) => {
    const baseStyles =
      "inline-flex cursor-pointer select-none items-center justify-center rounded-full font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B44FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF9FB] active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

    const variantStyles = {
      primary:
        "bg-[#1B44FF] [color:#FFFFFF] hover:bg-[#1436D6] active:bg-[#102BB3] border border-transparent shadow-sm",
      secondary:
        "bg-[#0B1220] [color:#FFFFFF] hover:bg-[#172136] border border-transparent",
      outline:
        "bg-white text-[#0D1321] border border-[#0D1321]/16 hover:bg-[#F3F4F8]",
      ghost:
        "bg-transparent text-[#323B4D] hover:bg-[#F3F4F8] hover:text-[#0D1321]",
      danger:
        "bg-[#DC2626] [color:#FFFFFF] hover:bg-[#B91C1C] border border-transparent shadow-sm",
    };

    const sizeStyles = {
      sm: "h-10 min-h-10 px-3.5 text-xs gap-1.5",
      md: "h-11 min-h-11 px-4 text-sm gap-2",
      lg: "h-12 min-h-12 px-6 text-base gap-2.5",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        {...props}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-current" />}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
