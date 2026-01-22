import type {
  DataCenterTopology,
  RackTelemetry,
  DeviceTopology,
  EventLogEntry,
  EventDomain,
  EventSeverity,
} from "./types";

type Sev = "ok" | "warn" | "crit" | "na";

function maxTempC(t: any): number | null {
  const vals = Object.values(t?.tempsC ?? {}).filter((x): x is number => x !== null);
  return vals.length ? Math.max(...vals) : null;
}

function thermalSev(t: any): Sev {
  const mx = maxTempC(t);
  if (mx === null) return "na";
  if (mx >= 95) return "crit";
  if (mx >= 85) return "warn";
  return "ok";
}

function airflowSev(t: any): Sev {
  const fans = Object.values(t?.fansRpm ?? {}).filter((x): x is number => x !== null);
  if (!fans.length) return "na";
  const mn = Math.min(...fans);
  if (mn < 700) return "crit";
  if (mn < 1200) return "warn";
  return "ok";
}

function powerSev(dev: DeviceTopology, t: any): Sev {
  const budget =
    dev.powerBudgetWatts ??
    (dev.type === "server" ? 650 : dev.type === "switch" ? 250 : 0);

  if (!t || budget <= 0) return "na";
  const pct = t.powerWatts / budget;
  if (pct >= 0.95) return "crit";
  if (pct >= 0.8) return "warn";
  return "ok";
}

function networkSev(t: any): Sev {
  const ports = Object.values(t?.ports ?? {});
  if (!ports.length) return "na";
  const anyDown = ports.some((p: any) => !p.linkUp);
  const err = ports.reduce((a: number, p: any) => a + p.rxErrors + p.txErrors + p.rxMissed, 0);
  if (anyDown) return "crit";
  if (err >= 10) return "crit";
  if (err > 0) return "warn";
  return "ok";
}

function storageSev(t: any): Sev {
  const drives = Object.values(t?.drives ?? {});
  if (!drives.length) return "na";
  const smartFail = drives.some((d: any) => !d.smartOk);
  if (smartFail) return "crit";
  const hot = drives.some((d: any) => (d.tempC ?? 0) >= 70);
  if (hot) return "warn";
  const veryFull = drives.some((d: any) => d.utilizationPct >= 90);
  if (veryFull) return "warn";
  return "ok";
}

function mkIncidentKey(domain: EventDomain, code: string, rackId: string, deviceId?: string, subId?: string) {
  return [domain, code, rackId, deviceId ?? "-", subId ?? "-"].join(":");
}

function mkId(ts: number, incidentKey: string) {
  return `${ts}:${incidentKey}`;
}

function openEvent(params: {
  ts: number;
  severity: Exclude<EventSeverity, "info">;
  domain: EventDomain;
  code: string;
  incidentKey: string;
  message: string;
  entity: EventLogEntry["entity"];
  meta?: Record<string, unknown>;
}): EventLogEntry {
  return {
    id: mkId(params.ts, params.incidentKey),
    ts: params.ts,
    severity: params.severity,
    domain: params.domain,
    code: params.code,
    incidentKey: params.incidentKey,
    message: params.message,
    entity: params.entity,
    meta: params.meta,
    state: "open",
  };
}

function resolvedEvent(params: {
  ts: number;
  domain: EventDomain;
  incidentKey: string;
  message: string;
  entity: EventLogEntry["entity"];
  meta?: Record<string, unknown>;
}): EventLogEntry {
  return {
    id: mkId(params.ts, params.incidentKey),
    ts: params.ts,
    severity: "info",
    domain: params.domain,
    code: "RESOLVED",
    incidentKey: params.incidentKey,
    message: params.message,
    entity: params.entity,
    meta: params.meta,
    state: "resolved",
    resolvedTs: params.ts,
  };
}

function shouldResolveDomainSev(n: Sev) {
  return n === "ok";
}


