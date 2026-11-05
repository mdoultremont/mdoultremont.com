import { expect, test } from "vitest"
import { Effect, Layer } from "effect"
import { Database } from "#backend/modules/database"
import { makeTestD1 } from "#backend/modules/database/testing"
import { EnrichmentStore } from "#backend/actions/music/enrichment"
import { ClassificationStore } from "#backend/actions/music/classification"
import { DeliveryStore } from "#backend/actions/music/delivery"

test("enrichment, classification, and delivery share eligibility across enabled sources", async () => {
  const d1 = makeTestD1()
  d1.seedOwner()
  d1.seedOwner("other")
  const layer = Layer.mergeAll(
    EnrichmentStore.layer,
    ClassificationStore.layer,
    DeliveryStore.layer
  ).pipe(Layer.provide(Database.layer(d1.binding)))
  try {
    d1.sqlite.exec(`
      INSERT INTO music_sources (owner_id,source_id,created_at,updated_at) VALUES ('owner','shazam',1,1);
      INSERT INTO music_tracks (owner_id,track_id,name,artist_names,isrc,added_at,first_seen_at,last_seen_at)
      VALUES ('owner','shared','Song','[]','ISRC','2026-01-01T00:00:00Z',1,1), ('other','shared','Other','[]','OTHER','2026-01-01T00:00:00Z',1,1);
      INSERT INTO music_source_tracks (owner_id,source_id,track_id,added_at,present,last_seen_at)
      VALUES ('owner','liked','shared','2026-01-01T00:00:00Z',1,1), ('owner','shazam','shared','2026-01-01T00:00:00Z',1,1);
    `)
    await Effect.runPromise(
      Effect.gen(function* () {
        const enrichment = yield* EnrichmentStore
        const classification = yield* ClassificationStore
        const delivery = yield* DeliveryStore
        expect(
          (yield* enrichment.pending(10, [])).map((item) => item.isrc)
        ).toEqual(["ISRC"])
        expect(yield* classification.counts("owner", "f")).toMatchObject({
          waitingForEnrichment: 1,
        })
        d1.sqlite.exec(
          "UPDATE music_source_tracks SET present = 0 WHERE owner_id = 'owner' AND source_id = 'liked'"
        )
        expect(yield* enrichment.status("owner", [])).toMatchObject({
          pending: 1,
        })
        expect(yield* classification.counts("owner", "f")).toMatchObject({
          waitingForEnrichment: 1,
        })
        d1.sqlite.exec(
          "UPDATE music_sources SET enabled = 0 WHERE owner_id = 'owner' AND source_id = 'shazam'"
        )
        expect(yield* enrichment.pending(10, [])).toEqual([])
        expect(yield* classification.counts("owner", "f")).toMatchObject({
          waitingForEnrichment: 0,
        })
        d1.sqlite.exec(
          "UPDATE music_sources SET enabled = 1 WHERE owner_id = 'owner' AND source_id = 'shazam'"
        )
        d1.sqlite.exec(
          "INSERT INTO music_recordings (isrc,status,fetched_at) VALUES ('ISRC','not_found',1)"
        )
        expect(yield* classification.pending("owner", 10)).toEqual([
          { trackId: "shared", recording: null },
        ])
        yield* classification.save({
          ownerId: "owner",
          trackId: "shared",
          destinationIds: ["jazz"],
          review: false,
          reason: "classified",
          probabilities: {},
          model: "clef",
          fingerprint: "f",
          classifiedAt: 1,
        })
        expect(yield* delivery.decisions("owner")).toMatchObject([
          { trackId: "shared" },
        ])
        d1.sqlite.exec(
          "UPDATE music_sources SET enabled = 0 WHERE owner_id = 'owner' AND source_id = 'shazam'"
        )
        expect(yield* classification.pending("owner", 10)).toEqual([])
        expect(yield* classification.counts("owner", "f")).toMatchObject({
          decided: 0,
        })
        expect(yield* delivery.decisions("owner")).toEqual([])
        expect(
          d1.sqlite
            .prepare("SELECT count(*) AS count FROM music_decisions")
            .get()?.count
        ).toBe(1)
        expect(
          d1.sqlite
            .prepare("SELECT count(*) AS count FROM music_recordings")
            .get()?.count
        ).toBe(1)
      }).pipe(Effect.provide(layer))
    )
  } finally {
    d1.close()
  }
})
