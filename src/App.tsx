import { useEffect, useMemo, useState } from "react";
import { LearnerApp } from "./features/study/LearnerApp";
import { ParentApp } from "./features/parent/ParentApp";
import { GateChecklist } from "./features/diagnostics/GateChecklist";
import {
  SpeechTestCard,
  type SpeechDiagnostic,
} from "./features/diagnostics/SpeechTestCard";
import {
  readGateResults,
  readProbeSummary,
  savePersistenceProbe,
  type GateResult,
  type PersistenceProbe,
} from "./infrastructure/db/stage0Db";
import {
  getRecognitionConstructor,
  hasLocalRecognitionApi,
} from "./infrastructure/speech/recognition";
import { registerPwa } from "./pwa";
import { checkForPwaUpdate, type PwaState } from "./pwaUpdate";

type ProbeSummary = { count: number; last?: PersistenceProbe };

function formatTime(timestamp?: number) {
  if (!timestamp) return "нет меток";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "medium" }).format(timestamp);
}

function DiagnosticsApp({
  closeDiagnostics,
  pwa,
  applyUpdate,
}: {
  closeDiagnostics: () => void;
  pwa: PwaState;
  applyUpdate: ((reloadPage?: boolean) => Promise<void>) | null;
}) {
  const [online, setOnline] = useState(navigator.onLine);
  const [probe, setProbe] = useState<ProbeSummary>({ count: 0 });
  const [gateResults, setGateResults] = useState<GateResult[]>([]);
  const [speechDiagnostics, setSpeechDiagnostics] = useState<SpeechDiagnostic[]>([]);
  const [storagePersistent, setStoragePersistent] = useState<boolean | null>(null);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  const capabilities = useMemo(
    () => [
      { label: "HTTPS / secure context", value: window.isSecureContext },
      { label: "Запуск с домашнего экрана", value: standalone },
      { label: "Service Worker", value: "serviceWorker" in navigator },
      { label: "IndexedDB", value: "indexedDB" in window },
      { label: "SpeechRecognition", value: Boolean(getRecognitionConstructor()) },
      { label: "Локальные языковые пакеты", value: hasLocalRecognitionApi() },
      { label: "SpeechSynthesis", value: "speechSynthesis" in window },
    ],
    [standalone],
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    void Promise.all([readProbeSummary(), readGateResults()])
      .then(([summary, results]) => {
        setProbe(summary);
        setGateResults(results);
      })
      .catch((error: unknown) => setDbError(error instanceof Error ? error.message : String(error)));

    if (navigator.storage?.persisted) {
      void navigator.storage.persisted().then(setStoragePersistent).catch(() => setStoragePersistent(null));
    }

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const addProbe = async () => {
    try {
      setProbe(await savePersistenceProbe());
      setDbError(null);
    } catch (error) {
      setDbError(error instanceof Error ? error.message : String(error));
    }
  };

  const requestPersistence = async () => {
    if (!navigator.storage?.persist) {
      setStorageMessage("Этот браузер не предоставляет StorageManager.persist().");
      return;
    }
    try {
      const result = await navigator.storage.persist();
      setStoragePersistent(result);
      setStorageMessage(result ? "Постоянное хранение разрешено." : "Браузер не дал гарантию постоянного хранения.");
    } catch (error) {
      setStorageMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const updateGate = (result: GateResult) => {
    setGateResults((current) => [...current.filter((item) => item.id !== result.id), result]);
  };

  const addSpeechDiagnostic = (diagnostic: SpeechDiagnostic) => {
    setSpeechDiagnostics((current) => [...current, diagnostic]);
  };

  const exportReport = () => {
    const report = {
      format: "english-srs-stage0-diagnostic",
      exportedAt: new Date().toISOString(),
      appVersion: __APP_VERSION__,
      location: window.location.href,
      userAgent: navigator.userAgent,
      online,
      standalone,
      capabilities,
      pwa,
      storagePersistent,
      persistenceProbe: probe,
      gateResults,
      speechDiagnostics,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `english-srs-stage0-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main>
      <header className="hero">
        <div className="hero__mark" aria-hidden="true">···</div>
        <div>
          <p className="eyebrow">English Learning SRS · Stage 0</p>
          <h1>Проверка речи и офлайн-режима</h1>
          <p>
            Эта временная сборка проверяет самые рискованные части будущего тренажёра на реальном iPhone или
            iPad. Учебных карточек здесь пока нет.
          </p>
        </div>
      </header>

      <button className="button button--secondary" onClick={closeDiagnostics} type="button">← Вернуться к занятиям</button>

      <section className="status-strip" aria-label="Текущий статус">
        <div>
          <span className={`status-dot ${online ? "status-dot--online" : "status-dot--offline"}`} />
          {online ? "Сеть доступна" : "Авиарежим / без сети"}
        </div>
        <div>
          <span className={`status-dot ${pwa.offlineReady ? "status-dot--online" : ""}`} />
          {pwa.offlineReady ? "Кэш готов для офлайн" : "Кэш ещё готовится"}
        </div>
      </section>

      {pwa.needRefresh && (
        <aside className="notice">
          <span>Доступна новая версия.</span>
          <button className="text-button" onClick={() => void applyUpdate?.(true)} type="button">Обновить</button>
        </aside>
      )}
      {pwa.error && <aside className="notice notice--error">Service Worker: {pwa.error}</aside>}

      <section className="panel" aria-labelledby="capability-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Автопроверка</p>
            <h2 id="capability-heading">Возможности браузера</h2>
          </div>
          <span className="version">v{__APP_VERSION__}</span>
        </div>
        <div className="capability-grid">
          {capabilities.map((capability) => (
            <div className="capability" key={capability.label}>
              <span aria-hidden="true">{capability.value ? "✓" : "—"}</span>
              <div>
                <strong>{capability.label}</strong>
                <small>{capability.value ? "доступно" : "не обнаружено"}</small>
              </div>
            </div>
          ))}
        </div>
        {!standalone && (
          <p className="install-help">На iPhone откройте страницу в Safari: Поделиться → На экран «Домой».</p>
        )}
      </section>

      <section className="panel" aria-labelledby="speech-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Главный риск</p>
            <h2 id="speech-heading">Речь</h2>
          </div>
        </div>
        <p className="section-copy">
          Сначала проверьте онлайн, затем включите авиарежим и повторите. Микрофон запускается только явным нажатием.
        </p>
        <div className="speech-grid">
          <SpeechTestCard
            heading="Русский ответ"
            locale="ru-RU"
            onDiagnostic={addSpeechDiagnostic}
            recognitionPrompt="велосипед"
            ttsText="Велосипед"
          />
          <SpeechTestCard
            heading="English answer"
            locale="en-US"
            onDiagnostic={addSpeechDiagnostic}
            recognitionPrompt="daughter"
            ttsText="Daughter"
          />
        </div>
      </section>

      <section className="panel" aria-labelledby="persistence-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Локальные данные</p>
            <h2 id="persistence-heading">IndexedDB и хранилище</h2>
          </div>
          <span className="count-badge">{probe.count}</span>
        </div>
        <p className="section-copy">
          Создайте метку, полностью закройте приложение и проверьте, что время и счётчик остались. Позже повторите
          после перезагрузки устройства и новой версии приложения.
        </p>
        <div className="probe-card">
          <div>
            <span>Последняя метка</span>
            <strong>{formatTime(probe.last?.createdAt)}</strong>
            {probe.last && <small>Создана в {probe.last.appVersion}</small>}
          </div>
          <button className="button button--primary" onClick={() => void addProbe()} type="button">Сохранить метку</button>
        </div>
        {dbError && <p className="error-text">IndexedDB: {dbError}</p>}
        <div className="storage-row">
          <span>
            Постоянное хранение: {storagePersistent === null ? "неизвестно" : storagePersistent ? "да" : "не гарантировано"}
          </span>
          <button className="text-button" onClick={() => void requestPersistence()} type="button">Запросить</button>
        </div>
        {storageMessage && <p className="hint">{storageMessage}</p>}
      </section>

      <GateChecklist initialResults={gateResults} onChange={updateGate} onError={setDbError} />

      <section className="panel panel--actions" aria-label="Диагностический отчёт">
        <div>
          <h2>Отчёт</h2>
          <p className="section-copy">Скачайте JSON после проверки — в нём нет аудио, только результаты и расшифровки.</p>
        </div>
        <button className="button button--secondary" onClick={exportReport} type="button">Скачать отчёт</button>
      </section>

      <footer>
        <a href={`${import.meta.env.BASE_URL}legacy/math-trainer.html`}>Старый математический тренажёр</a>
      </footer>
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState(window.location.hash.slice(1) || "study");
  const [pwa, setPwa] = useState<PwaState>({ offlineReady: false, needRefresh: false });
  const [applyUpdate, setApplyUpdate] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    const syncRoute = () => setRoute(window.location.hash.slice(1) || "study");
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.ready.then(() => setPwa((current) => ({ ...current, offlineReady: true })));
    const updater = registerPwa({
      onOfflineReady: () => setPwa((current) => ({ ...current, offlineReady: true })),
      onNeedRefresh: () => setPwa((current) => ({ ...current, needRefresh: true })),
      onRegistrationError: (error) => setPwa((current) => ({ ...current, error: error.message })),
    });
    setApplyUpdate(() => updater);
  }, []);

  const openDiagnostics = () => { window.location.hash = "diagnostics"; };
  const openParent = () => { window.location.hash = "parent"; };
  const closeDiagnostics = () => { window.location.hash = "study"; };
  if (route === "diagnostics") {
    return <DiagnosticsApp closeDiagnostics={openParent} pwa={pwa} applyUpdate={applyUpdate} />;
  }
  if (route === "parent") {
    return (
      <ParentApp
        close={closeDiagnostics}
        openDiagnostics={openDiagnostics}
        pwa={pwa}
        checkForUpdate={checkForPwaUpdate}
        applyUpdate={applyUpdate}
      />
    );
  }
  return <LearnerApp openDiagnostics={openParent} />;
}

declare const __APP_VERSION__: string;
