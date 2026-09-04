import type { Direction } from "../../domain/curriculum/model";

export function StudyPrompt({ text, direction, audio, audioFailed, onReplay }: {
  text: string;
  direction: Direction;
  audio: boolean;
  audioFailed: boolean;
  onReplay: () => void;
}) {
  return (
    <div className="study-prompt">
      <p className="study-kicker">{direction === "en-ru" ? "Выбери перевод" : "Choose the translation"}</p>
      {audio && <button className="audio-prompt" onClick={onReplay}>🔊<span>Послушать ещё раз</span></button>}
      {(!audio || audioFailed) && <h1 lang={direction === "en-ru" ? "en" : "ru"}>{text}</h1>}
      {audio && audioFailed && <p className="audio-warning" role="status">Не удалось воспроизвести звук. Прочитай слово и ответь.</p>}
    </div>
  );
}
