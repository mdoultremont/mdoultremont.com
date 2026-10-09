import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { vi } from "vitest"
import {
  type EnrichmentStatus,
  MusicEnrichment,
} from "@/backend/features/music/enrichment"
import {
  InvalidLikesPage,
  MusicIngestion,
} from "@/backend/features/music/ingestion"
import { MusicPipeline } from "."

const enrichmentStatus = (pending: number): EnrichmentStatus => ({
  enriched: 0,
  withAnalysis: 0,
  notFound: 0,
  ambiguous: 0,
  failed: 0,
  pending,
  withoutIsrc: 0,
})

function setup(options: { added?: number; pending?: number } = {}) {
  const ingestion = {
    processNext: vi.fn<MusicIngestion["Service"]["processNext"]>(() =>
      Effect.succeed({ added: options.added ?? 0 })
    ),
    fail: vi.fn<MusicIngestion["Service"]["fail"]>(() => Effect.void),
    scheduled: vi.fn<MusicIngestion["Service"]["scheduled"]>(() => Effect.void),
  }
  const enrichment = {
    request: vi.fn<MusicEnrichment["Service"]["request"]>(() => Effect.void),
    processNext: vi.fn<MusicEnrichment["Service"]["processNext"]>(() =>
      Effect.succeed({ looked: 0 })
    ),
    status: vi.fn<MusicEnrichment["Service"]["status"]>(() =>
      Effect.succeed(enrichmentStatus(options.pending ?? 0))
    ),
  }
  const layer = MusicPipeline.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          MusicIngestion,
          ingestion as unknown as MusicIngestion["Service"]
        ),
        Layer.succeed(
          MusicEnrichment,
          enrichment as unknown as MusicEnrichment["Service"]
        )
      )
    )
  )
  return {
    ingestion,
    enrichment,
    run: <A, E>(body: Effect.Effect<A, E, MusicPipeline>) =>
      Effect.provide(body, layer),
  }
}

const ingestionMessage = {
  kind: "music.ingestion",
  ingestionId: "ing-1",
} as const

describe("music pipeline", () => {
  it.effect("starts enrichment as soon as an ingestion page adds likes", () => {
    const t = setup({ added: 3 })
    return t.run(
      Effect.gen(function* () {
        const pipeline = yield* MusicPipeline
        yield* pipeline.handle(ingestionMessage)
        expect(t.ingestion.processNext).toHaveBeenCalledWith("ing-1")
        expect(t.enrichment.request).toHaveBeenCalledOnce()
      })
    )
  })

  it.effect("does not wake enrichment for a page with nothing new", () => {
    const t = setup({ added: 0 })
    return t.run(
      Effect.gen(function* () {
        const pipeline = yield* MusicPipeline
        yield* pipeline.handle(ingestionMessage)
        expect(t.enrichment.request).not.toHaveBeenCalled()
      })
    )
  })

  it.effect("runs enrichment batches", () => {
    const t = setup()
    return t.run(
      Effect.gen(function* () {
        const pipeline = yield* MusicPipeline
        yield* pipeline.handle({ kind: "music.enrichment" })
        expect(t.enrichment.processNext).toHaveBeenCalledOnce()
      })
    )
  })

  it.effect("records a failed ingestion when its message is abandoned", () => {
    const t = setup()
    return t.run(
      Effect.gen(function* () {
        const pipeline = yield* MusicPipeline
        yield* pipeline.giveUp(
          ingestionMessage,
          new InvalidLikesPage({ message: "Bad page" })
        )
        expect(t.ingestion.fail).toHaveBeenCalledWith("ing-1", "Bad page")
      })
    )
  })

  it.effect(
    "hourly upkeep resumes enrichment only when lookups are pending",
    () => {
      const idle = setup({ pending: 0 })
      const busy = setup({ pending: 4 })
      return Effect.gen(function* () {
        yield* idle.run(
          MusicPipeline.use((pipeline) => pipeline.scheduled("owner"))
        )
        yield* busy.run(
          MusicPipeline.use((pipeline) => pipeline.scheduled("owner"))
        )
        expect(idle.ingestion.scheduled).toHaveBeenCalledWith("owner")
        expect(idle.enrichment.request).not.toHaveBeenCalled()
        expect(busy.enrichment.request).toHaveBeenCalledOnce()
      })
    }
  )
})
