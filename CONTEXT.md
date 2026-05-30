# Better Subs for Crunchyroll

A Chrome extension that replaces Crunchyroll's per-locale subtitle tracks with the user's choice of locale, regardless of which audio dub is playing. Renders subtitles via a custom ASS overlay and works around server-side data errors (wrong subtitle file linked to a locale).

## Language

**Episode**:
A single Crunchyroll episode the user is currently viewing. Identified by the guid in the `/watch/<guid>` URL. The in-memory data structure that holds everything tied to one viewing — subtitle URLs, parsed cues, JP-mapping, validation results, the catalog instance, auth headers — is also called the **Episode**.
_Avoid_: Session, video, watch.

**Audio session**:
A Crunchyroll streaming session bound to one audio-dub locale. Each session exposes its own subtitle URL matrix on the playback API. An **Episode** typically has multiple **Audio sessions** (one per available dub).
_Avoid_: Audio track, dub session.

**Source**:
The subtitle locale the user has chosen to display. May be the same as or different from the audio dub. Persisted across episodes as a user preference.
_Avoid_: Subtitle track, sub language.

**Catalog**:
Per-**Episode** registry of subtitle URLs (indexed by `(audio session, subtitle locale)`) and per-locale validation status. Owns the policy for picking the best URL for a given **Source** and the monotonic rule for validation transitions. Lives in `lib/subtitle-catalog.js` and is held by the **Episode**, which wires it to localStorage at construction.
_Avoid_: Index, registry.

**Cue**:
One subtitle line with start/end times and styled text spans. Output of the parser; input to the renderer.

**Remaster**:
Reprocessing of **Cues** to align them onto a different **Audio session**'s timeline (used when the chosen **Source** comes from a different session than the active dub). Anchor-matched, piecewise-linear time mapping.

**Wrong-title**:
A **Source** whose subtitle file on Crunchyroll's CDN was authored for a completely different title. Detected by comparing subtitle end time against video duration. The **Catalog**'s validation map records affected sources so the menu can flag them.

## Relationships

- An **Episode** has one **Catalog**.
- An **Episode** has many **Audio sessions** (discovered as playback responses arrive).
- A **Catalog** maps `(Audio session, Source)` to a subtitle URL.
- A **Source** lives at the user level (preference) but is resolved per-**Episode** via the **Catalog**.
- A **Cue** belongs to a **Source** + **Audio session** pair; **Remaster** transforms cues from one **Audio session**'s timeline to another's.

## Example dialogue

> **Dev:** "When the user changes **Source** mid-playback, do we always need to **Remaster**?"
> **Domain expert:** "Only if the chosen **Source** lives in an **Audio session** other than the one currently playing. If the **Source** locale matches the active dub's session, the **Cues** are already on the right timeline."

## Flagged ambiguities

- "Session" historically meant both "**Audio session**" and informally "current viewing." Resolved: **Episode** for the viewing, **Audio session** for the Crunchyroll streaming concept. The word "session" alone is reserved for **Audio session**.
