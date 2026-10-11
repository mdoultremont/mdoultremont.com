import { ConfigProvider, Layer } from "effect"
import { Database } from "@/backend/modules/database"
import { Email } from "@/backend/modules/email"
import { JobQueue } from "@/backend/modules/job-queue"

/**
 * What every feature layer needs from the Worker: the D1 binding as the
 * `Database` primitive, the queue as `JobQueue`, the email binding as `Email`,
 * and the Worker variables and secrets as Effect config.
 * Built per request or per queue batch; nothing is shared across requests.
 */
export const platformLayer = (bindings: Cloudflare.Env) => {
  const config = ConfigProvider.layer(ConfigProvider.fromUnknown(bindings))
  return Layer.mergeAll(
    Database.layer(bindings.DB),
    JobQueue.layer(bindings.JOBS),
    Email.layer(bindings.EMAIL).pipe(Layer.provide(config)),
    config
  )
}
