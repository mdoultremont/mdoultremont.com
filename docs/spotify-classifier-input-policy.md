# Classifier input provenance

**Decision:** 29 September 2026, issue #16

Spotify is the source of liked-track IDs and the destination for playlist writes. The application may use Spotify fields privately to resolve a recording, but must never send a Spotify API response, Spotify field, or a transformed form of one to Jev. Personal use does not change Spotify's [Developer Terms](https://developer.spotify.com/terms) restriction on ingesting Spotify Content into an AI model.

## Permitted classification path

1. Resolve a Spotify liked track to a MusicBrainz recording. Use an ISRC lookup where available; keep the Spotify ID and any Spotify metadata within this application. An absent or ambiguous match abstains rather than guessing.
2. Fetch only [MusicBrainz core data](https://musicbrainz.org/doc/MusicBrainz_Database) for that recording. Its recording title, artist credit, duration, ISRC, disambiguation, and MBID are CC0. Exclude supplementary user annotations, tags, genre associations, ratings, statistics, and search indexes.
3. Fetch [AcousticBrainz recording data](https://acousticbrainz.org/data) by MusicBrainz recording ID. AcousticBrainz states that its data is CC0. Exclude the separate third-party [AcousticBrainz Genre Task datasets](https://labs.acousticbrainz.org/mediaeval-genre-datasets/).
4. Construct a narrow, allowlisted classifier input from those CC0 sources. Keep the Spotify-to-MusicBrainz mapping outside the model request. Jev evaluates each destination independently; an unavailable or weak result abstains.

The [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) supports ISRC lookup and requires a meaningful User-Agent and at most one request per second. AcousticBrainz [stopped collecting data in 2022](https://acousticbrainz.org/) but currently keeps its API available. A track without recording data goes to the review playlist without a Jev call.

## Review before delivery

**Decision:** 9 October 2026. The earlier launch gate, which kept Jev calls disabled until an owner-labeled evaluation, is replaced by owner review in the pipeline:

- Classification runs only after the owner marks the setup **Ready**.
- Decisions are listed on `/music` with their yes-probabilities before anything is written.
- Delivery writes only when the owner presses **Write now** or turns on **automatic delivery**, and it only adds tracks.

The owner can therefore evaluate Jev on real decisions and reclassify after changing destination descriptions, without a separate evaluation harness.

## Model boundary

Classification reads `music_recordings` only, never `music_liked_tracks`. The Jev state contains the recording title, artist credit and duration from MusicBrainz, plus BPM, danceability, the four selected mood outputs, and the four selected default genre model outputs from AcousticBrainz when available. It excludes provider payloads, supplementary MusicBrainz fields, third-party genre datasets, and every Spotify field, including the track ID and ISRC. The model version is pinned (`jev-1.13.0`), and a destination is accepted at a yes-probability of 0.5 or more.
