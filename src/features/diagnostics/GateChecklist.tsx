import { useEffect, useState } from "react";
import {
  saveGateResult,
  type GateResult,
  type GateStatus,
} from "../../infrastructure/db/stage0Db";

export const PHYSICAL_GATES = [
  { id: "stt-standalone", label: "STT API доступен после запуска с домашнего экрана" },
  { id: "stt-ru-offline", label: "Русская речь распознаётся в авиарежиме" },
  { id: "stt-en-offline", label: "Английская речь распознаётся в авиарежиме" },
  { id: "microphone-relaunch", label: "Разрешение микрофона переживает обычный перезапуск" },
  { id: "tts-offline", label: "Русский и английский TTS работают в авиарежиме" },
  { id: "idb-relaunch", label: "Метка IndexedDB переживает закрытие приложения" },
  { id: "idb-reboot", label: "Метка IndexedDB переживает перезагрузку устройства" },
  { id: "idb-release", label: "Метка IndexedDB переживает новую статическую версию" },
  { id: "offline-cold-launch", label: "Приложение запускается с нуля в авиарежиме" },
] as const;

type Props = {
  initialResults: GateResult[];
  onChange: (result: GateResult) => void;
  onError: (message: string) => void;
};

const statuses: Array<{ value: GateStatus; label: string }> = [
  { value: "passed", label: "Да" },
  { value: "failed", label: "Нет" },
  { value: "untested", label: "Сброс" },
];

export function GateChecklist({ initialResults, onChange, onError }: Props) {
  const [results, setResults] = useState<Record<string, GateStatus>>({});

  useEffect(() => {
    setResults(Object.fromEntries(initialResults.map((result) => [result.id, result.status])));
  }, [initialResults]);

  const update = async (id: string, status: GateStatus) => {
    try {
      await saveGateResult(id, status);
      setResults((current) => ({ ...current, [id]: status }));
      onChange({ id, status, updatedAt: Date.now() });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="panel" aria-labelledby="gate-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Release gate</p>
          <h2 id="gate-heading">Проверка на iPhone / iPad</h2>
        </div>
        <span className="count-badge">
          {Object.values(results).filter((status) => status === "passed").length}/{PHYSICAL_GATES.length}
        </span>
      </div>
      <p className="section-copy">
        Установите приложение через Safari, затем последовательно отметьте проверки. Результаты сохраняются
        только на этом устройстве.
      </p>
      <div className="gate-list">
        {PHYSICAL_GATES.map((gate) => {
          const current = results[gate.id] ?? "untested";
          return (
            <div className={`gate gate--${current}`} key={gate.id}>
              <span className="gate-label">{gate.label}</span>
              <div className="segmented" aria-label={gate.label}>
                {statuses.map((status) => (
                  <button
                    className={`segment segment--${status.value}`}
                    aria-pressed={current === status.value}
                    key={status.value}
                    onClick={() => void update(gate.id, status.value)}
                    type="button"
                  >
                    {status.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
