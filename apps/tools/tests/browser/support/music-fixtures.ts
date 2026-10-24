import type { PlayerStatus } from "@mdoultremont/tools-contracts/music"

const artwork =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#65796f"/><circle cx="40" cy="40" r="22" fill="#c3cdb5"/><circle cx="40" cy="40" r="7" fill="#65796f"/></svg>'
  )

export const fixturePlaylists = [
  {
    id: "fresh",
    name: "Fresh finds",
    ownerId: "owner",
    public: false,
    collaborative: false,
  },
  {
    id: "inbox",
    name: "Discoveries",
    ownerId: "owner",
    public: false,
    collaborative: false,
  },
  {
    id: "jazz",
    name: "Late night jazz",
    ownerId: "owner",
    public: false,
    collaborative: false,
  },
  {
    id: "review",
    name: "To discover",
    ownerId: "owner",
    public: false,
    collaborative: false,
  },
]

export const fixtureTracks = [
  {
    id: "track1",
    name: "Everything In Its Right Place",
    artistNames: ["Radiohead"],
    durationMs: 251000,
  },
  {
    id: "track2",
    name: "Open Eye Signal",
    artistNames: ["Jon Hopkins"],
    durationMs: 472000,
  },
  {
    id: "track3",
    name: "Blue in Green",
    artistNames: ["Miles Davis", "Bill Evans"],
    durationMs: 337000,
  },
  { id: "track4", name: "A Walk", artistNames: ["Tycho"], durationMs: 316000 },
].map((track) => ({
  ...track,
  isrc: null,
  addedAt: "2026-10-01T10:00:00Z",
  artworkUrl: artwork,
}))

export const fixtureSources = [
  {
    sourceId: { kind: "liked" as const },
    enabled: true,
    snapshotId: null,
    createdAt: 1,
    updatedAt: 1,
    present: 4,
    removed: 0,
    latest: null,
  },
  {
    sourceId: { kind: "playlist" as const, playlistId: "inbox" },
    enabled: false,
    snapshotId: null,
    createdAt: 1,
    updatedAt: 1,
    present: 2,
    removed: 0,
    latest: null,
  },
]

export const fixturePlayerStatus = {
  status: "ready",
  devices: [
    {
      controllable: true,
      id: "fixture-speaker",
      name: "Living room speaker",
      type: "Speaker",
      active: true,
    },
    {
      controllable: true,
      id: "fixture-phone",
      name: "Phone",
      type: "Smartphone",
      active: false,
    },
  ],
  playback: {
    playing: true,
    device: {
      id: "fixture-speaker",
      name: "Living room speaker",
      restricted: false,
    },
    item: {
      kind: "track",
      id: fixtureTracks[0]!.id,
      name: fixtureTracks[0]!.name,
      artistNames: fixtureTracks[0]!.artistNames,
      imageUrl: artwork,
    },
    allows: { pause: true, resume: true },
  },
} satisfies PlayerStatus

export const musicFixtureResponses: Record<
  string,
  (input: Record<string, unknown>) => unknown
> = {
  "player/status": () => fixturePlayerStatus,
  "player/play": () => ({ status: "accepted" }),
  "player/pause": () => ({ status: "accepted" }),
  "player/resume": () => ({ status: "accepted" }),
  "sources/get": () => ({ sources: fixtureSources }),
  "ingestion/status": () => ({
    sources: fixtureSources,
    present: 4,
    removed: 0,
  }),
  "spotify/status": () => ({
    status: "connected",
    accountId: "owner",
    displayName: "Music owner",
  }),
  "spotify/playlists": () => ({ items: fixturePlaylists }),
  "spotify/likedTracks": () => ({
    items: fixtureTracks,
    next: null,
    total: fixtureTracks.length,
  }),
  "spotify/playlistTracks": (input) => ({
    items:
      input.playlistId === "jazz"
        ? fixtureTracks.slice(2, 3)
        : input.playlistId === "review"
          ? []
          : fixtureTracks.slice(0, 2),
    next: null,
    total:
      input.playlistId === "review" ? 0 : input.playlistId === "jazz" ? 1 : 2,
  }),
  "destinations/get": () => ({
    destinations: [
      {
        playlistId: "jazz",
        description: "Acoustic jazz for quiet evenings",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    reviewPlaylistId: "review",
    ready: false,
  }),
  "enrichment/status": () => ({
    enriched: 100,
    withAnalysis: 80,
    notFound: 5,
    ambiguous: 0,
    failed: 0,
    pending: 23,
    withoutIsrc: 0,
  }),
  "classification/status": () => ({
    ready: false,
    decided: 100,
    toDestinations: 80,
    toReview: 20,
    withoutRecordingData: 5,
    waitingForEnrichment: 23,
    pending: 5,
    outdated: 0,
    recent: [],
  }),
  "delivery/status": () => ({
    automatic: false,
    delivered: 80,
    toWrite: 20,
    refused: 0,
    lastDeliveredAt: null,
  }),
}
