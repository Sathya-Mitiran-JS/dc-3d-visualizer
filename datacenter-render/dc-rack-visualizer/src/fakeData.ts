import type {
  DataCenterTopology,
  RackTopology,
  RackTelemetry,
  DeviceTelemetry,
  DeviceTopology,
} from "./types";
import { clamp, mulberry32 } from "./utils";

const SEED = 1337;
const rand = mulberry32(SEED);

function rackDevicesTemplate(): DeviceTopology[] {
  return [
    {
      id: "tor-1",
      name: "ToR Switch",
      type: "switch",
      uStart: 41,
      uSize: 1,
      powerBudgetWatts: 250,
      ports: Array.from({ length: 8 }).map((_, i) => ({
        id: `p${i + 1}`,
        label: `swp${i + 1}`,
      })),
    },
    {
      id: "srv-1",
      name: "Compute-01",
      type: "server",
      uStart: 33,
      uSize: 2,
      powerBudgetWatts: 650,
      drives: [
        { id: "nvme1", slot: "NVMe1" },
        { id: "sda", slot: "sda" },
        { id: "sdc", slot: "sdc" },
      ],
      ports: [
        { id: "ens20f0", label: "ens20f0" },
        { id: "enp9s0u2u4u4", label: "enp9s0u2u4u4" },
      ],
    },
    {
      id: "srv-2",
      name: "Compute-02",
      type: "server",
      uStart: 27,
      uSize: 2,
      powerBudgetWatts: 650,
      drives: [
        { id: "nvme1", slot: "NVMe1" },
        { id: "sda", slot: "sda" },
      ],
      ports: [
        { id: "ens20f0", label: "ens20f0" },
        { id: "ens20f1", label: "ens20f1" },
      ],
    },
    {
      id: "srv-3",
      name: "Compute-03",
      type: "server",
      uStart: 21,
      uSize: 2,
      powerBudgetWatts: 650,
      drives: [
        { id: "nvme1", slot: "NVMe1" },
        { id: "sda", slot: "sda" },
      ],
      ports: [
        { id: "ens20f0", label: "ens20f0" },
        { id: "ens20f1", label: "ens20f1" },
      ],
    },
    {
      id: "srv-4",
      name: "Compute-04",
      type: "server",
      uStart: 15,
      uSize: 2,
      powerBudgetWatts: 650,
      drives: [
        { id: "nvme1", slot: "NVMe1" },
        { id: "sda", slot: "sda" },
      ],
      ports: [
        { id: "ens20f0", label: "ens20f0" },
        { id: "enp9s0u2u4u4", label: "enp9s0u2u4u4" },
      ],
    },

    {
      id: "pdu-1",
      name: "PDU Left",
      type: "pdu",
      uStart: 1,
      uSize: 42,
      powerBudgetWatts: 6000,
    },
  ];
}

// Deep-ish clone so each rack gets its own arrays/objects (IDs can repeat safely because selection includes rackId)
function cloneDevices(devs: DeviceTopology[]): DeviceTopology[] {
  return devs.map((d) => ({
    ...d,
    drives: d.drives ? d.drives.map((x) => ({ ...x })) : undefined,
    ports: d.ports ? d.ports.map((x) => ({ ...x })) : undefined,
  }));
}

export function makeFakeDataCenterTopology(): DataCenterTopology {
  const template = rackDevicesTemplate();

  const spacingX = 1.25; // distance between racks in a row
  const spacingZ = 2.6;  // distance between rows (increase if rows look too tight)

  const cols = 2; // racks per row
  const rows = 4; // number of rows

  const racks: RackTopology[] = [];

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const rowName = (row: number) => (row < letters.length ? letters[row] : `R${row + 1}`);

  for (let row = 0; row < rows; row++) {
    const label = rowName(row);

    // Unique Z per row, centered around 0
    const z = (row - (rows - 1) / 2) * spacingZ;

    // Alternate facing direction so adjacent rows face each other (aisle-style)
    const rot = row % 2 === 0 ? 0 : Math.PI;



    for (let c = 0; c < cols; c++) {
      const idx = c + 1;

      // Unique X per rack, centered around 0
      const x = (c - (cols - 1) / 2) * spacingX;

      racks.push(
        mkRack(
          `rack-${label.toLowerCase()}${idx}`, // UNIQUE id: rack-a1, rack-c3, etc.
          `Rack ${label}${idx}`,
          x,
          0,
          z,
          rot,
          template
        )
      );
    }
  }

  return {
    id: "dc-1",
    name: "Data Center Lab",
    racks,
  };
}


