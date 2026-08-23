# Spaced repetition

The learner uses FSRS-6 independently for each concept direction (`en-ru` and
`ru-en`). Scheduling is automatic; the child is never asked to choose a
self-assessment rating.

| Observed result | FSRS rating |
| --- | --- |
| Incorrect answer or third speech mismatch | Again |
| Correct multiple-choice answer | Hard |
| Correct speech answer on the first attempt | Good |
| Correct speech answer on the second or third attempt | Hard |
| Same-session remediation | No long-term scheduling update |

The scheduler uses the FSRS-6 default parameters published by `ts-fsrs`
v5.4.1, desired retention `0.90`, a maximum interval of 365 days, and no
interval fuzz. Due timestamps are aligned to the learner's local study day.
Among due reviews, the least retrievable direction is shown first.

`stage` remains in persisted state as a derived, backwards-compatible
presentation band for parent progress displays. It does not determine
intervals or exercise types. Exercise progression uses memory state,
successful review count, stability, spoken-recall history, and device
capabilities.

## Existing installations

Database version 3 marks existing direction records as `legacy-stage` while
preserving their current due timestamp. The record is migrated only when that
direction is next answered. Its non-remediation attempt history is replayed
through FSRS before applying the new answer; the fixed-stage value is used only
as a fallback when no history is available. This avoids suddenly reshuffling
the learner's queue after an update.

Backup schema version 3 stores the FSRS memory fields and still imports version
1 and version 2 backups.
