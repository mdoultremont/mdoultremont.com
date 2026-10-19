import type { App } from "#backend/actions/auth"

const appNames: Record<App, string> = {
  flights: "Flights",
  music: "Music",
  backOffice: "Back office",
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

/** The invitation email: what it grants and the link that finishes signing up. */
export function invitationEmail(input: {
  readonly link: string
  readonly apps: ReadonlyArray<App>
}) {
  const apps = input.apps.map((app) => appNames[app]).join(", ")
  const subject = "You're invited to Matthieu d'Oultremont's apps"
  const text = [
    "Matthieu d'Oultremont invited you to use these apps: " + apps + ".",
    "",
    "To finish signing up, open this link and continue with GitHub or Spotify:",
    input.link,
    "",
    "The link works for 7 days. If you did not expect this email, ignore it.",
  ].join("\n")
  const html = `<p>Matthieu d'Oultremont invited you to use these apps: ${escapeHtml(apps)}.</p>
<p><a href="${escapeHtml(input.link)}">Finish signing up</a> with GitHub or Spotify.</p>
<p>The link works for 7 days. If you did not expect this email, ignore it.</p>`
  return { subject, text, html }
}
