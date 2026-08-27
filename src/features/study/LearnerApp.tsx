import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildMultipleChoiceOptions, type MultipleChoiceOption } from "../../domain/exercises/distractors";
import { speak } from "../../infrastructure/speech/synthesis";
import { isAcceptedAnswer } from "../../domain/exercises/matching";
import { listenOnce, RecognitionError } from "../../infrastructure/speech/recognition";
import {
  goToNextQuestion,
  distractorCurriculum,
  introducedConceptIds,
  loadStudy,
  scoreAnswer,
  type StudySnapshot,
} from "../../application/studyService";

type ViewState =
  | { status: "loading" }
  | { status: "ready"; snapshot: StudySnapshot; options: MultipleChoiceOption[] }
  | { status: "error"; message: string };

const TRANSITION_DEBOUNCE_MS = 450;
const CORRECT_FEEDBACK_MS = 700;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

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
  const curriculum = await distractorCurriculum();
  return buildMultipleChoiceOptions({
    target: snapshot.concept,
    direction: snapshot.current.direction,
    concepts: curriculum.concepts,
    units: curriculum.units,
    introducedConceptIds: await introducedConceptIds(),
    seed: `${snapshot.session.seed}:${snapshot.current.id}`,
  });
}

export function LearnerApp({ openDiagnostics }: { openDiagnostics: () => void }) {
  const [view, setView] = useState<ViewState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState(false);
  const [sttAttempts, setSttAttempts] = useState<string[][]>([]);
  const [sttMessage, setSttMessage] = useState<string | null>(null);
  const [mcFallback, setMcFallback] = useState(false);
  const actionInFlight = useRef(false);
  const inputLockedUntil = useRef(0);

  const replaceSnapshot = useCallback(async (snapshot: StudySnapshot) => {
    setSelectedId(null);
    setAudioError(false);
    setSttAttempts([]);
    setSttMessage(null);
    setMcFallback(false);
    const options = await optionsFor(snapshot);
    inputLockedUntil.current = performance.now() + TRANSITION_DEBOUNCE_MS;
    setView({ status: "ready", snapshot, options });
  }, []);

  const beginAction = () => {
    if (actionInFlight.current || performance.now() < inputLockedUntil.current) return false;
    actionInFlight.current = true;
    setBusy(true);
    return true;
  };

  const endAction = () => {
    actionInFlight.current = false;
    setBusy(false);
  };

  useEffect(() => {
    void loadStudy()
      .then((snapshot) => snapshot.current?.status === "revealed" && snapshot.current.revealedOutcome === "correct"
        ? goToNextQuestion(snapshot)
        : snapshot)
      .then(replaceSnapshot)
      .catch((error: unknown) => setView({ status: "error", message: messageFor(error) }));
  }, [replaceSnapshot]);

  useEffect(() => {
    if (
      view.status === "ready" &&
      view.snapshot.current?.status === "current" &&
      view.snapshot.current.exerciseType.endsWith("audio")
    ) {
      const locale = view.snapshot.current.direction === "en-ru" ? "en-US" : "ru-RU";
      void speak(promptText(view.snapshot), locale).catch(() => setAudioError(true));
    }
  }, [view]);

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

  const showScoredAnswer = async (scored: StudySnapshot) => {
    await replaceSnapshot(scored);
    if (scored.current?.revealedOutcome !== "correct") {
      void playAnswer(scored);
      return;
    }
    void playAnswer(scored);
    await delay(CORRECT_FEEDBACK_MS);
    await replaceSnapshot(await goToNextQuestion(scored));
  };

  const choose = async (option: MultipleChoiceOption) => {
    if (view.status !== "ready" || view.snapshot.current?.status !== "current" || !beginAction()) return;
    setSelectedId(option.conceptId);
    try {
      await showScoredAnswer(await scoreAnswer(view.snapshot, option.correct, { completionMode: "multiple-choice" }));
    } catch (error) {
      setView({ status: "error", message: messageFor(error) });
    } finally {
      endAction();
    }
  };

  const listen = async () => {
    if (view.status !== "ready" || !view.snapshot.current || !view.snapshot.concept || !beginAction()) return;
    setSttMessage("Слушаю…");
    try {
      const locale = view.snapshot.current.direction === "en-ru" ? "ru-RU" : "en-US";
      const result = await listenOnce(locale, { localOnly: false });
      const transcripts = result.alternatives.map(({ transcript }) => transcript);
      const history = [...sttAttempts, transcripts];
      setSttAttempts(history);
      const matched = transcripts.some((transcript) => isAcceptedAnswer(transcript, view.snapshot.concept!, view.snapshot.current!.direction));
      if (matched) {
        await showScoredAnswer(await scoreAnswer(view.snapshot, true, { completionMode: "speech", sttAttemptCount: history.length, sttTranscripts: history }));
      } else if (history.length >= 3) {
        await showScoredAnswer(await scoreAnswer(view.snapshot, false, {
          completionMode: "speech", completionReason: "third_stt_mismatch", sttAttemptCount: history.length, sttTranscripts: history,
        }));
      } else if (history.length === 1) {
        setSttMessage("Не расслышала. Попробуй ещё раз.");
      } else {
        setSttMessage(`Я услышала: «${transcripts[0] ?? "…"}». Попробуй ещё раз.`);
      }
    } catch (error) {
      const code = error instanceof RecognitionError ? error.code : "adapter-error";
      setSttMessage(code === "not-allowed" ? "Микрофон недоступен. Можно выбрать ответ." : "Речь сейчас не распознаётся. Попробуй ещё раз или выбери ответ.");
      setMcFallback(true);
    } finally {
      endAction();
    }
  };

  const next = async () => {
    if (view.status !== "ready" || !beginAction()) return;
    try {
      await replaceSnapshot(await goToNextQuestion(view.snapshot));
    } catch (error) {
      setView({ status: "error", message: messageFor(error) });
    } finally {
      endAction();
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
    const needsCurriculum = snapshot.emptyReason === "no-curriculum";
    return (
      <main className="study-shell">
        <section className="study-card study-card--summary">
          <div className="summary-check" aria-hidden="true">✓</div>
          <p className="study-kicker">{needsCurriculum ? "Нужен взрослый" : "Занятие закончено"}</p>
          <h1>{needsCurriculum ? "Подготовьте первый блок" : "Готово!"}</h1>
          {needsCurriculum && <p>Сначала взрослый должен проверить слова в разделе курса.</p>}
          <div className="summary-stats">
            <div><strong>{progress.total}</strong><span>заданий</span></div>
            <div><strong>{Math.max(0, progress.total - progress.mistakes)}</strong><span>сразу правильно</span></div>
            <div><strong>{progress.mistakes}</strong><span>повторили</span></div>
          </div>
          <button className={needsCurriculum ? "button button--primary" : "text-button diagnostics-link"} onClick={openDiagnostics}>{needsCurriculum ? "Открыть раздел для взрослого" : "Диагностика для взрослого"}</button>
        </section>
      </main>
    );
  }

  const revealed = snapshot.current?.status === "revealed";
  const correct = snapshot.current?.revealedOutcome === "correct";
  const currentNumber = Math.min(progress.completed + 1, progress.total);
  const speechQuestion = snapshot.current?.exerciseType.startsWith("stt_") && !mcFallback;
  const audioPrompt = snapshot.current?.exerciseType.endsWith("audio");
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
          {audioPrompt ? (
            <button className="audio-prompt" onClick={() => void speak(promptText(snapshot), snapshot.current?.direction === "en-ru" ? "en-US" : "ru-RU")}>🔊<span>Послушать ещё раз</span></button>
          ) : <h1 lang={snapshot.current?.direction === "en-ru" ? "en" : "ru"}>{promptText(snapshot)}</h1>}
        </div>

        {!revealed && speechQuestion ? (
          <div className="speech-answer">
            <button className={busy ? "microphone-button microphone-button--active" : "microphone-button"} disabled={busy} onClick={() => void listen()} aria-label="Ответить голосом">🎙</button>
            <p aria-live="polite">{sttMessage ?? "Нажми и скажи перевод"}</p>
            <small>Попытка {Math.min(sttAttempts.length + 1, 3)} из 3</small>
            {sttAttempts.length > 0 && <button className="text-button" onClick={() => setMcFallback(true)}>Выбрать ответ</button>}
          </div>
        ) : !revealed ? (
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
            {!correct && <button className="replay-button" onClick={() => void playAnswer(snapshot)} aria-label="Повторить произношение">🔊 Ещё раз</button>}
            {audioError && <small className="audio-warning">Не удалось воспроизвести звук</small>}
            {correct
              ? <small>Следующее слово…</small>
              : <button className="next-button" disabled={busy} onClick={() => void next()}>Дальше</button>}
          </div>
        )}
      </section>
    </main>
  );
}
