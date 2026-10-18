import type { App } from "@/shared/apps"
import { appCatalog } from "@/features/apps/catalog"
import { Checkbox } from "@/features/ui/checkbox"
import { Label } from "@/features/ui/label"

export function AppCheckboxes({
  selected,
  onChange,
  disabled = false,
  locked = [],
}: {
  selected: ReadonlyArray<App>
  onChange: (apps: ReadonlyArray<App>) => void
  disabled?: boolean
  /** Apps shown as granted that cannot be unchecked here. */
  locked?: ReadonlyArray<App>
}) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-3">
      {appCatalog.map((app) => (
        <Label
          className="font-normal has-data-disabled:cursor-not-allowed has-data-disabled:text-muted-foreground"
          key={app.id}
        >
          <Checkbox
            checked={selected.includes(app.id)}
            disabled={disabled || locked.includes(app.id)}
            onCheckedChange={(checked) =>
              onChange(
                appCatalog
                  .map((entry) => entry.id)
                  .filter((id) =>
                    id === app.id ? checked : selected.includes(id)
                  )
              )
            }
          />
          {app.name}
        </Label>
      ))}
    </div>
  )
}