function mkRack(
  id: string,
  name: string,
  x: number,
  y: number,
  z: number,
  rotationY: number,
  template: DeviceTopology[]
): RackTopology {
  return {
    id,
    name,
    uHeight: 42,
    position: { x, y, z },
    rotationY,
    devices: cloneDevices(template),
  };
}

export function makeInitialTelemetry(rack: RackTopology): RackTelemetry {
  const devices: Record<string, DeviceTelemetry> = {};
  for (const d of rack.devices) devices[d.id] = initDevice(d);
  return { rackId: rack.id, ts: Date.now(), devices };
}

export function makeInitialTelemetryMap(dc: DataCenterTopology): Record<string, RackTelemetry> {
  const out: Record<string, RackTelemetry> = {};
  for (const rack of dc.racks) out[rack.id] = makeInitialTelemetry(rack);
  return out;
}

function initDevice(d: DeviceTopology): DeviceTelemetry {
  const basePower =
    d.type === "server" ? 320 + rand() * 140 :
    d.type === "switch" ? 90 + rand() * 40 :
    0;

  const tempsC: Record<string, number | null> = {};
  if (d.type === "server") {
    tempsC["CPU1"] = 40 + rand() * 10;
    tempsC["CPU2"] = 38 + rand() * 10;
    tempsC["Inlet"] = 18 + rand() * 6;
    tempsC["System"] = 26 + rand() * 10;
    tempsC["PCH"] = 40 + rand() * 8;
    tempsC["Peripheral"] = 30 + rand() * 10;
    tempsC["VRM"] = 32 + rand() * 10;
  } else if (d.type === "switch") {
    tempsC["ASIC"] = 45 + rand() * 10;
    tempsC["Inlet"] = 20 + rand() * 5;
  }

  const fansRpm: Record<string, number | null> = {};
  if (d.type === "server") {
    for (let i = 1; i <= 8; i++) fansRpm[`FAN${i}`] = 2800 + rand() * 3200;
    fansRpm["FAN9"] = null;
  } else if (d.type === "switch") {
    for (let i = 1; i <= 4; i++) fansRpm[`FAN${i}`] = 8000 + rand() * 2000;
  }

  const voltagesV: Record<string, number | null> = {};
  if (d.type === "server") {
    voltagesV["12V"] = 12.0 + (rand() - 0.5) * 0.4;
    voltagesV["5VCC"] = 5.0 + (rand() - 0.5) * 0.15;
    voltagesV["3.3VCC"] = 3.3 + (rand() - 0.5) * 0.08;
    voltagesV["VBAT"] = 3.1 + (rand() - 0.5) * 0.3;
    voltagesV["Vcpu"] = 0.9 + rand() * 1.0;
    voltagesV["VDIMM"] = 1.20 + (rand() - 0.5) * 0.08;
  }

  const ports: DeviceTelemetry["ports"] = {};
  for (const p of d.ports ?? []) {
    ports[p.id] = {
      linkUp: true,
      speedGbps: p.id.startsWith("swp") ? 100 : 25,
      rxPackets: Math.floor(1_000_000 + rand() * 10_000_000),
      txPackets: Math.floor(700_000 + rand() * 8_000_000),
      rxBytes: Math.floor(1_000_000_000 + rand() * 9_000_000_000),
      txBytes: Math.floor(700_000_000 + rand() * 7_000_000_000),
      rxErrors: 0,
      txErrors: 0,
      rxMissed: 0,
    };
  }

  const drives: DeviceTelemetry["drives"] = {};
  for (const bay of d.drives ?? []) {
    drives[bay.id] = {
      smartOk: true,
      tempC: 28 + rand() * 6,
      percentUsed: Math.floor(rand() * 3),
      utilizationPct: clamp(30 + rand() * 45, 0, 100),
      powerOnHours: Math.floor(1000 + rand() * 16000),
      unsafeShutdowns: Math.floor(rand() * 35),
    };
  }

  return { powerWatts: basePower, tempsC, fansRpm, voltagesV, ports, drives };
}

