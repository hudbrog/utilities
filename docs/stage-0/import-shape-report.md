# Stage 0 — Duome archive import-shape report

Source archive: `enfromru141.7z`<br>
Course: `DUOLINGO_EN_RU` (ru → en)<br>
Source fingerprint: `2ab48129d24e77753135cb0a669dc54d3d5e28805681912f8406986a5d78e0df`

## Conclusion

The archive is useful for curriculum order and English lexeme identity, but it is **not sufficient by itself to build the bilingual vocabulary concepts required by V0.1**.

- The course JSON contains the 141-unit path, skill IDs, skill names, and ordering.
- The vocabulary JSON contains stable-looking Duolingo lexeme IDs, English surface forms, normalized strings, part of speech, and a skill name.
- The vocabulary rows contain **no Russian translation field and no accepted-answer lists**. Russian prose in tips/guidebook metadata is not a word-level translation source.
- Vocabulary rows identify their skill by display name rather than skill ID. Most can be joined through the course skill definitions, but skills can reappear in several path units. Import policy should assign a lexeme to the earliest unit where its owning skill is taught, while reporting every repeated or unresolved mapping for review.

The next data step therefore needs a conservative EN↔RU translation source or a separately exported Duolingo dictionary/lexeme payload. Machine-generated synonyms should not be accepted automatically.

## Archive contents

| File | Shape | Purpose |
|---|---|---|
| `enfromru141.json` | object with `currentCourse` | path, units, skills, sections, course metadata |
| `enfromru141-words.json` | object with `vocab_overview` | English lexemes and per-word metadata |

## Structural metrics

| Metric | Value |
|---|---:|
| Path units | 141 |
| Course skill definitions | 171 |
| Distinct skill display names | 171 |
| Skill names resolving to several IDs | 0 |
| Skill IDs appearing in several units | 171 |
| Vocabulary rows | 1372 |
| Unique lexeme IDs | 1372 |
| Duplicate lexeme-ID rows | 0 |
| Rows where id equals lexeme_id | 1372 |
| Distinct case-folded English word strings | 1290 |
| Rows with a unique unit mapping | 0 |
| Rows whose skill appears in several units | 1372 |
| Rows without a path-unit mapping | 0 |

## Vocabulary record contract found

Fields present on vocabulary rows:

`gender`, `id`, `infinitive`, `last_practiced`, `last_practiced_ms`, `lexeme_id`, `normalized_string`, `pos`, `related_lexemes`, `skill`, `skill_url_title`, `strength`, `strength_bars`, `word_string`

Translation-like fields detected: **none**.

Recommended source-to-domain mapping:

| Source | V0.1 field | Notes |
|---|---|---|
| `lexeme_id` | `ConceptDefinition.id` input | Stable upstream identity; prefix with curriculum ID in emitted data |
| owning skill → earliest path unit | `unitId`, `order` | Deterministic, but repeated/missing joins remain reportable diagnostics |
| `word_string` | `en` | Surface form; preserve source spelling |
| `normalized_string` | possible English alias | Review before accepting when it differs from the surface form |
| `pos` | `partOfSpeech` | Source values should be normalized to an importer enum later |
| no source field | `ru`, `acceptedRu` | Blocking gap |
| no source field | broader `acceptedEn` aliases | Must be curated conservatively |

## Path level types

| Metric | Value |
|---|---:|
| skill | 513 |
| practice | 388 |
| chest | 281 |
| story | 182 |
| unit_review | 141 |

## Most common parts of speech

| Metric | Value |
|---|---:|
| Noun | 315 |
| Verb | 260 |
| (missing) | 244 |
| Adjective | 212 |
| Adverb | 118 |
| Numeral | 56 |
| Proper noun | 45 |
| Preposition | 37 |
| Pronoun | 33 |
| Determiner | 24 |

## Mapping diagnostics

Skill names with vocabulary rows but no resolved path unit (0):

- None

Skill names that map to several path units (90):

- Австралия
- Америка
- Аэропорт
- Барахолка
- Больничный
- Будни
- В магазине
- В пути
- В пути 2
- Вечеринка
- Встреча
- Выходные
- Город
- Деньги
- Детство
- Документы
- Друзья
- Еда
- Еда 2
- Знакомство
- Зоопарк
- Как жизнь?
- Квартира
- Лагерь
- Места
- Мое резюме
- Мои вкусы
- Мой город
- Мой район
- Моя семья

## Importer decisions to carry into Phase 1

1. Treat `lexeme_id` as the upstream stable concept key; never derive identity from translated display text.
2. Join vocabulary skill name → course skill ID → path unit, choosing the earliest unit for repeated skill appearances.
3. Preserve the complete list of repeated and missing joins in every import report.
4. Do not interpret `related_lexemes` as accepted synonyms without manual validation.
5. Add an explicit curated translation input before emitting `CurriculumBundle` records.
6. Keep the original source fingerprint in the generated bundle for reproducibility.
