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

## Private apps

**Tools**:
The private part of the site, at `tools.mdoultremont.com` (`apps/tools`),
deployed apart from the portfolio (`apps/web`). It holds every app and their
shared sign-in. Its home page lists the apps a user can open.
_Avoid_: Apps area, `/apps`

**User**:
A person who signs in to tools with a GitHub or
Spotify account. App sign-in is separate from any provider connection an app
makes, such as the music app's Spotify connection, even when both use the same
account.
_Avoid_: Member, account (an account is one sign-in method of a user)

**App**:
One private area of tools, at `/<name>`: the music control area (`music`), the
back office (`backOffice`), or the flight logbook (`flights`).

**App access**:
A user's permission to use one app. A user may hold access to any set of apps,
including none. At least one user always has access to the back office.
_Avoid_: Role, scope, permission

**Back office**:
The app for managing users: inviting them, choosing their app access, and
removing them. Nobody can remove themselves or their own back office access.

**Invitation**:
An emailed link that lets one person become a user with the app access chosen
when inviting them. It works for 7 days and only once. Accepting it while
signed in, or by signing in with an account that already belongs to a user,
gives that user the app access instead of creating another user.
_Avoid_: Sign-up request, invite code

**Removed user**:
A user who can no longer sign in and has no app access. Their data stays. A
new invitation restores them.
_Avoid_: Deleted user

**Owner accounts**:
The sign-in accounts in `OWNER_ACCOUNTS`. While nobody has back office access,
they may sign in without an invitation and receive every app, so the site can
always be recovered.

## Music control area

**Owner**:
The user whose Spotify Liked Songs and playlists the music app is sorting. Any
user with music access is the owner of their own music data.

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

## Flight logbook

**Flight**:
A user's recorded paragliding outing, with its takeoff, landing, time in the
air, sites, notes, and equipment. Its measurements come from an imported track.

**Track**:
The timestamped positions and altitude observations recorded by an instrument
or phone. A track can include movement on the ground before or after a flight.
_Avoid_: Route (a planned path), music track

**Takeoff**:
The beginning of the airborne part selected from a track, with its time,
position, and an editable site name.
_Avoid_: Start (the recording can start before takeoff)

**Landing**:
The end of the airborne part selected from a track, with its time, position,
and an editable site name.
_Avoid_: Finish (the recording can continue after landing)

**Equipment**:
A user's named flying gear that can be associated with their flights, such as
a wing, harness, or reserve.
