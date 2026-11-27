import type * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="glass w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("text-left text-muted-foreground", className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={className} {...props} />;
}

export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={className} {...props} />;
}

export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("h-10 whitespace-nowrap px-4 text-xs font-medium", className)} {...props} />;
}

export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3.5 align-middle", className)} {...props} />;
}
