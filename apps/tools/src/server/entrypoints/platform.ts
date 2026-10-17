import { ConfigProvider, Layer } from "effect"
import { Database } from "@/server/modules/database"
import { Email } from "@/server/modules/email"
import { JobQueue } from "@/server/modules/job-queue"
import { ObjectStorage } from "@/server/modules/object-storage"

/**
 * What every action layer needs from the Worker: the D1 binding as the
 * `Database` primitive, the queue as `JobQueue`, the R2 bucket as `ObjectStorage`, the email binding as `Email`,
 * and the Worker variables and secrets as Effect config.
 * Built per request or per queue batch; nothing is shared across requests.
 */
export const platformLayer = (bindings: Cloudflare.Env) => {
  const config = ConfigProvider.layer(ConfigProvider.fromUnknown(bindings))
  return Layer.mergeAll(
    Database.layer(bindings.DB),
    JobQueue.layer(bindings.JOBS),
    ObjectStorage.layer(bindings.FILES),
    Email.layer(bindings.EMAIL).pipe(Layer.provide(config)),
    config
  )
}
