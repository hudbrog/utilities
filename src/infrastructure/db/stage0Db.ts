import Dexie, { type EntityTable } from "dexie";

export type GateStatus = "untested" | "passed" | "failed";

export type GateResult = {
  id: string;
  status: GateStatus;
  updatedAt: number;
};

export type PersistenceProbe = {
  id: number;
  createdAt: number;
  appVersion: string;
};

class Stage0Database extends Dexie {
  probes!: EntityTable<PersistenceProbe, "id">;
  gateResults!: EntityTable<GateResult, "id">;

  constructor() {
    super("english-srs-stage0");
    this.version(1).stores({
      probes: "++id, createdAt",
      gateResults: "id, updatedAt",
    });
  }
}

const db = new Stage0Database();

export async function readProbeSummary() {
  const count = await db.probes.count();
  const last = await db.probes.orderBy("createdAt").last();
  return { count, last };
}

export async function savePersistenceProbe() {
  const createdAt = Date.now();
  await db.probes.add({ createdAt, appVersion: __APP_VERSION__ });
  return readProbeSummary();
}

export async function readGateResults() {
  return db.gateResults.toArray();
}

export async function saveGateResult(id: string, status: GateStatus) {
  await db.gateResults.put({ id, status, updatedAt: Date.now() });
}

declare const __APP_VERSION__: string;
