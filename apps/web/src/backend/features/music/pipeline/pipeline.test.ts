import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { vi } from "vitest"
import {
  type ClassificationStatus,
  MusicClassification,
} from "@/backend/features/music/classification"
import { MusicDelivery } from "@/backend/features/music/delivery"
import { Destinations } from "@/backend/features/music/destinations"
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

const classificationStatus = (pending: number): ClassificationStatus => ({
  ready: true,
  decided: 0,
  toDestinations: 0,
  toReview: 0,
  withoutRecordingData: 0,
  waitingForEnrichment: 0,
  pending,
  outdated: 0,
  recent: [],
})

/** Partial service fakes: only the methods the pipeline calls are implemented. */
const fake = <S>(service: unknown) => service as S

function setup(
  options: {
    added?: number
    looked?: number
    enrichmentPending?: number
    classificationPending?: number
    decided?: number
    toWrite?: number
  } = {}
) {
  const ingestion = {
    processNext: vi.fn<MusicIngestion["Service"]["processNext"]>(() =>
      Effect.succeed({ ownerId: "owner", added: options.added ?? 0 })
    ),
    fail: vi.fn<MusicIngestion["Service"]["fail"]>(() => Effect.void),
    scheduled: vi.fn<MusicIngestion["Service"]["scheduled"]>(() => Effect.void),
  }
  const enrichment = {
    request: vi.fn<MusicEnrichment["Service"]["request"]>(() => Effect.void),
    processNext: vi.fn<MusicEnrichment["Service"]["processNext"]>(() =>
      Effect.succeed({ looked: options.looked ?? 0 })
    ),
    status: vi.fn<MusicEnrichment["Service"]["status"]>(() =>
      Effect.succeed(enrichmentStatus(options.enrichmentPending ?? 0))
    ),
  }
  const classification = {
    request: vi.fn<MusicClassification["Service"]["request"]>(
      () => Effect.void
    ),
    processNext: vi.fn<MusicClassification["Service"]["processNext"]>(() =>
      Effect.succeed({ decided: options.decided ?? 0 })
    ),
    status: vi.fn<MusicClassification["Service"]["status"]>(() =>
      Effect.succeed(classificationStatus(options.classificationPending ?? 0))
    ),
  }
  const delivery = {
    requestIfAutomatic: vi.fn<MusicDelivery["Service"]["requestIfAutomatic"]>(
      () => Effect.void
    ),
    processNext: vi.fn<MusicDelivery["Service"]["processNext"]>(() =>
      Effect.succeed({ delivered: 0, unliked: 0 })
    ),
    status: vi.fn<MusicDelivery["Service"]["status"]>(() =>
      Effect.succeed({
        automatic: true,
        delivered: 0,
        toWrite: options.toWrite ?? 0,
        refused: 0,
        lastDeliveredAt: null,
      })
    ),
  }
  const destinations = {
    setReady: vi.fn<Destinations["Service"]["setReady"]>(({ ready }) =>
      Effect.succeed(ready)
    ),
  }
  const layer = MusicPipeline.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MusicIngestion, fake(ingestion)),
        Layer.succeed(MusicEnrichment, fake(enrichment)),
        Layer.succeed(MusicClassification, fake(classification)),
        Layer.succeed(Destinations, fake(destinations)),
        Layer.succeed(MusicDelivery, fake(delivery))
      )
    )
  )
  return {
    ingestion,
    enrichment,
    classification,
    delivery,
    destinations,
    run: <A, E>(body: Effect.Effect<A, E, MusicPipeline>) =>
      Effect.provide(body, layer),
  }
}

const ingestionMessage = {
  kind: "music.ingestion",
  ingestionId: "ing-1",
} as const

describe("music pipeline", () => {
  it.effect(
    "an ingestion page with new likes starts enrichment and classification",
    () => {
      const t = setup({ added: 3 })
      return t.run(
        Effect.gen(function* () {
          const pipeline = yield* MusicPipeline
          yield* pipeline.handle(ingestionMessage)
          expect(t.ingestion.processNext).toHaveBeenCalledWith("ing-1")
          expect(t.enrichment.request).toHaveBeenCalledWith("owner")
          expect(t.classification.request).toHaveBeenCalledWith("owner")
        })
      )
    }
  )

  it.effect("an ingestion page with nothing new wakes no other step", () => {
    const t = setup({ added: 0 })
    return t.run(
      Effect.gen(function* () {
        const pipeline = yield* MusicPipeline
        yield* pipeline.handle(ingestionMessage)
        expect(t.enrichment.request).not.toHaveBeenCalled()
        expect(t.classification.request).not.toHaveBeenCalled()
      })
    )
  })

  it.effect(
    "an enrichment batch that looked something up starts classification",
    () => {
      const t = setup({ looked: 4 })
      return t.run(
        Effect.gen(function* () {
          const pipeline = yield* MusicPipeline
          yield* pipeline.handle({ kind: "music.enrichment", ownerId: "owner" })
          expect(t.enrichment.processNext).toHaveBeenCalledWith("owner")
          expect(t.classification.request).toHaveBeenCalledWith("owner")
        })
      )
    }
  )

  it.effect("runs classification batches", () => {
    const t = setup()
    return t.run(
      Effect.gen(function* () {
        const pipeline = yield* MusicPipeline
        yield* pipeline.handle({
          kind: "music.classification",
          ownerId: "owner",
        })
        expect(t.classification.processNext).toHaveBeenCalledWith("owner")
      })
    )
  })

  it.effect(
    "a classification batch that decided tracks may start delivery",
    () => {
      const t = setup({ decided: 5 })
      return t.run(
        Effect.gen(function* () {
          const pipeline = yield* MusicPipeline
          yield* pipeline.handle({
            kind: "music.classification",
            ownerId: "owner",
          })
          expect(t.delivery.requestIfAutomatic).toHaveBeenCalledWith("owner")
        })
      )
    }
  )

  it.effect("runs delivery batches", () => {
    const t = setup()
    return t.run(
      Effect.gen(function* () {
        const pipeline = yield* MusicPipeline
        yield* pipeline.handle({ kind: "music.delivery", ownerId: "owner" })
        expect(t.delivery.processNext).toHaveBeenCalledWith("owner")
      })
    )
  })

  it.effect("setting Ready starts classification; clearing it does not", () => {
    const t = setup()
    return t.run(
      Effect.gen(function* () {
        const pipeline = yield* MusicPipeline
        yield* pipeline.setReady("owner", false)
        expect(t.classification.request).not.toHaveBeenCalled()
        yield* pipeline.setReady("owner", true)
        expect(t.classification.request).toHaveBeenCalledWith("owner")
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

  it.effect("hourly upkeep resumes only the steps with pending work", () => {
    const idle = setup()
    const busy = setup({
      enrichmentPending: 4,
      classificationPending: 2,
      toWrite: 7,
    })
    const upkeep = MusicPipeline.use((pipeline) => pipeline.scheduled("owner"))
    return Effect.gen(function* () {
      yield* idle.run(upkeep)
      yield* busy.run(upkeep)
      expect(idle.ingestion.scheduled).toHaveBeenCalledWith("owner")
      expect(idle.enrichment.request).not.toHaveBeenCalled()
      expect(idle.classification.request).not.toHaveBeenCalled()
      expect(busy.enrichment.request).toHaveBeenCalledOnce()
      expect(busy.classification.request).toHaveBeenCalledOnce()
      expect(idle.delivery.requestIfAutomatic).not.toHaveBeenCalled()
      expect(busy.delivery.requestIfAutomatic).toHaveBeenCalledOnce()
    })
  })
})
