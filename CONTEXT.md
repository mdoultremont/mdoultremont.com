# Portfolio

This context describes the public record of Matthieu d'Oultremont's professional work and personal practice. Content files contain only records ready to appear on the site; unfinished ideas stay outside production content.

## Language

**Portfolio record**:
A record shown to visitors. Its position in the containing JSON array is its display order. It is concise, accurate, and complete enough to stand on its own, even when a longer account will follow.
_Avoid_: Published record, unpublished record, placeholder, draft

**Experience record**:
A portfolio record of a professional role. Its dates and concise summary are sufficient for a visitor to understand the role without a longer case study.
_Avoid_: Case study, placeholder

**Experimental page**:
A route used to explore personal material before it is part of the public portfolio promise. It may be intentionally unlisted and excluded from search indexing.
_Avoid_: Public page, finished page

## Music control area

**Owner**:
The single user allowed to use the private music control area. They sign in
with one of the accounts listed in `OWNER_ACCOUNTS` (GitHub or Spotify). App
sign-in is separate from the Spotify connection that gives music access, even
when both use the same Spotify account.

### Pipeline

Liked tracks move through four independent steps. Each step can be re-run on
its own without repeating the earlier ones.

**Ingestion**:
Recording the owner's Spotify Liked Songs as liked tracks. A full ingestion
reads every like; an incremental ingestion reads only likes newer than those
already known. The first ingestion is a full ingestion, not a separate concept.
_Avoid_: Initial baseline, discovery, sync

**Liked track**:
A Spotify track the owner has liked, as last seen by ingestion. Every liked
track is eligible for the pipeline, however long ago it was liked.
_Avoid_: Historical like, baseline track

**Un-liked track**:
A liked track that a full ingestion or a delivery check no longer finds in
Liked Songs. It keeps its recording data and decisions but is never delivered.

**Enrichment**:
Attaching recording data to a liked track from MusicBrainz and AcousticBrainz.
Recording data is fetched once per track; re-ingesting does not repeat it.
_Avoid_: Ingestion (for MusicBrainz lookups)

**Recording data**:
The CC0 MusicBrainz and AcousticBrainz data stored for a liked track. It is
the only classification input; Spotify metadata is never used.
_Avoid_: Spotify metadata, track metadata

**Classification**:
Deciding, from a track's recording data and the destination descriptions,
which destinations the track belongs to.

**Decision**:
The result of classifying one track: its destinations, or the review playlist
when none fits or the track has no recording data. Reclassification replaces
it.

**Delivery**:
Adding tracks to the playlists named in their decisions that are not yet
there. Delivery only adds, and only to enabled destinations; it never removes
a track from a Spotify playlist.
_Avoid_: Sync, write-back

**Automatic delivery**:
The owner's setting that lets delivery run without pressing "Write now".
_Avoid_: Auto-write

### Setup

**Destination**:
A Spotify playlist paired with an app-owned classification description and an
enabled state. A disabled destination is left out of new classifications and
receives no deliveries; existing decisions naming it are kept.
_Avoid_: Spotify playlist description as classification rule

**Review playlist**:
A separate Spotify playlist configured to receive tracks with no accepted
destination.
_Avoid_: Approval queue

**Ready**:
The owner's statement that destinations are configured and classification may
start. Ingestion and enrichment do not wait for it.
_Avoid_: Automation enabled
