export type PwaState = {
  offlineReady: boolean;
  needRefresh: boolean;
  error?: string;
};

export type PwaUpdateCheckResult = "available" | "current" | "offline" | "unsupported" | "unregistered";

function waitForInstallation(registration: ServiceWorkerRegistration): Promise<boolean> {
  if (registration.waiting) return Promise.resolve(true);
  const worker = registration.installing;
  if (!worker) return Promise.resolve(false);
  if (worker.state === "installed") return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(Boolean(registration.waiting)), 15_000);
    worker.addEventListener("statechange", () => {
      if (worker.state !== "installed" && worker.state !== "redundant") return;
      window.clearTimeout(timeout);
      resolve(worker.state === "installed" || Boolean(registration.waiting));
    }, { once: true });
  });
}

export async function checkForPwaUpdate(): Promise<PwaUpdateCheckResult> {
  if (!("serviceWorker" in navigator)) return "unsupported";
  if (!navigator.onLine) return "offline";
  const scope = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  const registration = await navigator.serviceWorker.getRegistration(scope);
  if (!registration) return "unregistered";
  await registration.update();
  return await waitForInstallation(registration) ? "available" : "current";
}
