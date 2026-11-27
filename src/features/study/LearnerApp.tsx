import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { buildMultipleChoiceOptions, type MultipleChoiceOption } from "../../domain/exercises/distractors";
import { cancelSpeech, prepareSpeechSynthesis, speak, type SpeechSource } from "../../infrastructure/speech/synthesis";
import { WordAudioButton } from "../WordAudioButton";
import { isAcceptedAnswer } from "../../domain/exercises/matching";
import { RecognitionError } from "../../infrastructure/speech/recognition";
import { StudyPrompt } from "./StudyPrompt";
import { useSpeechRecognition } from "../useSpeechRecognition";
import {
  flagPronunciation,
  goToNextQuestion,
  distractorCurriculum,
  introducedConceptIds,
  loadStudy,
  requestWordChoices,
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
  const [promptAudioError, setPromptAudioError] = useState<"tap" | "failed" | null>(null);
  const [promptPlaying, setPromptPlaying] = useState(false);
  const [pendingAudio, setPendingAudio] = useState(0);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(() => new Set());
  const [flagError, setFlagError] = useState(false);
  const [wrongEnglishChoice, setWrongEnglishChoice] = useState<string | null>(null);
  const [sttAttempts, setSttAttempts] = useState<string[][]>([]);
  const [sttMessage, setSttMessage] = useState<string | null>(null);
  const [mcFallback, setMcFallback] = useState(false);
  const [requestingChoices, setRequestingChoices] = useState(false);
  const recognition = useSpeechRecognition();
  const actionInFlight = useRef(false);
  const inputLockedUntil = useRef(0);
  const currentQuestionId = useRef<string | undefined>(undefined);
  const promptPlaybackId = useRef(0);

  const replaceSnapshot = useCallback(async (snapshot: StudySnapshot) => {
    setSelectedId(null);
    setWrongEnglishChoice(null);
    setAudioError(false);
    setPromptAudioError(null);
    setPromptPlaying(false);
    promptPlaybackId.current += 1;
    currentQuestionId.current = snapshot.current?.id;
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

  const playEnglish = useCallback(async (english: string, source: SpeechSource) => {
    setPendingAudio((count) => count + 1);
    try {
      await speak(english, "en-US", { source, onStarted: () => {
        setLastHeard(english);
        setFlagError(false);
      } });
    } finally {
      setPendingAudio((count) => count - 1);
    }
  }, []);

  const playPrompt = useCallback(async (snapshot: StudySnapshot) => {
    const question = snapshot.current;
    if (question?.direction !== "en-ru" || !snapshot.concept) return;
    const playbackId = ++promptPlaybackId.current;
    setPromptPlaying(true);
    setPromptAudioError(null);
    try {
      await playEnglish(snapshot.concept.en, "prompt");
    } catch (error) {
      if (currentQuestionId.current === question.id && promptPlaybackId.current === playbackId) {
        setPromptAudioError(messageFor(error) === "english-audio-needs-tap" ? "tap" : "failed");
      }
    } finally {
      if (currentQuestionId.current === question.id && promptPlaybackId.current === playbackId) setPromptPlaying(false);
    }
  }, [playEnglish]);

  useEffect(() => {
    prepareSpeechSynthesis();
    return () => {
      currentQuestionId.current = undefined;
      promptPlaybackId.current += 1;
      cancelSpeech();
    };
  }, []);

  useEffect(() => {
    void loadStudy()
      .then((snapshot) => snapshot.current?.status === "revealed" && snapshot.current.revealedOutcome === "correct"
        ? goToNextQuestion(snapshot)
        : snapshot)
      .then(replaceSnapshot)
      .catch((error: unknown) => setView({ status: "error", message: messageFor(error) }));
  }, [replaceSnapshot]);

  const englishPromptId = view.status === "ready" && view.snapshot.current?.status === "current" &&
    view.snapshot.current.direction === "en-ru" ? view.snapshot.current.id : null;
  const playCurrentPrompt = useEffectEvent(() => {
    if (view.status === "ready") void playPrompt(view.snapshot);
  });
  useEffect(() => {
    if (englishPromptId) playCurrentPrompt();
  }, [englishPromptId]);

  const progress = useMemo(() => {
    if (view.status !== "ready") return { completed: 0, total: 0, mistakes: 0 };
    return {
      completed: view.snapshot.questions.filter(({ status }) => status === "completed").length,
      total: view.snapshot.questions.length,
      mistakes: view.snapshot.questions.filter(({ revealedOutcome }) => revealedOutcome === "incorrect").length,
    };
  }, [view]);

  const playWord = (english: string, source: "answer" | "replay") => {
    const questionId = currentQuestionId.current;
    if (source === "replay") cancelSpeech();
    setAudioError(false);
    void playEnglish(english, source).catch(() => {
      if (currentQuestionId.current === questionId) setAudioError(true);
    });
  };

  const showScoredAnswer = async (scored: StudySnapshot, selectedEnglish?: string) => {
    if (!scored.concept) return;
    const correct = scored.current?.revealedOutcome === "correct";
    setLastAnswer(scored.concept.en);
    await replaceSnapshot(scored);
    if (!correct && selectedEnglish) setWrongEnglishChoice(selectedEnglish);
    playWord(selectedEnglish ?? scored.concept.en, "answer");
    if (correct) {
      await delay(CORRECT_FEEDBACK_MS);
      await replaceSnapshot(await goToNextQuestion(scored));
    }
  };

  const flagLastHeard = async () => {
    if (!lastHeard) return;
    const word = lastHeard;
    try {
      await flagPronunciation(word);
      setFlagged((words) => new Set(words).add(word.trim().toLowerCase()));
      setFlagError(false);
    } catch {
      setFlagError(true);
    }
  };

  const showWordChoices = async () => {
    if (view.status !== "ready" || !view.snapshot.current || requestingChoices ||
        performance.now() < inputLockedUntil.current) return;
    if (actionInFlight.current && !recognition.cancel()) return;
    const questionId = view.snapshot.current.id;
    setRequestingChoices(true);
    try {
      const question = await requestWordChoices(questionId);
      inputLockedUntil.current = performance.now() + TRANSITION_DEBOUNCE_MS;
      setView((current) => {
        if (current.status !== "ready" || current.snapshot.current?.id !== questionId) return current;
        return { ...current, snapshot: { ...current.snapshot, current: question,
          questions: current.snapshot.questions.map((item) => item.id === questionId ? question : item) } };
      });
    } catch (error) {
      setSttMessage(messageFor(error));
    } finally {
      setRequestingChoices(false);
    }
  };

  const choose = async (option: MultipleChoiceOption) => {
    if (view.status !== "ready" || view.snapshot.current?.status !== "current" || !beginAction()) return;
    const englishChoice = view.snapshot.current.direction === "ru-en";
    if (englishChoice) cancelSpeech();
    setSelectedId(option.conceptId);
    try {
      await showScoredAnswer(await scoreAnswer(view.snapshot, option.correct, {
        completionMode: "multiple-choice",
        ...(sttAttempts.length ? { sttAttemptCount: sttAttempts.length, sttTranscripts: sttAttempts } : {}),
      }), englishChoice ? option.text : undefined);
    } catch (error) {
      setView({ status: "error", message: messageFor(error) });
    } finally {
      endAction();
    }
  };

  const listen = async () => {
    if (view.status !== "ready" || !view.snapshot.current || !view.snapshot.concept || pendingAudio > 0 || !beginAction()) return;
    setSttMessage(null);
    try {
      const locale = view.snapshot.current.direction === "en-ru" ? "ru-RU" : "en-US";
      const result = await recognition.listen(locale, { localOnly: false });
      setSttMessage("Проверяю ответ…");
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
      if (code === "aborted") return;
      if (code === "no-result" || code === "no-speech") {
        setSttMessage("Ничего не услышала. Нажми на микрофон и попробуй ещё раз.");
        return;
      }
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
  const revealed = snapshot.current?.status === "revealed";
  const englishPrompt = snapshot.current?.direction === "en-ru";
  const audioPrompt = englishPrompt && Boolean(snapshot.current?.exerciseType.endsWith("audio"));
  const speechQuestion = snapshot.current?.exerciseType.startsWith("stt_") && !mcFallback;
  const showHeardWord = revealed || snapshot.completed || (englishPrompt ? !audioPrompt : !speechQuestion);
  const recording = recognition.phase !== "idle";
  const alreadyFlagged = lastHeard !== null && flagged.has(lastHeard.trim().toLowerCase());
  const audioTools = (lastHeard || lastAnswer) && (
    <footer className="study-audio-tools">
      {!revealed && lastAnswer && (
        <button type="button" disabled={recording} onClick={() => playWord(lastAnswer, "replay")}>
          <span aria-hidden="true">↻</span> Предыдущее слово
        </button>
      )}
      {lastHeard && <button type="button" disabled={alreadyFlagged} onClick={() => void flagLastHeard()}
        title="Отметить последнее прослушанное слово для проверки взрослым">
        <span aria-hidden="true">{alreadyFlagged ? "✓" : "⚑"}</span> {alreadyFlagged ? "Звук отмечен" : "Отметить звук"}
        {showHeardWord && <> «<span lang="en">{lastHeard}</span>»</>}
      </button>}
      {flagError && <small role="alert">Не удалось сохранить отметку. Попробуйте ещё раз.</small>}
    </footer>
  );
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
          {audioTools}
          {audioError && <small className="audio-warning" role="status">Не удалось воспроизвести звук</small>}
          <button className={needsCurriculum ? "button button--primary" : "text-button diagnostics-link"} onClick={openDiagnostics}>{needsCurriculum ? "Открыть раздел для взрослого" : "Диагностика для взрослого"}</button>
        </section>
      </main>
    );
  }

  const correct = snapshot.current?.revealedOutcome === "correct";
  const currentNumber = Math.min(progress.completed + 1, progress.total);
  const canStopListening = recognition.phase === "starting" || recognition.phase === "listening";
  const recognitionMessage = {
    idle: sttMessage ?? "Нажми и скажи перевод",
    starting: "Включаю микрофон…",
    listening: "Слушаю… Закончил? Нажми «Готово».",
    processing: "Обрабатываю… Микрофон уже выключен.",
  }[recognition.phase];
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

        <StudyPrompt text={promptText(snapshot)} direction={snapshot.current!.direction}
          audio={audioPrompt} audioFailed={promptAudioError === "failed"} needsTap={promptAudioError === "tap"}
          disabled={recording} onReplay={() => { cancelSpeech(); void playPrompt(snapshot); }} />
        {!audioPrompt && promptAudioError === "failed" && <small className="audio-warning" role="status">Не удалось воспроизвести звук</small>}

        {!revealed && speechQuestion ? (
          <div className="speech-answer">
            <button className={canStopListening ? "microphone-button microphone-button--active" : "microphone-button"}
              disabled={requestingChoices || ((busy || pendingAudio > 0) && !canStopListening)} onClick={canStopListening ? recognition.stop : () => void listen()}
              aria-label={canStopListening ? "Закончить ответ" : "Ответить голосом"} aria-pressed={canStopListening}>
              <span aria-hidden="true">{canStopListening ? "■" : recognition.phase === "processing" ? "…" : "🎙"}</span>
              <span className="microphone-button__label">{canStopListening ? "Готово" : recognition.phase === "processing" ? "Жду ответ" : "Ответить"}</span>
            </button>
            <p aria-live="polite">{recognitionMessage}</p>
            <small>Попытка {Math.min(sttAttempts.length + 1, 3)} из 3</small>
            <button type="button" className="text-button" disabled={requestingChoices || (busy && recognition.phase === "idle")}
              onClick={() => void showWordChoices()}>Не помню</button>
            {sttAttempts.length > 0 && <button className="text-button" disabled={busy || requestingChoices}
              onClick={() => setMcFallback(true)}>Выбрать ответ</button>}
          </div>
        ) : !revealed ? (
          <div className="choice-list">
            {options.map((option) => (
              <div className={englishPrompt ? "choice-row" : "choice-row choice-row--audio"} key={option.conceptId}>
                <button type="button" className={`choice ${selectedId === option.conceptId ? "choice--selected" : ""}`}
                  disabled={busy || (audioPrompt && promptPlaying)} onClick={() => void choose(option)}>
                  {option.text}
                </button>
                {!englishPrompt && <WordAudioButton english={option.text} disabled={busy} play={(word) => playWord(word, "replay")} />}
              </div>
            ))}
          </div>
        ) : (
          <div className="reveal" aria-live="polite">
            {wrongEnglishChoice && <p className="selected-answer">Твой ответ — <strong lang="en">{wrongEnglishChoice}</strong></p>}
            <div className="reveal__result">
              <span className="reveal__icon" aria-hidden="true">{correct ? "✓" : "→"}</span>
              <div>
                <p>{correct ? "Правильно!" : "Правильный ответ"}</p>
                <strong>{answerText(snapshot)}</strong>
              </div>
            </div>
            <button type="button" className="replay-button" onClick={() => playWord(snapshot.concept!.en, "replay")}
              aria-label={`Послушать: ${snapshot.concept!.en}`}>🔊 {wrongEnglishChoice ? "Послушать правильный ответ" : "Ещё раз"}</button>
            {correct
              ? <small>Следующее слово…</small>
              : <button className="next-button" disabled={busy} onClick={() => void next()}>Дальше</button>}
          </div>
        )}
        {audioError && <small className="audio-warning" role="status">Не удалось воспроизвести звук</small>}
        {audioTools}
      </section>
    </main>
  );
}