export function detectEvents(args: {
  dc: DataCenterTopology;
  prevTele: Record<string, RackTelemetry>;
  nextTele: Record<string, RackTelemetry>;
  openIncidents: Record<string, EventLogEntry>;
}): EventLogEntry[] {
  const { dc, prevTele, nextTele, openIncidents } = args;
  const now = Date.now();
  const out: EventLogEntry[] = [];

  const domains = [
    { domain: "thermal" as const, sevFn: thermalSev, warn: "THERMAL_WARN", crit: "THERMAL_CRIT" },
    { domain: "airflow" as const, sevFn: airflowSev, warn: "AIRFLOW_WARN", crit: "AIRFLOW_CRIT" },
    { domain: "power" as const, sevFn: powerSev, warn: "POWER_WARN", crit: "POWER_CRIT" },
    { domain: "network" as const, sevFn: networkSev, warn: "NETWORK_WARN", crit: "NETWORK_CRIT" },
    { domain: "storage" as const, sevFn: storageSev, warn: "STORAGE_WARN", crit: "STORAGE_CRIT" },
  ];

  for (const rack of dc.racks) {
    const prevRack = prevTele[rack.id];
    const nextRack = nextTele[rack.id];
    if (!nextRack) continue;

    for (const dev of rack.devices) {
      if (dev.type === "pdu") continue;

      const prevT = prevRack?.devices?.[dev.id];
      const nextT = nextRack?.devices?.[dev.id];

      // Domain incidents (thermal/airflow/power/network/storage)
      for (const d of domains) {
        const p = prevT ? d.sevFn(dev, prevT) : "na";
        const n = nextT ? d.sevFn(dev, nextT) : "na";

        // Open only on transition into warn/crit
        if ((p === "ok" || p === "na") && (n === "warn" || n === "crit")) {
          const code = n === "crit" ? d.crit : d.warn;
          const incidentKey = mkIncidentKey(d.domain, code, rack.id, dev.id);

          if (!openIncidents[incidentKey]) {
            out.push(
              openEvent({
                ts: now,
                severity: n,
                domain: d.domain,
                code,
                incidentKey,
                message: `${code} on ${rack.name} / ${dev.name}`,
                entity: { kind: "device", rackId: rack.id, deviceId: dev.id },
                meta: { prev: p, next: n },
              })
            );
          }
        }

        // Resolve if we had an open incident and now we are ok
        if ((p === "warn" || p === "crit") && n === "ok") {
          const keys = [
            mkIncidentKey(d.domain, d.crit, rack.id, dev.id),
            mkIncidentKey(d.domain, d.warn, rack.id, dev.id),
          ];

          for (const key of keys) {
            if (openIncidents[key]) {
              out.push(
                resolvedEvent({
                  ts: now,
                  domain: d.domain,
                  incidentKey: key,
                  message: `Resolved ${d.domain} on ${rack.name} / ${dev.name}`,
                  entity: { kind: "device", rackId: rack.id, deviceId: dev.id },
                  meta: { prev: p, next: n },
                })
              );
            }
          }
        }
        // Reconcile persisted open incidents (e.g., after page reload)
        // If an incident is open but the current telemetry is OK, resolve it even if there was no transition.
        if (shouldResolveDomainSev(n)) {
          const keys = [
            mkIncidentKey(d.domain, d.crit, rack.id, dev.id),
            mkIncidentKey(d.domain, d.warn, rack.id, dev.id),
          ];

          for (const key of keys) {
            if (openIncidents[key]) {
              out.push(
                resolvedEvent({
                  ts: now,
                  domain: d.domain,
                  incidentKey: key,
                  message: `Resolved ${d.domain} on ${rack.name} / ${dev.name}`,
                  entity: { kind: "device", rackId: rack.id, deviceId: dev.id },
                  meta: { prev: p, next: n, reconciled: true },
                })
              );
            }
          }
        }
      }

      // Port down/up transitions (more “failure-log” like)
      const prevPorts = prevT?.ports ?? {};
      const nextPorts = nextT?.ports ?? {};
      for (const portId of Object.keys(nextPorts)) {
        const wasUp = prevPorts[portId]?.linkUp;
        const isUp = nextPorts[portId]?.linkUp;

        const key = mkIncidentKey("network", "PORT_DOWN", rack.id, dev.id, portId);

        if (wasUp === true && isUp === false && !openIncidents[key]) {
          out.push(
            openEvent({
              ts: now,
              severity: "crit",
              domain: "network",
              code: "PORT_DOWN",
              incidentKey: key,
              message: `Port ${portId} DOWN on ${rack.name} / ${dev.name}`,
              entity: { kind: "port", rackId: rack.id, deviceId: dev.id, portId },
            })
          );
        }

        // Reconcile persisted PORT_DOWN after reload (wasUp may be undefined)
        if (wasUp !== false && isUp === true && openIncidents[key]) {
          out.push(
            resolvedEvent({
              ts: now,
              domain: "network",
              incidentKey: key,
              message: `Port ${portId} RECOVERED on ${rack.name} / ${dev.name}`,
              entity: { kind: "port", rackId: rack.id, deviceId: dev.id, portId },
              meta: { reconciled: true },
            })
          );
        }

      }

      // Drive SMART fail transition (crit)
      const prevDrives = prevT?.drives ?? {};
      const nextDrives = nextT?.drives ?? {};
      for (const driveId of Object.keys(nextDrives)) {
        const prevOk = prevDrives[driveId]?.smartOk;
        const nextOk = nextDrives[driveId]?.smartOk;

        const key = mkIncidentKey("storage", "DRIVE_SMART_FAIL", rack.id, dev.id, driveId);

        if (prevOk === true && nextOk === false && !openIncidents[key]) {
          out.push(
            openEvent({
              ts: now,
              severity: "crit",
              domain: "storage",
              code: "DRIVE_SMART_FAIL",
              incidentKey: key,
              message: `Drive ${driveId} SMART FAIL on ${rack.name} / ${dev.name}`,
              entity: { kind: "drive", rackId: rack.id, deviceId: dev.id, driveId },
            })
          );
        }

        // Reconcile persisted DRIVE_SMART_FAIL after reload (prevOk may be undefined)
        if (prevOk !== false && nextOk === true && openIncidents[key]) {
          out.push(
            resolvedEvent({
              ts: now,
              domain: "storage",
              incidentKey: key,
              message: `Drive ${driveId} SMART recovered on ${rack.name} / ${dev.name}`,
              entity: { kind: "drive", rackId: rack.id, deviceId: dev.id, driveId },
              meta: { reconciled: true },
            })
          );
        }
      }
    }
  }

  return out;
}
