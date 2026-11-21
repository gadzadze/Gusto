import type * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("skeleton rounded-md bg-border/70", className)} {...props} />;
}
