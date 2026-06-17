// shadcn-style button. Phase-6.5 premium polish: subtle elevation on
// primary, refined ring colors, tactile active-press, smooth transitions.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Premium base: smooth `transition-all` so transforms ease too,
  // softened focus ring (60% brand for less aggressive contrast),
  // active-scale for tactile press, antialiased text.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-input text-sm font-medium tracking-tight antialiased select-none transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98]",
  {
    variants: {
      variant: {
        // Primary: brand teal with subtle inner highlight + soft brand
        // shadow. Hover deepens tone + lifts shadow.
        default:
          "bg-brand-700 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.12),0_1px_2px_0_rgb(15_23_42_/_0.08),0_4px_10px_-2px_rgb(15_118_110_/_0.25)] hover:bg-brand-800 hover:shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.14),0_2px_4px_0_rgb(15_23_42_/_0.10),0_6px_14px_-2px_rgb(15_118_110_/_0.32)]",
        // Secondary: refined surface with hairline border + subtle shadow.
        secondary:
          "bg-surface text-text border border-border shadow-[0_1px_2px_0_rgb(15_23_42_/_0.04)] hover:bg-surface-2 hover:border-border-strong",
        outline:
          "bg-surface text-text border border-border hover:bg-surface-2",
        ghost: "text-text hover:bg-surface-2",
        destructive:
          "bg-danger-700 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.14),0_1px_2px_0_rgb(15_23_42_/_0.08)] hover:bg-danger-700/90",
        // Signature: violet→indigo→blue brand gradient fill with a soft glow.
        // White text, subtle inner highlight, glow deepens + brightens on hover.
        gradient:
          "bg-brand-gradient text-white shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.18),0_2px_6px_-1px_rgb(79_70_229_/_0.30),0_8px_20px_-6px_rgb(124_58_237_/_0.40)] hover:brightness-[1.06] hover:shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.22),0_3px_8px_-1px_rgb(79_70_229_/_0.36),0_12px_28px_-6px_rgb(124_58_237_/_0.50)] focus-visible:ring-brand-700/40",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
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
