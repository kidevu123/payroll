// shadcn-style button. Phase-6.5 premium polish: subtle elevation on
// primary, refined ring colors, tactile active-press, smooth transitions.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Apple-bold base: rounder corners (rounded-xl), semibold confident text,
  // smooth transition so press eases, softened focus ring, tactile active-press.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold tracking-tight antialiased select-none transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98]",
  {
    variants: {
      variant: {
        // Primary: solid accent fill, white text, soft Apple-clean shadow.
        // Confident but not loud — hover deepens tone and lifts gently.
        default:
          "bg-brand-700 text-white shadow-[0_1px_2px_0_rgb(15_23_42_/_0.08),0_4px_10px_-3px_rgb(15_118_110_/_0.22)] hover:bg-brand-800 hover:shadow-[0_2px_4px_0_rgb(15_23_42_/_0.10),0_6px_14px_-3px_rgb(15_118_110_/_0.28)]",
        // Secondary: refined surface with hairline border + subtle shadow.
        secondary:
          "bg-surface text-text border border-border shadow-[0_1px_2px_0_rgb(15_23_42_/_0.04)] hover:bg-surface-2 hover:border-border-strong",
        outline: "bg-surface text-text border border-border hover:bg-surface-2",
        ghost: "text-text hover:bg-surface-2",
        destructive:
          "bg-danger-700 text-white shadow-[0_1px_2px_0_rgb(15_23_42_/_0.08)] hover:bg-danger-700/90",
      },
      size: {
        default: "min-h-11 px-4 py-2",
        sm: "min-h-10 px-3.5 py-2 text-xs",
        lg: "min-h-12 px-6 py-2.5",
        icon: "h-11 w-11 shrink-0 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
