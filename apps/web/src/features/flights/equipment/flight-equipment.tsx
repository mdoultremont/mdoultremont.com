import { useId, useState } from "react"
import {
  createEquipment,
  deleteEquipment,
  listEquipment,
  updateEquipment,
  type EquipmentInput,
  type EquipmentItem,
} from "@/features/flights/api"
import {
  LoadState,
  message,
  useFlightResource,
} from "@/features/flights/layout/ui"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/features/ui/alert-dialog"
import { Badge } from "@/features/ui/badge"
import { Button } from "@/features/ui/button"
import { Card } from "@/features/ui/card"
import { Checkbox } from "@/features/ui/checkbox"
import { Input } from "@/features/ui/input"
import { Label } from "@/features/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/features/ui/select"
import { Textarea } from "@/features/ui/textarea"

const kinds = ["wing", "harness", "reserve", "instrument", "other"] as const
const labels = {
  wing: "Wings",
  harness: "Harnesses",
  reserve: "Reserves",
  instrument: "Instruments",
  other: "Other equipment",
}
export function FlightEquipment() {
  const { data, error, reload } = useFlightResource(listEquipment)
  const [editing, setEditing] = useState<EquipmentItem | "new" | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<EquipmentItem | null>(null)
  async function mutate(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    setFailure(null)
    setNotice(null)
    try {
      await action()
      setEditing(null)
      setNotice(done)
      reload()
    } catch (cause) {
      setFailure(message(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Equipment
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Keep track of your kit and attach it to your flights.
          </p>
        </div>
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            setEditing("new")
            setFailure(null)
          }}
        >
          Add equipment
        </Button>
      </div>
      {failure ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {failure}
        </p>
      ) : null}
      {notice ? (
        <output className="mt-4 block text-sm text-muted-foreground">
          {notice}
        </output>
      ) : null}
      {editing === "new" ? (
        <EquipmentForm
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input) =>
            mutate(() => createEquipment(input), "Equipment added.")
          }
        />
      ) : null}
      {!data ? (
        <LoadState error={error} reload={reload} label="equipment" />
      ) : data.equipment.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border p-5 text-sm leading-6 text-muted-foreground">
          No equipment yet. Add your wing, harness, reserve, or instrument, then
          select it when editing a flight.
        </p>
      ) : (
        kinds.map((kind) => {
          const items = data.equipment.filter((item) => item.kind === kind)
          return items.length ? (
            <section
              key={kind}
              className="mt-8"
              aria-labelledby={`equipment-${kind}`}
            >
              <h2 id={`equipment-${kind}`} className="text-lg font-semibold">
                {labels[kind]}
              </h2>
              <Card className="mt-3 gap-0 py-0">
                <ul className="divide-y divide-border">
                  {items.map((item) => (
                    <li key={item.id} className="px-5 py-4">
                      {editing !== "new" && editing?.id === item.id ? (
                        <EquipmentForm
                          item={item}
                          busy={busy}
                          onCancel={() => setEditing(null)}
                          onSave={(input) =>
                            mutate(
                              () => updateEquipment(item.id, input),
                              "Equipment saved."
                            )
                          }
                        />
                      ) : (
                        <>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="break-words font-medium">
                                {item.name}
                              </h3>
                              {item.retired ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  <Badge variant="secondary">Retired</Badge>{" "}
                                  kept on existing flights
                                </p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-3 text-sm">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => {
                                  setEditing(item)
                                  setFailure(null)
                                }}
                              >
                                Edit
                                <span className="sr-only"> {item.name}</span>
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  void mutate(
                                    () =>
                                      updateEquipment(item.id, {
                                        kind: item.kind,
                                        name: item.name,
                                        notes: item.notes ?? "",
                                        retired: !item.retired,
                                      }),
                                    item.retired
                                      ? "Equipment restored."
                                      : "Equipment retired."
                                  )
                                }
                              >
                                {item.retired ? "Restore" : "Retire"}
                                <span className="sr-only"> {item.name}</span>
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={busy}
                                onClick={() => setDeleting(item)}
                              >
                                Delete
                                <span className="sr-only"> {item.name}</span>
                              </Button>
                            </div>
                          </div>
                          {item.notes ? (
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                              {item.notes}
                            </p>
                          ) : null}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ) : null
        })
      )}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it from all flights. Retire it instead to keep its
              history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const item = deleting
                if (item)
                  void mutate(
                    () => deleteEquipment(item.id),
                    "Equipment deleted."
                  )
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function EquipmentForm({
  item,
  busy,
  onCancel,
  onSave,
}: {
  item?: EquipmentItem
  busy: boolean
  onCancel: () => void
  onSave: (input: EquipmentInput) => Promise<void>
}) {
  const id = useId()
  return (
    <form
      className={item ? "" : "mt-5"}
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        void onSave({
          kind: String(form.get("kind")) as EquipmentInput["kind"],
          name: String(form.get("name")),
          notes: String(form.get("notes")),
          retired: form.get("retired") === "on",
        })
      }}
    >
      <Card className={item ? "bg-muted/40 px-5 shadow-none" : "px-5"}>
        <h2 className="text-lg font-semibold">
          {item ? "Edit equipment" : "Add equipment"}
        </h2>
        <fieldset className="space-y-4" disabled={busy}>
          <div className="space-y-1">
            <Label htmlFor={`${id}-kind`}>Kind</Label>
            <Select
              name="kind"
              defaultValue={item?.kind ?? "wing"}
              items={kinds.map((kind) => ({
                value: kind,
                label: kind[0].toUpperCase() + kind.slice(1),
              }))}
            >
              <SelectTrigger id={`${id}-kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {kind[0].toUpperCase() + kind.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              name="name"
              required
              maxLength={200}
              defaultValue={item?.name ?? ""}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-notes`}>Notes</Label>
            <Textarea
              id={`${id}-notes`}
              name="notes"
              maxLength={5000}
              rows={3}
              defaultValue={item?.notes ?? ""}
            />
          </div>
          <Label>
            <Checkbox name="retired" defaultChecked={item?.retired ?? false} />
            Retired
          </Label>
          <p className="text-sm leading-6 text-muted-foreground">
            Retired equipment stays on past flights, but cannot be added to
            another flight.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">{busy ? "Saving…" : "Save equipment"}</Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </fieldset>
      </Card>
    </form>
  )
}
