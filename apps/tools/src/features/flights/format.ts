type Numeric = number | null | undefined
const valid = (value: Numeric): value is number =>
  value != null && Number.isFinite(value)
export function formatDuration(seconds: Numeric): string {
  if (!valid(seconds)) return "—"
  const minutes = Math.floor(Math.max(0, seconds) / 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`
}
export const formatDistance = (meters: Numeric): string =>
  valid(meters) ? `${(meters / 1000).toFixed(1)} km` : "—"
export const formatAltitude = (meters: Numeric): string =>
  valid(meters) ? `${Math.round(meters).toLocaleString("en-GB")} m` : "—"
export const formatSpeed = (mps: Numeric): string =>
  valid(mps) ? `${(mps * 3.6).toFixed(1)} km/h` : "—"
export const formatVario = (mps: Numeric): string =>
  valid(mps) ? `${mps > 0 ? "+" : ""}${mps.toFixed(1)} m/s` : "—"
function dateValue(
  date: Date | string | number | null | undefined
): Date | null {
  if (date == null) return null
  const value = new Date(date)
  return Number.isFinite(value.getTime()) ? value : null
}
// Fixed UTC formatting keeps server rendering and hydration consistent.
export function formatDate(
  date: Date | string | number | null | undefined
): string {
  const value = dateValue(date)
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(value)
    : "—"
}
export function formatDateTime(
  date: Date | string | number | null | undefined
): string {
  const value = dateValue(date)
  return value
    ? `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(value)} UTC`
    : "—"
}
