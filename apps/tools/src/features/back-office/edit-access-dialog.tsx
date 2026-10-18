import { CircleAlertIcon } from "lucide-react"
import { useState } from "react"
import type { App } from "@/shared/apps"
import { Alert, AlertDescription } from "@/features/ui/alert"
import { Button } from "@/features/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/features/ui/dialog"
import { FieldLegend, FieldSet } from "@/features/ui/field"
import { AppCheckboxes } from "./app-checkboxes"

/** Chooses the apps a user may use. Opened from the row menu; closes once saved. */
export function EditAccessDialog({
  name,
  selected,
  locked,
  open,
  onOpenChange,
  busy,
  error,
  onSave,
}: {
  name: string
  selected: ReadonlyArray<App>
  locked: ReadonlyArray<App>
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  /** Why the last change failed, shown in the dialog so it is not hidden behind it. */
  error: string | null
  onSave: (apps: ReadonlyArray<App>) => Promise<boolean>
}) {
  const [apps, setApps] = useState(selected)
  /** Whether this opening of the dialog saved, so older errors stay out of it. */
  const [submitted, setSubmitted] = useState(false)

  return (
    <Dialog
      onOpenChange={(next) => {
        onOpenChange(next)
        if (next) {
          setSubmitted(false)
          setApps(selected)
        }
      }}
      open={open}
    >
      <DialogContent className="text-left sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(true)
            void onSave(apps).then((saved) => {
              if (saved) onOpenChange(false)
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit access</DialogTitle>
            <DialogDescription>
              Choose the apps {name} may use.
            </DialogDescription>
          </DialogHeader>
          {submitted && error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldSet>
            <FieldLegend variant="label">Apps</FieldLegend>
            <AppCheckboxes locked={locked} onChange={setApps} selected={apps} />
          </FieldSet>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button disabled={busy} type="submit">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
