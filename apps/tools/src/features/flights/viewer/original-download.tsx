import { useState } from "react"
import { downloadFlightFile } from "../api"

export function OriginalDownload({
  fileId,
  filename,
}: {
  fileId: string
  filename: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  async function download() {
    setBusy(true)
    setError(false)
    try {
      const file = await downloadFlightFile(fileId)
      const url = URL.createObjectURL(
        new Blob([file.text], { type: "application/octet-stream" })
      )
      const a = document.createElement("a")
      a.href = url
      a.download = file.filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button
        className="text-left text-foreground underline underline-offset-4 disabled:opacity-50"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? "Downloading…" : filename}
      </button>
      {error && (
        <span role="alert" className="block text-destructive">
          Download failed. Please try again.
        </span>
      )}
    </>
  )
}
