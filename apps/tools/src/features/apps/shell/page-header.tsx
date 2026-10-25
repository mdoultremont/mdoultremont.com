import type { ReactNode } from "react"
import { ShellSlot } from "./shell-slots"

/** The title block every app page starts with. `actions` sit in the shell header, beside the breadcrumb. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-8 min-w-0">
      <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
        {title}
      </h1>
      {description ? (
        <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
      ) : null}
      {actions ? <ShellSlot slot="actions">{actions}</ShellSlot> : null}
    </div>
  )
}
