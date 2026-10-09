import { ConfigProvider, Layer } from "effect"
import { Database } from "@/backend/primitives/database"
import { JobQueue } from "@/backend/primitives/job-queue"

/**
 * What every feature layer needs from the Worker: the D1 binding as the
 * `Database` primitive, the queue as `JobQueue`, and the Worker variables and
 * secrets as Effect config.
 * Built per request or per queue batch; nothing is shared across requests.
 */
export const platformLayer = (bindings: Cloudflare.Env) =>
  Layer.mergeAll(
    Database.layer(bindings.DB),
    JobQueue.layer(bindings.JOBS),
    ConfigProvider.layer(ConfigProvider.fromUnknown(bindings))
  )
