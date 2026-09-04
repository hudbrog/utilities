import { useState } from "react";
import {
  checkLocalAvailability,
  getRecognitionConstructor,
  hasLocalRecognitionApi,
  installLocalLanguage,
  RecognitionError,
  type RecognitionAlternative,
  type SpeechLocale,
} from "../../infrastructure/speech/recognition";
import { speak } from "../../infrastructure/speech/synthesis";
import { useSpeechRecognition } from "../useSpeechRecognition";

export type SpeechDiagnostic = {
  locale: SpeechLocale;
  occurredAt: string;
  alternatives?: RecognitionAlternative[];
  error?: string;
  localOnlyApplied?: boolean;
  ttsVoice?: { name: string; lang: string; localService: boolean } | null;
};

type Props = {
  locale: SpeechLocale;
  heading: string;
  recognitionPrompt: string;
  ttsText: string;
  onDiagnostic: (diagnostic: SpeechDiagnostic) => void;
};

const errorLabels: Record<string, string> = {
  "not-supported": "SpeechRecognition отсутствует",
  "not-allowed": "Нет разрешения на микрофон",
  "service-not-allowed": "Сервис распознавания запрещён",
  "audio-capture": "Микрофон недоступен",
  "language-not-supported": "Языковой пакет не поддерживается",
  network: "Распознаватель запросил сеть",
  "no-speech": "Речь не обнаружена",
  "no-result": "Финальных вариантов не получено",
  aborted: "Распознавание отменено",
  timeout: "Истекло время ожидания",
};

export function SpeechTestCard({ locale, heading, recognitionPrompt, ttsText, onDiagnostic }: Props) {
  const localApi = hasLocalRecognitionApi();
  const recognition = useSpeechRecognition();
  const listening = recognition.phase !== "idle";
  const canStopListening = recognition.phase === "starting" || recognition.phase === "listening";
  const [localOnly, setLocalOnly] = useState(localApi);
  const [alternatives, setAlternatives] = useState<RecognitionAlternative[]>([]);
  const [message, setMessage] = useState("Ещё не проверено");
  const [availability, setAvailability] = useState<string | null>(null);
  const [voice, setVoice] = useState<string | null>(null);

  const testRecognition = async () => {
    setAlternatives([]);
    setMessage("Слушаю…");
    try {
      const outcome = await recognition.listen(locale, { localOnly });
      setAlternatives(outcome.alternatives);
      setMessage(outcome.localOnlyApplied ? "Получен локальный результат" : "Получен результат");
      onDiagnostic({
        locale,
        occurredAt: new Date().toISOString(),
        alternatives: outcome.alternatives,
        localOnlyApplied: outcome.localOnlyApplied,
      });
    } catch (error) {
      const code = error instanceof RecognitionError ? error.code : "start-error";
      if (code === "aborted") return;
      const label = errorLabels[code] ?? (error instanceof Error ? error.message : String(error));
      setMessage(label);
      onDiagnostic({ locale, occurredAt: new Date().toISOString(), error: code });
    }
  };

  const testTts = async () => {
    setMessage("Говорю…");
    try {
      const selectedVoice = await speak(ttsText, locale);
      const voiceLabel = selectedVoice
        ? `${selectedVoice.name} · ${selectedVoice.lang}${selectedVoice.localService ? " · локальный" : ""}`
        : "голос выбран браузером";
      setVoice(voiceLabel);
      setMessage("TTS завершён");
      onDiagnostic({ locale, occurredAt: new Date().toISOString(), ttsVoice: selectedVoice });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const checkPack = async () => {
    try {
      const result = await checkLocalAvailability(locale);
      setAvailability(result ?? "API проверки отсутствует");
    } catch (error) {
      setAvailability(error instanceof Error ? error.message : String(error));
    }
  };

  const installPack = async () => {
    try {
      const result = await installLocalLanguage(locale);
      setAvailability(result === null ? "API установки отсутствует" : result ? "Установлен" : "Не установлен");
    } catch (error) {
      setAvailability(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <article className="speech-card">
      <div className="speech-card__header">
        <div>
          <p className="locale">{locale}</p>
          <h3>{heading}</h3>
        </div>
        <span className={`listening-dot${canStopListening ? " listening-dot--active" : ""}`} aria-hidden="true" />
      </div>

      <p className="test-phrase">
        Скажите: <strong>«{recognitionPrompt}»</strong>
      </p>

      {localApi ? (
        <label className="toggle-row">
          <input checked={localOnly} disabled={listening} onChange={(event) => setLocalOnly(event.target.checked)} type="checkbox" />
          Требовать локальное распознавание
        </label>
      ) : (
        <p className="hint">API языковых пакетов нет: офлайн проверяется вручную в авиарежиме.</p>
      )}

      <div className="button-row">
        <button className="button button--primary" disabled={!getRecognitionConstructor() || recognition.phase === "processing"}
          onClick={canStopListening ? recognition.stop : () => void testRecognition()} type="button">
          {canStopListening ? "■ Готово" : recognition.phase === "processing" ? "Обрабатываю…" : "🎙 Проверить STT"}
        </button>
        <button className="button button--secondary" disabled={listening} onClick={() => void testTts()} type="button">
          🔊 Проверить TTS
        </button>
      </div>

      {localApi && (
        <div className="button-row button-row--compact">
          <button className="text-button" onClick={() => void checkPack()} type="button">Проверить пакет</button>
          <button className="text-button" onClick={() => void installPack()} type="button">Установить пакет</button>
        </div>
      )}

      <div className="speech-result" aria-live="polite">
        <strong>{recognition.phase === "starting" ? "Включаю микрофон…"
          : recognition.phase === "listening" ? "Слушаю… Нажмите «Готово», когда закончите."
          : recognition.phase === "processing" ? "Обрабатываю… Микрофон уже выключен." : message}</strong>
        {availability && <span>Локальный пакет: {availability}</span>}
        {voice && <span>Голос: {voice}</span>}
        {alternatives.length > 0 && (
          <ol>
            {alternatives.map((alternative) => (
              <li key={`${alternative.transcript}-${alternative.confidence}`}>
                {alternative.transcript}
                {alternative.confidence > 0 && <small>{Math.round(alternative.confidence * 100)}%</small>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  );
}
