import type * as React from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div data-page-header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold max-sm:text-[1.75rem] max-sm:font-bold max-sm:leading-[1.2]">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}
