import { ORPCError } from "@orpc/server"
import { Flights } from "@/server/actions/flights/flights"
import { json } from "../http"
import { runProcedure } from "./errors"
import type { FlightsContext } from "./router"

/** The original file as an attachment with a safe filename; errors are `{ error }` JSON. */
export const downloadFlightFile = async (
  context: FlightsContext,
  fileId: string
): Promise<Response> => {
  try {
    const file = await runProcedure(
      Flights.use((flights) => flights.download(context.userId, fileId)),
      Flights.layer,
      context.platform
    )
    const fallback =
      file.filename.replace(/[^\x20-\x7E]|["\\/]/g, "_") ||
      `flight.${file.format}`
    const encoded = Array.from(
      new TextEncoder().encode(file.filename),
      (byte) => `%${byte.toString(16).padStart(2, "0")}`
    ).join("")
    return new Response(file.body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": file.contentType,
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    if (error instanceof ORPCError)
      return json({ error: error.message }, error.status)
    throw error
  }
}
