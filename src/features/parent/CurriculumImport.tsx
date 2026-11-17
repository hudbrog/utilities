import { useRef, useState } from "react";
import { addCurriculum, previewCurriculumImport } from "../../application/parentService";
import type { ImportChoice } from "../../domain/curriculum/import";
import { importedId } from "../../domain/curriculum/import";

type Preview = Awaited<ReturnType<typeof previewCurriculumImport>>;

export function CurriculumImport({ onImported, academyInstalled }: { onImported: (id: string) => Promise<void>; academyInstalled: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, ImportChoice>>({});
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [onlyReview, setOnlyReview] = useState(true);

  const prepare = async (read: () => Promise<unknown>, name: string) => {
    setBusy(true); setError("");
    try {
      const next = await previewCurriculumImport(await read());
      setPreview(next);
      setTitle(next.bundle.curriculumId === "academy-stars-1-workbook-2017" ? "Academy Stars 1" : name);
      setChoices(Object.fromEntries(next.rows.map((row) => [row.concept.id, row.choice])));
      setOnlyReview(next.rows.some((row) => row.choice === "review"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const academy = () => prepare(async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}academy-stars-1.json`);
    if (!response.ok) throw new Error("Не удалось загрузить Academy Stars 1");
    return response.json();
  }, "Academy Stars 1");
  const unresolved = preview?.rows.filter((row) => choices[row.concept.id] === "review").length ?? 0;
  const selectedIds = new Set(preview?.rows.flatMap((row) => {
    const choice = choices[row.concept.id];
    return choice?.startsWith("link:") ? [choice.slice(5)] : choice === "new" ? [importedId(preview.bundle.curriculumId, row.concept.id)] : [];
  }));
  const introduced = new Set(preview?.introduced ?? []);
  const alreadyLearning = [...selectedIds].filter((id) => introduced.has(id)).length;

  const submit = async () => {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const source = await addCurriculum(preview.bundle, title, choices);
      setPreview(null);
      await onImported(source.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return <section className="curriculum-import" aria-label="Добавление курса">
    <div className="review-actions">
      <button className="button button--secondary" disabled={busy || academyInstalled} onClick={() => void academy()}>{academyInstalled ? "Academy Stars 1 добавлен" : "Добавить Academy Stars 1"}</button>
      <button className="button button--secondary" disabled={busy} onClick={() => fileInput.current?.click()}>Добавить набор из JSON</button>
      <input ref={fileInput} hidden type="file" accept="application/json,.json" aria-label="Файл нового курса" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void prepare(async () => {
          if (file.size > 5_000_000) throw new Error("Размер файла должен быть не больше 5 МБ");
          return JSON.parse(await file.text());
        }, file.name.replace(/\.json$/i, ""));
        event.target.value = "";
      }} />
    </div>
    {error && <p className="notice notice--error" role="alert">{error}</p>}
    {preview && <div className="import-preview">
      <h3>Проверка нового курса</h3>
      <label className="field-label">Название курса<input value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
      <p>{preview.bundle.units.length} блоков · {preview.rows.length} записей · {alreadyLearning} уже в занятиях · {selectedIds.size - alreadyLearning} ещё не вводились · {unresolved} требуют решения</p>
      <p className="parent-muted">Совпадающие слова используют общий прогресс в обоих направлениях. Слова из будущих блоков Duolingo тоже связаны, но считаются новыми, пока не появятся в занятии. Блоки добавятся на паузе.</p>
      <label className="parent-check"><input type="checkbox" checked={onlyReview} onChange={(event) => setOnlyReview(event.target.checked)} /> Только неоднозначные совпадения</label>
      <div className="import-rows">{preview.rows.filter((row) => !onlyReview || row.choice === "review").map((row) => <article className="import-row" key={row.concept.id}>
        <div><strong>{row.concept.en}</strong><span> → {row.concept.ru}</span>
          {row.ambiguous && <small>Несколько значений или неподходящая карточка: пропустите её либо оставьте отдельно. Для объединения сначала разделите значения в файле.</small>}
        </div>
        <label className="field-label"><span className="sr-only">Совпадение для {row.concept.en}</span><select disabled={busy} value={choices[row.concept.id]} onChange={(event) => setChoices({ ...choices, [row.concept.id]: event.target.value as ImportChoice })}>
          <option value="review">Выберите действие…</option>
          <option value="new">Отдельное слово</option>
          <option value="skip">Пропустить</option>
          {!row.ambiguous && row.candidates.map((candidate) => <option key={candidate.id} value={`link:${candidate.id}`}>Общий прогресс: {candidate.en} → {candidate.ru}{introduced.has(candidate.id) ? " (уже в занятиях)" : ""}</option>)}
        </select></label>
      </article>)}</div>
      <div className="review-actions">
        <button className="button button--primary" disabled={busy || unresolved > 0 || !title.trim() || selectedIds.size === 0} onClick={() => void submit()}>{busy ? "Добавляем…" : "Добавить блоки"}</button>
        <button className="button button--secondary" disabled={busy} onClick={() => setPreview(null)}>Отмена</button>
      </div>
    </div>}
  </section>;
}
