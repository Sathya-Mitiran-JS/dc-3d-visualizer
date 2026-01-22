import { create } from "zustand";
import type {
  Overlay,
  Selection,
  CameraPreset,
  MetricKey,
  HistoryPoint,
  DataCenterTopology,
  RackTelemetry,
  RackTopology,
  EventLogEntry,        
} from "./types";
import { makeFakeDataCenterTopology, makeInitialTelemetryMap, stepTelemetry } from "./fakeData";
import { detectEvents } from "./eventDetection"; 
import { downloadTextFile } from "./logExport";



type History = Record<string, Partial<Record<MetricKey, HistoryPoint[]>>>;

type RackState = {
  dc: DataCenterTopology;
  telemetryByRack: Record<string, RackTelemetry>;

  overlay: Overlay;
  selection: Selection;

  cameraPreset: CameraPreset;
  cutaway: boolean;

  history: History;

  eventLog: EventLogEntry[];
  openIncidents: Record<string, EventLogEntry>;

  ackIncident: (incidentKey: string) => void;
  clearEventLog: () => void;

  exportEventLog: (opts?: {
    format?: "json" | "ndjson";
    scope?: "all" | "open" | "resolved";
  }) => void;


  setOverlay: (o: Overlay) => void;
  select: (sel: Selection) => void;

  setCameraPreset: (p: CameraPreset) => void;
  toggleCutaway: () => void;

  startSim: () => void;
  stopSim: () => void;

  
};

let handle: number | null = null;

const MAX_EVENTS = 2000;
const LS_KEY = "dc_event_log_v1";

function persistEvents(eventLog: EventLogEntry[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(eventLog.slice(-MAX_EVENTS)));
  } catch {}
}

function loadEvents(): EventLogEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as EventLogEntry[]) : [];
  } catch {
    return [];
  }
}

function rebuildOpenIncidents(eventLog: EventLogEntry[]) {
  const open: Record<string, EventLogEntry> = {};
  for (const e of eventLog) {
    if (e.state === "open") open[e.incidentKey] = e;
    else if (e.state === "resolved") delete open[e.incidentKey];
  }
  return open;
}

function applyEvents(
  prevLog: EventLogEntry[],
  prevOpen: Record<string, EventLogEntry>,
  events: EventLogEntry[]
) {
  if (!events.length) return { nextLog: prevLog, nextOpen: prevOpen };

  const nextLog = [...prevLog, ...events].slice(-MAX_EVENTS);
  const nextOpen = { ...prevOpen };

  for (const e of events) {
    if (e.state === "open") nextOpen[e.incidentKey] = e;
    else delete nextOpen[e.incidentKey];
  }

  if (typeof window !== "undefined") persistEvents(nextLog);
  return { nextLog, nextOpen };
}


const dc: DataCenterTopology = makeFakeDataCenterTopology();
const telemetryByRack0 = makeInitialTelemetryMap(dc);

function clampNonNeg(x: number) {
  return x < 0 ? 0 : x;
}

function entityKeyForDevice(rackId: string, devId: string) {
  return `dev:${rackId}:${devId}`;
}
function entityKeyForDrive(rackId: string, devId: string, driveId: string) {
  return `drive:${rackId}:${devId}:${driveId}`;
}
function entityKeyForPort(rackId: string, devId: string, portId: string) {
  return `port:${rackId}:${devId}:${portId}`;
}

function pushPoint(
  history: History,
  entity: string,
  metric: MetricKey,
  point: HistoryPoint,
  maxLen = 60
) {
  const prevEntity = history[entity] ?? {};
  const prevSeries = prevEntity[metric] ?? [];
  const nextSeries = [...prevSeries, point].slice(-maxLen);
  history[entity] = { ...prevEntity, [metric]: nextSeries };
}

function maxTempC(tempsC: Record<string, number | null>) {
  const vals = Object.values(tempsC).filter((x): x is number => x !== null);
  if (vals.length === 0) return null;
  return Math.max(...vals);
}

