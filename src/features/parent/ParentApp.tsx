import { useEffect, useMemo, useRef, useState } from "react";

import {
  approveCleanReviewWords,
  approveCurriculumUnit,
  exportCurriculumApprovals,
  exportLearnerBackup,
  importLearnerBackup,
  inspectLearnerBackup,
  loadParentSnapshot,
  pauseNewWords,
  resetWordStt,
  reviewConcept,
  saveAnswerOverride,
  saveSettings,
  startUnit,
  type ParentSnapshot,
  type ParentWordRow,
} from "../../application/parentService";

type Tab = "today" | "course" | "words" | "settings";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function splitAnswers(value: string): string[] {
  return [...new Set(value.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean))];
}

function formatDue(timestamp: number | null | undefined): string {
  if (timestamp == null) return "не назначено";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(timestamp);
}

type ReviewWord = ParentSnapshot["reviewUnits"][number]["words"][number];

function reviewStatusLabel(word: ReviewWord): string {
  if (word.staleDecision) return "Предложение изменилось";
  return {
    approved: "Одобрено",
    edited: "Исправлено",
    excluded: "Исключено",
    deferred: "Отложено",
    auto_reviewed: "Проверено LLM",
    needs_human_review: "Нужно проверить",
  }[word.status];
}

function ReviewWordEditor({ word, close, save }: { word: ReviewWord; close: () => void; save: (values: { ru: string; acceptedEn: string[]; acceptedRu: string[] }) => Promise<void> }) {
  const [ru, setRu] = useState(word.ru);
  const [acceptedEn, setAcceptedEn] = useState(word.acceptedEn.join("\n"));
  const [acceptedRu, setAcceptedRu] = useState(word.acceptedRu.join("\n"));
  const [busy, setBusy] = useState(false);
  return (
    <div className="parent-modal-backdrop" role="presentation" onMouseDown={close}>
      <section className="parent-modal" role="dialog" aria-modal="true" aria-labelledby="review-word-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={close} aria-label="Закрыть">×</button>
        <p className="parent-eyebrow">Проверка перевода</p>
        <h2 id="review-word-title">{word.proposal.en}</h2>
        <label className="field-label">Основной перевод
          <input value={ru} onChange={(event) => setRu(event.target.value)} />
        </label>
        <label className="field-label">Допустимые ответы на английском
          <textarea value={acceptedEn} onChange={(event) => setAcceptedEn(event.target.value)} placeholder="По одному варианту на строке" />
        </label>
        <label className="field-label">Допустимые ответы на русском
          <textarea value={acceptedRu} onChange={(event) => setAcceptedRu(event.target.value)} placeholder="По одному варианту на строке" />
        </label>
        {word.proposal.reviewNotes && <p className="review-note">{word.proposal.reviewNotes}</p>}
        <button className="button button--primary parent-save" disabled={busy || !ru.trim()} onClick={() => {
          setBusy(true);
          void save({ ru: ru.trim(), acceptedEn: splitAnswers(acceptedEn), acceptedRu: splitAnswers(acceptedRu) }).finally(() => setBusy(false));
        }}>Сохранить и одобрить</button>
      </section>
    </div>
  );
}