export function stepTelemetry(rack: RackTopology, prev: RackTelemetry): RackTelemetry {
  const next: RackTelemetry = {
    rackId: prev.rackId,
    ts: Date.now(),
    devices: { ...prev.devices },
  };

  for (const dev of rack.devices) {
    const cur = prev.devices[dev.id];
    if (!cur) continue;

    const t: DeviceTelemetry = {
      ...cur,
      tempsC: { ...cur.tempsC },
      fansRpm: { ...cur.fansRpm },
      voltagesV: { ...cur.voltagesV },
      ports: { ...cur.ports },
      drives: { ...cur.drives },
    };

    // Power random-walk within plausible budget
    if (dev.type === "server") {
      const budget = dev.powerBudgetWatts ?? 650;
      const drift = (rand() - 0.5) * 20;
      t.powerWatts = clamp(t.powerWatts + drift, 140, budget);
    } else if (dev.type === "switch") {
      const budget = dev.powerBudgetWatts ?? 250;
      const drift = (rand() - 0.5) * 6;
      t.powerWatts = clamp(t.powerWatts + drift, 40, budget);
    } else {
      t.powerWatts = 0;
    }

    // Temps correlate to power (simplified)
    const inlet = t.tempsC["Inlet"] ?? 20;
    const heat = dev.type === "server" ? (t.powerWatts - 200) / 25 : (t.powerWatts - 60) / 20;

    for (const k of Object.keys(t.tempsC)) {
      const base = t.tempsC[k];
      if (base === null) continue;

      const noise = (rand() - 0.5) * 0.8;
      const target =
        k === "Inlet" ? clamp(inlet + (rand() - 0.5) * 0.3, 16, 30) :
        clamp(inlet + 10 + heat + noise, 18, 105);

      t.tempsC[k] = base + 0.15 * (target - base);
    }






    // Fans respond to CPU/ASIC temp
    const cpuHot = Math.max(
      t.tempsC["CPU1"] ?? 0,
      t.tempsC["CPU2"] ?? 0,
      t.tempsC["ASIC"] ?? 0
    );

    for (const k of Object.keys(t.fansRpm)) {
      const v = t.fansRpm[k];
      if (v === null) continue;

      const desired =
        dev.type === "server"
          ? clamp(1800 + cpuHot * 60 + (rand() - 0.5) * 120, 900, 18000)
          : clamp(5000 + cpuHot * 50 + (rand() - 0.5) * 150, 3000, 20000);

      t.fansRpm[k] = v + 0.2 * (desired - v);
    }

    // Voltages: small noise
    for (const k of Object.keys(t.voltagesV)) {
      const v = t.voltagesV[k];
      if (v === null) continue;
      const noise = (rand() - 0.5) * (k === "12V" ? 0.03 : 0.01);
      t.voltagesV[k] = v + noise;
    }

    // Network counters increment
    for (const pid of Object.keys(t.ports)) {
      const p = { ...t.ports[pid] };

      const incPkts = Math.floor(500 + rand() * 8000);
      const incBytes = incPkts * Math.floor(600 + rand() * 900);

      p.rxPackets += incPkts;
      p.txPackets += Math.floor(300 + rand() * 6000);
      p.rxBytes += incBytes;
      p.txBytes += Math.floor(incBytes * (0.6 + rand() * 0.8));

      if (rand() < 0.01) p.rxErrors += 1 + Math.floor(rand() * 3);
      if (rand() < 0.008) p.txErrors += 1 + Math.floor(rand() * 2);
      if (rand() < 0.006) p.rxMissed += 1 + Math.floor(rand() * 4);

      t.ports[pid] = p;
    }

    // Drives
    for (const did of Object.keys(t.drives)) {
      const dtele = { ...t.drives[did] };
      dtele.utilizationPct = clamp(dtele.utilizationPct + rand() * 0.03, 0, 100);
      const devTemp = t.tempsC["System"] ?? t.tempsC["ASIC"] ?? 30;
      if (dtele.tempC !== null) {
        dtele.tempC = clamp(
          dtele.tempC + 0.05 * ((devTemp - 2) - dtele.tempC) + (rand() - 0.5) * 0.2,
          18,
          85
        );
      }

      if (rand() < 0.0008) dtele.smartOk = false;

      t.drives[did] = dtele;
    }

    next.devices[dev.id] = t;
  }

  return next;
}