function avgRpm(fansRpm: Record<string, number | null>) {
  const vals = Object.values(fansRpm).filter((x): x is number => x !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function totalNetErr(dev: {
  ports: Record<string, { rxErrors: number; txErrors: number; rxMissed: number }>;
}) {
  return Object.values(dev.ports).reduce(
    (a, p) => a + p.rxErrors + p.txErrors + p.rxMissed,
    0
  );
}

function updateHistoryForRack(
  history: History,
  rack: RackTopology,
  prev: RackTelemetry,
  next: RackTelemetry
) {
  const ts = next.ts;

  for (const dev of rack.devices) {
    const prevDev = prev.devices[dev.id];
    const nextDev = next.devices[dev.id];
    if (!prevDev || !nextDev) continue;

    const mt = maxTempC(nextDev.tempsC);
    if (mt !== null) {
      pushPoint(history, entityKeyForDevice(rack.id, dev.id), "thermal.maxTempC", { ts, value: mt });
    }

    const ar = avgRpm(nextDev.fansRpm);
    if (ar !== null) {
      pushPoint(history, entityKeyForDevice(rack.id, dev.id), "airflow.avgRpm", { ts, value: ar });
    }

    pushPoint(history, entityKeyForDevice(rack.id, dev.id), "power.watts", { ts, value: nextDev.powerWatts });

    const prevErr = totalNetErr(prevDev);
    const nextErr = totalNetErr(nextDev);
    pushPoint(history, entityKeyForDevice(rack.id, dev.id), "network.errDelta", {
      ts,
      value: clampNonNeg(nextErr - prevErr),
    });

    for (const driveId of Object.keys(nextDev.drives)) {
      const d = nextDev.drives[driveId];
      if (d.tempC !== null) {
        pushPoint(history, entityKeyForDrive(rack.id, dev.id, driveId), "drive.tempC", {
          ts,
          value: d.tempC,
        });
      }
      pushPoint(history, entityKeyForDrive(rack.id, dev.id, driveId), "drive.utilPct", {
        ts,
        value: d.utilizationPct,
      });
    }

    for (const portId of Object.keys(nextDev.ports)) {
      const pPrev = prevDev.ports[portId];
      const pNext = nextDev.ports[portId];
      if (!pPrev || !pNext) continue;

      pushPoint(history, entityKeyForPort(rack.id, dev.id, portId), "port.rxPps", {
        ts,
        value: clampNonNeg(pNext.rxPackets - pPrev.rxPackets),
      });
      pushPoint(history, entityKeyForPort(rack.id, dev.id, portId), "port.txPps", {
        ts,
        value: clampNonNeg(pNext.txPackets - pPrev.txPackets),
      });

      const prevE = pPrev.rxErrors + pPrev.txErrors + pPrev.rxMissed;
      const nextE = pNext.rxErrors + pNext.txErrors + pNext.rxMissed;
      pushPoint(history, entityKeyForPort(rack.id, dev.id, portId), "port.errDelta", {
        ts,
        value: clampNonNeg(nextE - prevE),
      });
    }
  }
}

const initialEventLog: EventLogEntry[] =
  typeof window !== "undefined" ? loadEvents() : [];
const initialOpenIncidents = rebuildOpenIncidents(initialEventLog);


export const useRackStore = create<RackState>((set, get) => ({

  eventLog: initialEventLog,
  openIncidents: initialOpenIncidents,

  ackIncident: (incidentKey) =>
    set((s) => {
      const inc = s.openIncidents[incidentKey];
      if (!inc || inc.ackTs) return s;

      const now = Date.now();
      const updated: EventLogEntry = { ...inc, ackTs: now };

      const nextOpen = { ...s.openIncidents, [incidentKey]: updated };
      const nextLog = s.eventLog.map((e) =>
        e.incidentKey === incidentKey && e.state === "open" ? updated : e
      );

      if (typeof window !== "undefined") persistEvents(nextLog);
      return { openIncidents: nextOpen, eventLog: nextLog };
    }),

  clearEventLog: () =>
    set(() => {
      if (typeof window !== "undefined") persistEvents([]);
      return { eventLog: [], openIncidents: {} };
    }),

  exportEventLog: (opts) => {
    const { format = "ndjson", scope = "all" } = opts ?? {};

    const { eventLog, openIncidents } = get();

    // IMPORTANT:
    // - "open" must come from openIncidents (current truth)
    // - "resolved" / "all" can come from eventLog (append-only history)
    const scoped =
      scope === "open"
        ? Object.values(openIncidents)
        : scope === "resolved"
          ? eventLog.filter((e) => e.state === "resolved")
          : eventLog;

    // Optional but useful: stable order
    scoped.sort((a, b) => a.ts - b.ts);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `dc-eventlog-${scope}-${stamp}.${format === "json" ? "json" : "ndjson"}`;

    if (format === "json") {
      downloadTextFile(filename, JSON.stringify(scoped, null, 2), "application/json");
      return;
    }

    const ndjson = scoped.map((e) => JSON.stringify(e)).join("\n") + "\n";
    downloadTextFile(filename, ndjson, "application/x-ndjson");
  },




  dc,
  telemetryByRack: telemetryByRack0,

  overlay: "thermal",
  selection: { kind: "datacenter" },

  cameraPreset: "iso",
  cutaway: false,

  history: {},

  setOverlay: (o) => set({ overlay: o }),
  select: (sel) => set({ selection: sel }),

  setCameraPreset: (p) => set({ cameraPreset: p }),
  toggleCutaway: () => set((s) => ({ cutaway: !s.cutaway })),

  startSim: () => {
    if (handle !== null) return;

    // One-time reconcile persisted open incidents against current telemetry (no waiting 1s)
    set((state) => {
      const events = detectEvents({
        dc: state.dc,
        prevTele: state.telemetryByRack,
        nextTele: state.telemetryByRack, // same snapshot; reconciliation logic will still resolve stale opens
        openIncidents: state.openIncidents,
      });

      const { nextLog, nextOpen } = applyEvents(state.eventLog, state.openIncidents, events);
      return { eventLog: nextLog, openIncidents: nextOpen };
    });


    handle = window.setInterval(() => {
      set((state) => {
        const prevTelemetryByRack = state.telemetryByRack;

        const nextTelemetryByRack: Record<string, RackTelemetry> = { ...prevTelemetryByRack };
        const nextHistory: History = { ...state.history };

        for (const rack of state.dc.racks) {
          const prev = prevTelemetryByRack[rack.id];
          if (!prev) continue;

          const next = stepTelemetry(rack, prev);
          nextTelemetryByRack[rack.id] = next;

          updateHistoryForRack(nextHistory, rack, prev, next);
        }

        // NEW: compute events from prev -> next, dedupe via openIncidents
        const events = detectEvents({
          dc: state.dc,
          prevTele: prevTelemetryByRack,
          nextTele: nextTelemetryByRack,
          openIncidents: state.openIncidents,
        });

        const { nextLog, nextOpen } = applyEvents(state.eventLog, state.openIncidents, events);

        return {
          telemetryByRack: nextTelemetryByRack,
          history: nextHistory,

          // NEW:
          eventLog: nextLog,
          openIncidents: nextOpen,
        };
      });

    }, 1000);
  },

  stopSim: () => {
    if (handle === null) return;
    window.clearInterval(handle);
    handle = null;
  },
}));
