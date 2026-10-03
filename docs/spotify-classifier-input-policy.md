# Classifier input provenance

**Decision:** 29 September 2026, issue #16

Spotify is the source of liked-track IDs and the destination for playlist writes. The application may use Spotify fields privately to resolve a recording, but must never send a Spotify API response, Spotify field, or a transformed form of one to Jev. Personal use does not change Spotify's [Developer Terms](https://developer.spotify.com/terms) restriction on ingesting Spotify Content into an AI model.

## Permitted classification path

1. Resolve a Spotify liked track to a MusicBrainz recording. Use an ISRC lookup where available; keep the Spotify ID and any Spotify metadata within this application. An absent or ambiguous match abstains rather than guessing.
2. Fetch only [MusicBrainz core data](https://musicbrainz.org/doc/MusicBrainz_Database) for that recording. Its recording title, artist credit, duration, ISRC, disambiguation, and MBID are CC0. Exclude supplementary user annotations, tags, genre associations, ratings, statistics, and search indexes.
3. Fetch [AcousticBrainz recording data](https://acousticbrainz.org/data) by MusicBrainz recording ID. AcousticBrainz states that its data is CC0. Exclude the separate third-party [AcousticBrainz Genre Task datasets](https://labs.acousticbrainz.org/mediaeval-genre-datasets/).
4. Construct a narrow, allowlisted classifier input from those CC0 sources. Keep the Spotify-to-MusicBrainz mapping outside the model request. Jev evaluates each destination independently; an unavailable or weak result abstains.

The [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) supports ISRC lookup and requires a meaningful User-Agent and at most one request per second. AcousticBrainz [stopped collecting data in 2022](https://acousticbrainz.org/) but currently keeps its API available. Missing coverage will route a track to manual review once the sync workflow is enabled.

## Launch gate

Before automatic playlist additions, test recording resolution and Jev decisions on owner-labeled clear, overlapping, and ambiguous examples. Record the exact model-input fields, yes probabilities, threshold, abstentions, and errors. A type or provenance check must reject Spotify-derived or supplementary MusicBrainz fields at the Jev boundary. Automatic additions remain disabled until this evaluation shows useful behavior.

## Current implementation gate

All run-driven writes, including review-playlist additions, and live Jev calls
are disabled in the runtime policy pending owner-labeled evaluation. Dry runs
retain the live discovery checkpoint and do not record delivery. The model
boundary constructs only recording title, artist credit and duration, rhythm
BPM and danceability, the four selected mood outputs, and the four selected
AcousticBrainz default genre model outputs. It excludes provider payloads,
supplementary MusicBrainz fields and third-party genre datasets.
