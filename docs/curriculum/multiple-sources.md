# School workbooks alongside Duolingo

The learner has one vocabulary history. A curriculum block contains references to those words; it does not own a second copy of the learning state. An imported school word that matches an existing Duolingo concept keeps its original concept ID, both directional schedules, attempts, parent answer overrides, and speech-recognition history.

## Parent flow

1. Open **Для взрослого → Курс → Добавить Academy Stars 1**, or **Добавить набор из JSON** for another source.
2. Review the preview. Exact canonical English/Russian matches link automatically. Other English/alias matches and entries containing multiple meanings require a decision. Inspect all rows by disabling the ambiguity filter.
3. For an uncertain match, choose a shared existing word, a separate word, or skip it. Multi-meaning entries cannot be linked until split in the source file; they may be skipped or kept as a separate card.
4. Add the blocks, then enable only the units currently being studied. Core vocabulary and extras are separate blocks. Imported units start inactive unless all their words have already been introduced.

The uploaded workbook is packaged unchanged: 263 entries across Welcome and units 1–10, with a core block and an extra block for each. In particular, `orange → апельсин / оранжевый` is flagged rather than silently merged with one sense.

“Already in lessons” means introduced on this device, not mastered. A word in progress or due for review stays on its current schedule. The app does not fetch live Duolingo progress or infer mastery from workbook coverage. Matching words in future Duolingo blocks reserve the same ID but still count as new to the learner until first shown.

Linked entries use the existing canonical card and accepted answers. Import does not silently replace parent overrides or widen accepted translations. Edit accepted answers in the normal word detail screen if needed.

## Matching and scheduling

- Auto-link only a single exact English/Russian canonical pair, allowing Unicode normalization, case, whitespace and Russian е/ё differences. Conflicting known parts of speech prevent automatic linking. Punctuation, inflections, and broad synonyms are not collapsed.
- Alias matches are suggestions for parent review. Matching English spelling alone never marks a word known.
- Source-local unit and concept IDs are namespaced on import. Existing learner IDs are never rewritten.
- Existing installed definitions and the current Duolingo review package supply candidate identities. This handles either order: school first or Duolingo first.
- Shared concepts occur once in the introduction queue and consume one new-word allowance, when actually presented. EN→RU and RU→EN remain separate questions and memory states.
- Active sources alternate new vocabulary within the shared daily quota, keeping unit order within each source. Continuation rotates according to the total number of introduced concepts, including across days with a quota of one. Reviews and the existing backlog safety limit remain global.
- Pausing a block stops new introductions; it does not stop reviews. Removing approval from a Duolingo membership does not retire a concept still used by an imported source.

## JSON format

The existing bundle format is accepted with a nonempty source ID and nonnegative unit numbers (Welcome may be 0). IDs, unit numbers, and membership must be valid and unique within the file. The parent UI limits uploads to 5 MB.

```json
{
  "schemaVersion": 1,
  "curriculumId": "school-week-12",
  "curriculumVersion": "1",
  "sourceFingerprint": "school-week-12-v1",
  "units": [
    { "id": "animals", "number": 0, "titleRu": "Животные", "conceptIds": ["cat"] }
  ],
  "concepts": [
    {
      "id": "cat", "unitId": "animals", "order": 0,
      "en": "cat", "ru": "кошка", "acceptedEn": [], "acceptedRu": ["кот"]
    }
  ]
}
```

Optional concept fields remain `partOfSpeech`, `semanticCategory`, and `unsuitableReason`. The parent's course title is separate from the source ID.

Imported sources are immutable in this first version. Re-importing an identical bundle is idempotent at the repository layer; the UI directs the parent to the existing course. A changed bundle with the same source ID is rejected without writes. Use a new `curriculumId` for an additional set of blocks; vocabulary will still be matched against existing words. Editing/deleting entire imported sources and an in-app block authoring editor are not included.

## Persistence and compatibility

Database version 4 adds only `importedCurricula`. Existing units gain optional source/title/availability fields; old units default to Duolingo without rewriting their IDs or state. Unit membership, rather than the legacy `concept.unitId` provenance field, determines whether a shared concept remains eligible.

Imports are atomic. The saved source includes its original bundle and source-ID-to-canonical-ID mapping. New backups (version 4) additionally snapshot installed concept definitions and full unit membership, so imported curricula can be restored to an empty database. Backups 1–3 remain readable and preserve the existing scheduler migration path. Restore discards unfinished queues and recovers incomplete directional introductions using the existing mechanism.

Current limits: no automatic coalescing of historical duplicate progress records, no runtime dictionary/fuzzy matching, and no guarantee that a future changed Duolingo dataset will assign the same identity to a newly added spelling/sense. The import preview uses the installed app's current candidate definitions.

## Validation

Coverage includes database versions 1–3, old backup formats, fresh-device source restoration, shared schedules and answer overrides, idempotent imports, invalid-link/ambiguity rejection, transaction rollback, simultaneous source queues, school-first Duolingo activation, source approval invalidation, and parent import controls. Production builds precache the workbook JSON for offline use.
