import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

// Black is the primary action. Negative actions use `outline` + an icon, never
// a burgundy fill (CLAUDE.md, "Design system").
const buttonVariants = cva(
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-colors motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 data-[loading=true]:disabled:opacity-100 data-[loading=true]:[&>svg:not(.animate-spin)]:hidden [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border border-border bg-background hover:bg-muted",
        ghost: "hover:bg-muted",
        link: "min-h-0 px-0 text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "",
        sm: "min-h-9 px-3 max-md:min-h-11",
        lg: "min-h-12 px-6 text-base",
        icon: "size-11 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** An action is running: shows a spinner, blocks a second press, and keeps the button at full strength (a dimmed button reads as broken). */
    loading?: boolean;
  };

export function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  if (asChild) return <Slot data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props}>{children}</Slot>;
  return (
    <button
      data-slot="button"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }), loading && "cursor-progress")}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
      {children}
    </button>
  );
}

export { buttonVariants };
