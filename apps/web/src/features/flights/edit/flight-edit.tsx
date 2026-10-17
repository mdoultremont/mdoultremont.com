import { Link, useRouter } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import {
  deleteFlight,
  getFlight,
  listEquipment,
  updateFlight,
  type EquipmentItem,
  type FlightDetail,
} from "@/features/flights/api"
import { formatDateTime } from "@/features/flights/format"
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
  AlertDialogTrigger,
} from "@/features/ui/alert-dialog"
import { Button, buttonVariants } from "@/features/ui/button"
import { Checkbox } from "@/features/ui/checkbox"
import { Input } from "@/features/ui/input"
import { Label } from "@/features/ui/label"
import { Textarea } from "@/features/ui/textarea"

export function FlightEdit({ flightId }: { flightId: string }) {
  const load = useCallback(async () => {
    const [detail, kit] = await Promise.all([
      getFlight(flightId),
      listEquipment(),
    ])
    return {
      detail,
      equipment: kit.equipment.filter(
        (item) =>
          !item.retired ||
          detail.equipment.some((attached) => attached.id === item.id)
      ),
    }
  }, [flightId])
  const { data, error, reload } = useFlightResource(load)
  return (
    <section>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Edit flight
      </h1>
      {data ? (
        <EditForm detail={data.detail} equipment={data.equipment} />
      ) : (
        <LoadState error={error} reload={reload} label="flight" />
      )}
    </section>
  )
}
function EditForm({
  detail,
  equipment,
}: {
  detail: FlightDetail
  equipment: EquipmentItem[]
}) {
  const { flight } = detail
  const router = useRouter()
  const [selected, setSelected] = useState(
    detail.equipment.map((item) => item.id)
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(action: () => Promise<unknown>, deleted = false) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await router.invalidate()
      if (deleted) await router.navigate({ to: "/apps/flights/logbook" })
      else
        await router.navigate({
          to: "/apps/flights/$flightId",
          params: { flightId: flight.id },
        })
    } catch (cause) {
      setError(message(cause))
      setBusy(false)
    }
  }
  return (
    <>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Add the places, kit, and details you want to remember.
      </p>
      <p className="mt-4 text-sm text-muted-foreground">
        Takeoff: {formatDateTime(flight.takeoffAt ?? flight.startedAt)}
      </p>
      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          void save(() =>
            updateFlight(flight.id, {
              takeoffName: String(form.get("takeoffName")),
              landingName: String(form.get("landingName")),
              notes: String(form.get("notes")),
              equipmentIds: selected,
            })
          )
        }}
      >
        <fieldset disabled={busy} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="takeoffName">Takeoff site</Label>
              <Input
                id="takeoffName"
                name="takeoffName"
                maxLength={200}
                defaultValue={flight.takeoffName ?? ""}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="landingName">Landing site</Label>
              <Input
                id="landingName"
                name="landingName"
                maxLength={200}
                defaultValue={flight.landingName ?? ""}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="flight-notes">Notes</Label>
            <Textarea
              id="flight-notes"
              name="notes"
              rows={5}
              maxLength={10000}
              defaultValue={flight.notes ?? ""}
              className="mt-1"
            />
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Equipment</legend>
            {equipment.length ? (
              <div className="mt-3 space-y-3">
                {equipment.map((item) => (
                  <Label
                    aria-label={item.name}
                    key={item.id}
                    className="items-start gap-3 font-normal"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.includes(item.id)}
                      onCheckedChange={(checked) =>
                        setSelected((previous) =>
                          checked
                            ? [...previous, item.id]
                            : previous.filter((id) => id !== item.id)
                        )
                      }
                    />
                    <span className="min-w-0 break-words">
                      <span className="font-medium">{item.name}</span>
                      <span className="ml-2 text-muted-foreground">
                        {item.kind}
                        {item.retired ? " · Retired" : ""}
                      </span>
                    </span>
                  </Label>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                No active equipment.{" "}
                <Link
                  to="/apps/flights/equipment"
                  className="underline underline-offset-4"
                >
                  Add your kit
                </Link>{" "}
                to attach it to flights.
              </p>
            )}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">{busy ? "Saving…" : "Save changes"}</Button>
            <Link
              to="/apps/flights/$flightId"
              params={{ flightId: flight.id }}
              className={buttonVariants({ variant: "outline" })}
            >
              Cancel
            </Link>
          </div>
        </fieldset>
      </form>
      {error ? (
        <p role="alert" className="mt-5 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <section className="mt-10 border-t border-border pt-6">
        <h2 className="font-medium">Delete this flight</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Permanently remove its track and original files.
        </p>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                className="mt-4"
              />
            }
          >
            Delete flight
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this flight?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the flight, its track, and the original
                files. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void save(() => deleteFlight(flight.id), true)}
              >
                Delete flight
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </>
  )
}