function WordDetail({ word, close, refresh }: { word: ParentWordRow; close: () => void; refresh: () => Promise<void> }) {
  const [acceptedEn, setAcceptedEn] = useState((word.override?.acceptedEn ?? word.concept.acceptedEn).join("\n"));
  const [acceptedRu, setAcceptedRu] = useState((word.override?.acceptedRu ?? word.concept.acceptedRu).join("\n"));
  const [busy, setBusy] = useState(false);
  const sttProblematic = Object.values(word.states).some((state) => state?.sttProblematic);

  const save = async () => {
    setBusy(true);
    await saveAnswerOverride(word.concept.id, splitAnswers(acceptedEn), splitAnswers(acceptedRu));
    await refresh();
    setBusy(false);
  };

  return (
    <div className="parent-modal-backdrop" role="presentation" onMouseDown={close}>
      <section className="parent-modal" role="dialog" aria-modal="true" aria-labelledby="word-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={close} aria-label="Закрыть">×</button>
        <p className="parent-eyebrow">Слово</p>
        <h2 id="word-title">{word.concept.en} <span>→ {word.concept.ru}</span></h2>
        <div className="direction-grid">
          {(["en-ru", "ru-en"] as const).map((direction) => {
            const state = word.states[direction];
            return (
              <div key={direction}>
                <strong>{direction === "en-ru" ? "EN → RU" : "RU → EN"}</strong>
                <span>Уровень {state?.stage ?? 0}</span>
                <small>Следующее: {formatDue(state?.nextDueAt)}</small>
              </div>
            );
          })}
        </div>
        {sttProblematic && (
          <div className="parent-warning">
            <span>Есть проблема с распознаванием речи</span>
            <button className="text-button" onClick={() => void resetWordStt(word.concept.id).then(refresh)}>Сбросить</button>
          </div>
        )}
        <label className="field-label">Допустимые ответы на английском
          <textarea value={acceptedEn} onChange={(event) => setAcceptedEn(event.target.value)} placeholder="По одному варианту на строке" />
        </label>
        <label className="field-label">Допустимые ответы на русском
          <textarea value={acceptedRu} onChange={(event) => setAcceptedRu(event.target.value)} placeholder="По одному варианту на строке" />
        </label>
        <button className="button button--primary parent-save" disabled={busy} onClick={() => void save()}>Сохранить ответы</button>
        <div className="attempt-list">
          <h3>Последние попытки</h3>
          {word.attempts.length === 0 ? <p>Попыток пока нет.</p> : word.attempts.map((attempt) => (
            <div key={attempt.id}>
              <span className={attempt.outcome === "correct" ? "attempt-good" : "attempt-bad"}>{attempt.outcome === "correct" ? "✓" : "×"}</span>
              <span>{attempt.direction === "en-ru" ? "EN → RU" : "RU → EN"}</span>
              <small>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(attempt.occurredAt)}</small>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function ParentApp({ close, openDiagnostics }: { close: () => void; openDiagnostics: () => void }) {
  const [tab, setTab] = useState<Tab>("today");
  const [snapshot, setSnapshot] = useState<ParentSnapshot | null>(null);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [selectedReviewUnit, setSelectedReviewUnit] = useState<string | null>(null);
  const [editingReviewWord, setEditingReviewWord] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      setSnapshot(await loadParentSnapshot());
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  useEffect(() => { void refresh(); }, []);

  const difficult = useMemo(() => snapshot?.words.filter((word) =>
    Object.values(word.states).some((state) => state && (state.lifetimeFailureCount > 0 || state.sttProblematic)),
  ) ?? [], [snapshot]);
  const word = snapshot?.words.find(({ concept }) => concept.id === selectedWord);
  const reviewUnit = snapshot?.reviewUnits.find(({ unit }) => unit.id === selectedReviewUnit);
  const reviewWord = reviewUnit?.words.find(({ proposal }) => proposal.conceptId === editingReviewWord);

  const updateSettings = async (patch: Partial<ParentSnapshot["settings"]>) => {
    if (!snapshot) return;
    const settings = { ...snapshot.settings, ...patch };
    setSnapshot({ ...snapshot, settings });
    await saveSettings(settings);
  };

  const downloadBackup = async () => {
    const backup = await exportLearnerBackup(__APP_VERSION__);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `english-srs-backup-${backup.exportedAt.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Резервная копия сохранена.");
  };

  const downloadApprovals = async () => {
    const approvals = await exportCurriculumApprovals();
    const blob = new Blob([JSON.stringify(approvals, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "translations.approved.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Проверенные переводы сохранены.");
  };

  const mutateReview = async (operation: () => Promise<void>, success?: string) => {
    try {
      await operation();
      await refresh();
      if (success) setMessage(success);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const restore = async (file?: File) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const backup = inspectLearnerBackup(parsed);
      if (!window.confirm(`Восстановить копию от ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(backup.exportedAt))}? Текущий прогресс будет заменён.`)) return;
      await downloadBackup();
      await importLearnerBackup(backup);
      await refresh();
      setMessage("Данные восстановлены.");
    } catch (cause) {
      setError(`Не удалось восстановить: ${errorMessage(cause)}`);
    } finally {
      if (restoreInput.current) restoreInput.current.value = "";
    }
  };

  if (!snapshot) return <main className="parent-shell"><div className="parent-loading">{error ?? "Загружаем данные…"}</div></main>;

  return (
    <main className="parent-shell">
      <header className="parent-header">
        <div><p className="parent-eyebrow">English Learning SRS</p><h1>Для взрослого</h1></div>
        <button className="button button--secondary" onClick={close}>Вернуться к занятиям</button>
      </header>
      <nav className="parent-tabs" aria-label="Разделы">
        {([['today', 'Сегодня'], ['course', 'Курс'], ['words', 'Слова'], ['settings', 'Настройки']] as const).map(([id, label]) => (
          <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      {error && <aside className="notice notice--error">{error}</aside>}
      {message && <aside className="notice">{message}</aside>}

      {tab === "today" && (
        <div className="parent-grid">
          <section className="parent-panel parent-panel--wide">
            <p className="parent-eyebrow">Сегодня</p><h2>Что происходит с занятиями</h2>
            <div className="today-stats">
              <div><strong>{snapshot.dueCount}</strong><span>повторений ждут</span></div>
              <div><strong>{snapshot.newAvailableToday}</strong><span>новых слов доступно</span></div>
              <div><strong>{snapshot.today?.questionsCompleted ?? 0}</strong><span>заданий сделано</span></div>
              <div><strong>{snapshot.today?.immediateMistakes ?? 0}</strong><span>ошибок сразу</span></div>
            </div>
          </section>
          <section className="parent-panel parent-panel--wide">
            <div className="parent-section-heading"><div><p className="parent-eyebrow">Нужно внимание</p><h2>Сложные слова</h2></div><span>{difficult.length}</span></div>
            {difficult.length === 0 ? <p className="parent-muted">Пока ничего подозрительного.</p> : (
              <div className="word-list">{difficult.slice(0, 8).map((item) => (
                <button key={item.concept.id} onClick={() => setSelectedWord(item.concept.id)}>
                  <strong>{item.concept.en}</strong><span>{item.concept.ru}</span>
                  <small>{Object.values(item.states).reduce((sum, state) => sum + (state?.lifetimeFailureCount ?? 0), 0)} ошибок</small>
                </button>
              ))}</div>
            )}
          </section>
        </div>
      )}

      {tab === "course" && (
        <section className="parent-panel">
          {reviewUnit ? (
            <>
              <button className="text-button" onClick={() => setSelectedReviewUnit(null)}>← Все блоки</button>
              <div className="review-unit-heading">
                <div><p className="parent-eyebrow">Блок {reviewUnit.unit.number}</p><h2>{reviewUnit.unit.titleRu ?? reviewUnit.unit.id}</h2></div>
                <div className="review-unit-counts"><span>{reviewUnit.words.length} слов</span><strong>{reviewUnit.unresolvedCount} осталось</strong></div>
              </div>
              <p className="parent-muted">Проверьте отмеченные слова. Варианты без замечаний можно принять одной кнопкой.</p>
              <div className="review-actions">
                <button className="button button--secondary" disabled={reviewUnit.cleanCount === 0} onClick={() => void mutateReview(() => approveCleanReviewWords(reviewUnit.unit.id), "Переводы без замечаний одобрены.")}>Принять без замечаний ({reviewUnit.cleanCount})</button>
                <button className="button button--primary" disabled={reviewUnit.unresolvedCount > 0 || Boolean(reviewUnit.approvedAt)} onClick={() => void mutateReview(() => approveCurriculumUnit(reviewUnit.unit.id), "Блок одобрен и добавлен в курс.")}>{reviewUnit.approvedAt ? "Блок одобрен" : "Одобрить блок"}</button>
              </div>
              <div className="review-word-list">{reviewUnit.words.map((item) => (
                <article key={item.proposal.conceptId} className={`review-word review-word--${item.status}`}>
                  <div className="review-word-main">
                    <div><strong>{item.proposal.en}</strong><span>→ {item.ru}</span></div>
                    <small>{reviewStatusLabel(item)}</small>
                  </div>
                  {(item.acceptedRu.length > 0 || item.acceptedEn.length > 0) && <p className="review-aliases">Варианты: {[...item.acceptedRu, ...item.acceptedEn].join(", ")}</p>}
                  {item.proposal.reviewNotes && <p className="review-note">{item.proposal.reviewNotes}</p>}
                  <div className="review-word-actions">
                    {!(["approved", "edited", "excluded"] as string[]).includes(item.status) && <button className="text-button" onClick={() => void mutateReview(() => reviewConcept(item.proposal.conceptId, "approved"))}>Принять</button>}
                    <button className="text-button" onClick={() => setEditingReviewWord(item.proposal.conceptId)}>Исправить</button>
                    {item.status !== "excluded" && <button className="text-button review-exclude" onClick={() => void mutateReview(() => reviewConcept(item.proposal.conceptId, "excluded"))}>Исключить</button>}
                  </div>
                </article>
              ))}</div>
            </>
          ) : (
            <>
              <p className="parent-eyebrow">Курс</p><h2>Проверка и добавление блоков</h2>
              <p className="parent-muted">Сначала одобрите блок, затем добавьте его в занятия. Можно включить несколько блоков — новые слова пойдут по порядку, начиная с более раннего.</p>
              <div className="unit-list">{snapshot.reviewUnits.map((candidate) => {
                const active = snapshot.units.find((unit) => unit.id === candidate.unit.id);
                const introduced = active?.conceptIds.filter((id) => snapshot.words.find((item) => item.concept.id === id)?.progressIntroduced).length ?? 0;
                return (
                  <article key={candidate.unit.id} className={active?.state === "introducing" ? "unit-card unit-card--active" : "unit-card"}>
                    <div><span>Блок {candidate.unit.number}</span><h3>{candidate.unit.titleRu ?? candidate.unit.id}</h3><small>{candidate.approvedAt ? `Одобрен · ${introduced} / ${active?.conceptIds.length ?? 0} добавлено` : `${candidate.unresolvedCount} слов осталось проверить`}</small></div>
                    <div className="unit-card-actions">
                      <button className="button button--secondary" onClick={() => setSelectedReviewUnit(candidate.unit.id)}>{candidate.approvedAt ? "Просмотреть" : "Проверить"}</button>
                      {candidate.approvedAt && (active?.state === "introducing"
                        ? <button className="button button--secondary" onClick={() => void mutateReview(() => pauseNewWords(candidate.unit.id), "Блок поставлен на паузу.")}>Пауза</button>
                        : active?.state === "fully_introduced"
                          ? <button className="button button--secondary" disabled>Блок завершён</button>
                          : <button className="button button--primary" onClick={() => void mutateReview(() => startUnit(candidate.unit.id), "Блок добавлен в занятия.")}>Добавить в занятия</button>)}
                    </div>
                  </article>
                );
              })}</div>
            </>
          )}
        </section>
      )}

      {tab === "words" && (
        <section className="parent-panel">
          <p className="parent-eyebrow">Словарь</p><h2>Прогресс по словам</h2>
          <div className="word-list word-list--all">{snapshot.words.map((item) => (
            <button key={item.concept.id} onClick={() => setSelectedWord(item.concept.id)}>
              <strong>{item.concept.en}</strong><span>{item.concept.ru}</span>
              <small>{item.progressIntroduced ? `уровни ${item.states["en-ru"]?.stage ?? 0} / ${item.states["ru-en"]?.stage ?? 0}` : "ещё не добавлено"}</small>
            </button>
          ))}</div>
        </section>
      )}

      {tab === "settings" && (
        <div className="parent-grid">
          <section className="parent-panel">
            <p className="parent-eyebrow">Темп</p><h2>Новые слова и очередь</h2>
            <label className="field-label">Новых слов в день
              <input type="number" min="0" max="20" value={snapshot.settings.dailyNewConceptQuota} onChange={(event) => void updateSettings({ dailyNewConceptQuota: Number(event.target.value) })} />
            </label>
            <label className="field-label">Остановить новые слова при очереди больше
              <input type="number" min="0" max="500" value={snapshot.settings.backlogThreshold} onChange={(event) => void updateSettings({ backlogThreshold: Number(event.target.value) })} />
            </label>
            <label className="parent-check"><input type="checkbox" checked={snapshot.settings.suppressNewOnBacklog} onChange={(event) => void updateSettings({ suppressNewOnBacklog: event.target.checked })} /> Приостанавливать новые слова автоматически</label>
          </section>
          <section className="parent-panel">
            <p className="parent-eyebrow">Данные</p><h2>Резервная копия</h2>
            <p className="parent-muted">Храните копию вне приложения: облачной синхронизации нет.</p>
            <div className="backup-actions">
              <button className="button button--primary" onClick={() => void downloadBackup()}>Скачать копию</button>
              <button className="button button--secondary" onClick={() => restoreInput.current?.click()}>Восстановить</button>
              <input ref={restoreInput} hidden type="file" accept="application/json,.json" onChange={(event) => void restore(event.target.files?.[0])} />
            </div>
            <button className="text-button diagnostics-link" onClick={() => void downloadApprovals()}>Скачать проверенные переводы</button>
            <button className="text-button diagnostics-link" onClick={openDiagnostics}>Диагностика устройства</button>
          </section>
        </div>
      )}
      {word && <WordDetail word={word} close={() => setSelectedWord(null)} refresh={refresh} />}
      {reviewWord && <ReviewWordEditor word={reviewWord} close={() => setEditingReviewWord(null)} save={async (values) => {
        await mutateReview(() => reviewConcept(reviewWord.proposal.conceptId, "edited", values), "Перевод сохранён.");
        setEditingReviewWord(null);
      }} />}
    </main>
  );
}

declare const __APP_VERSION__: string;
