import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

// Black is the primary action. Negative actions use `outline` + an icon, never
// a burgundy fill (CLAUDE.md, "Design system").
// `before:` is an invisible 2px margin around the button: a pressed button shrinks (`active:scale`), and without it a
// tap right at the edge could end up outside the shrunken box and not count as a click.
const buttonVariants = cva(
  "relative inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out before:absolute before:-inset-0.5 before:content-[''] active:scale-[0.97] motion-reduce:transition-colors motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
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
    /**
     * An action is running: a spinner replaces the content (which keeps its space, so nothing moves), a second press
     * does nothing, and the button stays at full strength (a dimmed button reads as broken).
     * It is not `disabled`, so keyboard focus stays on it.
     */
    loading?: boolean;
    /** Spoken to screen readers while loading ("Working…"); the spinner itself is hidden from them. */
    loadingLabel?: string;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  loadingLabel,
  disabled,
  onClick,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }), loading && "cursor-progress");
  // Pages render this component on the server too, and a server component may not hand a function to an element. So a
  // handler exists only when it is needed: while loading (which only ever happens in client code: it swallows the
  // click, so nothing is pressed or submitted twice), or when the caller passed one. A disabled link made into a
  // button (asChild) is blocked with CSS and by leaving the tab order instead, not with a handler.
  const swallow = (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault();
  const handler = loading ? swallow : onClick;
  if (asChild) {
    const blocked = loading || Boolean(disabled);
    return (
      <Slot
        data-slot="button"
        data-loading={loading || undefined}
        data-disabled={disabled || undefined}
        aria-busy={loading || undefined}
        aria-disabled={blocked || undefined}
        tabIndex={disabled ? -1 : undefined}
        className={classes}
        onClick={disabled && onClick ? swallow : handler}
        {...props}
      >
        {children}
      </Slot>
    );
  }
  return (
    <button
      data-slot="button"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      disabled={disabled}
      className={classes}
      onClick={handler}
      {...props}
    >
      {/* The content keeps its space (so the width never changes) and its place in the accessibility tree (so the button
          keeps its name); only its look is hidden while the spinner shows. */}
      <span className={cn("inline-flex items-center justify-center gap-2", loading && "opacity-0")}>{children}</span>
      {loading ? <LoaderCircle aria-hidden className="absolute inset-0 m-auto animate-spin motion-reduce:animate-none" /> : null}
      {loading && loadingLabel ? <span className="sr-only">{loadingLabel}</span> : null}
    </button>
  );
}

export { buttonVariants };
