import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/** Inline form-level message. Errors always carry an icon (CLAUDE.md, "Design system"). */
export function FormAlert({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
        tone === "error"
          ? "bg-destructive/10 text-destructive"
          : "bg-[var(--status-green-bg)] text-[var(--status-green-fg)]",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
