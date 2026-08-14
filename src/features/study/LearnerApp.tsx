import { useCallback, useEffect, useMemo, useState } from "react";

import { buildMultipleChoiceOptions, type MultipleChoiceOption } from "../../domain/exercises/distractors";
import { fixtureCurriculum } from "../../generated/fixtureCurriculum";
import { speak } from "../../infrastructure/speech/synthesis";
import {
  goToNextQuestion,
  introducedConceptIds,
  loadStudy,
  scoreMultipleChoice,
  type StudySnapshot,
} from "../../application/studyService";

type ViewState =
  | { status: "loading" }
  | { status: "ready"; snapshot: StudySnapshot; options: MultipleChoiceOption[] }
  | { status: "error"; message: string };

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function answerText(snapshot: StudySnapshot): string {
  if (!snapshot.concept || !snapshot.current) return "";
  return snapshot.current.direction === "en-ru" ? snapshot.concept.ru : snapshot.concept.en;
}

function promptText(snapshot: StudySnapshot): string {
  if (!snapshot.concept || !snapshot.current) return "";
  return snapshot.current.direction === "en-ru" ? snapshot.concept.en : snapshot.concept.ru;
}

async function optionsFor(snapshot: StudySnapshot): Promise<MultipleChoiceOption[]> {
  if (!snapshot.current || !snapshot.concept || snapshot.current.status === "revealed") return [];
  return buildMultipleChoiceOptions({
    target: snapshot.concept,
    direction: snapshot.current.direction,
    concepts: fixtureCurriculum.concepts,
    units: fixtureCurriculum.units,
    introducedConceptIds: await introducedConceptIds(),
    seed: `${snapshot.session.seed}:${snapshot.current.id}`,
  });
}

export function LearnerApp({ openDiagnostics }: { openDiagnostics: () => void }) {
  const [view, setView] = useState<ViewState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState(false);

  const replaceSnapshot = useCallback(async (snapshot: StudySnapshot) => {
    setSelectedId(null);
    setAudioError(false);
    setView({ status: "ready", snapshot, options: await optionsFor(snapshot) });
  }, []);

  useEffect(() => {
    void loadStudy()
      .then(replaceSnapshot)
      .catch((error: unknown) => setView({ status: "error", message: messageFor(error) }));
  }, [replaceSnapshot]);

  const progress = useMemo(() => {
    if (view.status !== "ready") return { completed: 0, total: 0, mistakes: 0 };
    return {
      completed: view.snapshot.questions.filter(({ status }) => status === "completed").length,
      total: view.snapshot.questions.length,
      mistakes: view.snapshot.questions.filter(({ revealedOutcome }) => revealedOutcome === "incorrect").length,
    };
  }, [view]);

  const playAnswer = async (snapshot: StudySnapshot) => {
    if (!snapshot.current) return;
    setAudioError(false);
    try {
      await speak(answerText(snapshot), snapshot.current.direction === "en-ru" ? "ru-RU" : "en-US");
    } catch {
      setAudioError(true);
    }
  };

  const choose = async (option: MultipleChoiceOption) => {
    if (view.status !== "ready" || busy || view.snapshot.current?.status !== "current") return;
    setBusy(true);
    setSelectedId(option.conceptId);
    try {
      const next = await scoreMultipleChoice(view.snapshot, option.correct);
      await replaceSnapshot(next);
      setSelectedId(option.conceptId);
      void playAnswer(next);
    } catch (error) {
      setView({ status: "error", message: messageFor(error) });
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    if (view.status !== "ready" || busy) return;
    setBusy(true);
    try {
      await replaceSnapshot(await goToNextQuestion(view.snapshot));
    } catch (error) {
      setView({ status: "error", message: messageFor(error) });
    } finally {
      setBusy(false);
    }
  };

  if (view.status === "loading") {
    return <main className="study-shell"><div className="study-card study-card--center">Готовим задания…</div></main>;
  }
  if (view.status === "error") {
    return (
      <main className="study-shell">
        <div className="study-card study-card--center">
          <p className="study-kicker">Нужен взрослый</p>
          <h1>Не удалось открыть занятие</h1>
          <p>{view.message}</p>
          <button className="button button--secondary" onClick={openDiagnostics}>Открыть диагностику</button>
        </div>
      </main>
    );
  }

  const { snapshot, options } = view;
  if (snapshot.completed) {
    return (
      <main className="study-shell">
        <section className="study-card study-card--summary">
          <div className="summary-check" aria-hidden="true">✓</div>
          <p className="study-kicker">Занятие закончено</p>
          <h1>Готово!</h1>
          <div className="summary-stats">
            <div><strong>{progress.total}</strong><span>заданий</span></div>
            <div><strong>{Math.max(0, progress.total - progress.mistakes)}</strong><span>сразу правильно</span></div>
            <div><strong>{progress.mistakes}</strong><span>повторили</span></div>
          </div>
          <button className="text-button diagnostics-link" onClick={openDiagnostics}>Диагностика для взрослого</button>
        </section>
      </main>
    );
  }

  const revealed = snapshot.current?.status === "revealed";
  const correct = snapshot.current?.revealedOutcome === "correct";
  const currentNumber = Math.min(progress.completed + 1, progress.total);
  return (
    <main className="study-shell">
      <section className={`study-card ${revealed ? correct ? "study-card--correct" : "study-card--incorrect" : ""}`}>
        <header className="study-topbar">
          <span>{currentNumber} / {progress.total}</span>
          <div className="study-progress" aria-label={`Задание ${currentNumber} из ${progress.total}`}>
            <span style={{ width: `${progress.total ? (currentNumber / progress.total) * 100 : 0}%` }} />
          </div>
          <button className="quiet-button" onClick={openDiagnostics} aria-label="Открыть диагностику">•••</button>
        </header>

        <div className="study-prompt">
          <p className="study-kicker">{snapshot.current?.direction === "en-ru" ? "Выбери перевод" : "Choose the translation"}</p>
          <h1 lang={snapshot.current?.direction === "en-ru" ? "en" : "ru"}>{promptText(snapshot)}</h1>
        </div>

        {!revealed ? (
          <div className="choice-list">
            {options.map((option) => (
              <button
                className={`choice ${selectedId === option.conceptId ? "choice--selected" : ""}`}
                disabled={busy}
                key={option.conceptId}
                onClick={() => void choose(option)}
              >
                {option.text}
              </button>
            ))}
          </div>
        ) : (
          <div className="reveal" aria-live="polite">
            <div className="reveal__result">
              <span className="reveal__icon" aria-hidden="true">{correct ? "✓" : "→"}</span>
              <div>
                <p>{correct ? "Правильно!" : "Правильный ответ"}</p>
                <strong>{answerText(snapshot)}</strong>
              </div>
            </div>
            <button className="replay-button" onClick={() => void playAnswer(snapshot)} aria-label="Повторить произношение">🔊 Ещё раз</button>
            {audioError && <small className="audio-warning">Не удалось воспроизвести звук</small>}
            <button className="next-button" disabled={busy} onClick={() => void next()}>Дальше</button>
          </div>
        )}
      </section>
    </main>
  );
}
