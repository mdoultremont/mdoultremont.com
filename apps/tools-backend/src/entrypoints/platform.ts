import { ConfigProvider, Layer } from "effect"
import { Database } from "#backend/modules/database"
import { Email } from "#backend/modules/email"
import { Clef } from "#backend/modules/clef"
import { WorkersAi } from "#backend/modules/workers-ai"
import { JobQueue } from "#backend/modules/job-queue"
import { ObjectStorage } from "#backend/modules/object-storage"
import type { ToolsBindings } from "../bindings"

/**
 * What every action layer needs from the Worker: the D1 binding as the
 * `Database` primitive, the queue as `JobQueue`, the R2 bucket as `ObjectStorage`,
 * the email binding as `Email`, the AI binding as `Clef` and `WorkersAi`,
 * and the Worker variables and secrets as Effect config.
 * Built per request or per queue batch; nothing is shared across requests.
 */
export const platformLayer = (bindings: ToolsBindings) => {
  const config = ConfigProvider.layer(ConfigProvider.fromUnknown(bindings))
  return Layer.mergeAll(
    Database.layer(bindings.DB),
    JobQueue.layer(bindings.JOBS),
    ObjectStorage.layer(bindings.FILES),
    Email.layer(bindings.EMAIL).pipe(Layer.provide(config)),
    Clef.layer(bindings.AI),
    WorkersAi.layer(bindings.AI),
    config
  )
}
