// shadcn-style button. Phase-6.5 premium polish: subtle elevation on
// primary, refined ring colors, tactile active-press, smooth transitions.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Squared-intentional base (owner direction Jul 2026): buttons share the
  // input radius so controls read as one precise family. Calm pass: medium
  // weight — smooth transition, softened focus ring, tactile active-press.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-input text-sm font-medium tracking-tight antialiased select-none transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98]",
  {
    variants: {
      variant: {
        // Primary: solid accent fill, white text, soft Apple-clean shadow.
        // Confident but not loud — hover deepens tone and lifts gently.
        default:
          "bg-brand-700 text-white shadow-[0_1px_2px_0_rgb(15_23_42_/_0.08),0_4px_10px_-3px_rgb(6_112_73_/_0.22)] hover:bg-brand-800 hover:shadow-[0_2px_4px_0_rgb(15_23_42_/_0.10),0_6px_14px_-3px_rgb(6_112_73_/_0.28)]",
        // Secondary: refined surface with hairline border + subtle shadow.
        secondary:
          "bg-surface text-text border border-border shadow-[0_1px_2px_0_rgb(15_23_42_/_0.04)] hover:bg-surface-2 hover:border-border-strong",
        outline:
          "bg-surface text-text border border-border hover:bg-surface-2",
        ghost: "text-text hover:bg-surface-2",
        destructive:
          "bg-danger-700 text-white shadow-[0_1px_2px_0_rgb(15_23_42_/_0.08)] hover:bg-danger-700/90",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3.5 text-xs",
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

/**
 * IconButton — square, icon-only control with a MANDATORY accessible name.
 *
 * Prevents the two recurring bugs the design audit found:
 *   1. Geometry collision — a fixed square (`w-10`) that also holds text turns
 *      a circle into a broken pill. IconButton never renders text, so the
 *      square footprint is always honest.
 *   2. Missing accessible name — `aria-label` is required at the type level, so
 *      an icon-only button can't ship without a screen-reader name.
 *
 * Touch-friendly by default (min 44px hit area) while staying visually 36–40px.
 */
export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    Pick<VariantProps<typeof buttonVariants>, "variant"> {
  /** Required: screen-reader name for the icon-only action. */
  "aria-label": string;
  /** The icon element (aria-hidden). */
  children: React.ReactNode;
  /** Visual footprint. Defaults to md (40px); sm (32px) for dense tables. */
  sizePx?: "sm" | "md";
  asChild?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = "ghost", sizePx = "md", asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        type={asChild ? undefined : "button"}
        className={cn(
          buttonVariants({ variant }),
          // Square footprint + generous touch target (hit area >= 44px via
          // padding-free min sizing on touch, visual box stays compact).
          "shrink-0 rounded-input p-0",
          sizePx === "sm" ? "h-8 w-8 min-h-8 min-w-8" : "h-10 w-10",
          "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);
IconButton.displayName = "IconButton";

export { buttonVariants };
