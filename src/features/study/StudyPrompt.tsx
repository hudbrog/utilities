import { WordAudioButton } from "../WordAudioButton";
import type { Direction } from "../../domain/curriculum/model";

export function StudyPrompt({ text, direction, audio, audioFailed, needsTap, disabled, onReplay }: {
  text: string;
  direction: Direction;
  audio: boolean;
  audioFailed: boolean;
  needsTap?: boolean;
  disabled?: boolean;
  onReplay: () => void;
}) {
  return (
    <div className="study-prompt">
      <p className="study-kicker">{direction === "en-ru" ? "Выбери перевод" : "Choose the translation"}</p>
      {audio && <button type="button" className="audio-prompt" disabled={disabled} onClick={onReplay}>🔊<span>{needsTap ? "Послушать слово" : "Послушать ещё раз"}</span></button>}
      {(!audio || audioFailed) && <h1 lang={direction === "en-ru" ? "en" : "ru"}>{text}</h1>}
      {!audio && direction === "en-ru" && <WordAudioButton english={text} play={onReplay} disabled={disabled} />}
      {audio && audioFailed && <p className="audio-warning" role="status">Не удалось воспроизвести звук. Прочитай слово и ответь.</p>}
    </div>
  );
}
