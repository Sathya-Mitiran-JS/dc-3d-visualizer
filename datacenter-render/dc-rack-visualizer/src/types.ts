export type Overlay = "thermal" | "airflow" | "power" | "network" | "storage";
export type DeviceType = "server" | "switch" | "pdu";
export type Severity = "ok" | "warn" | "crit" | "na";

export type CameraPreset = "iso" | "front" | "back" | "left" | "right";

export type Selection =
  | { kind: "datacenter" }
  | { kind: "rack"; rackId: string }
  | { kind: "device"; rackId: string; deviceId: string }
  | { kind: "drive"; rackId: string; deviceId: string; driveId: string }
  | { kind: "port"; rackId: string; deviceId: string; portId: string };

export interface DataCenterTopology {
  id: string;
  name: string;
  racks: RackTopology[];
}

export interface RackTopology {
  id: string;
  name: string;
  uHeight: number; // e.g. 42

  // Placement in the 3D room
  position: { x: number; y: number; z: number };
  rotationY: number; // radians

  devices: DeviceTopology[];
}

export interface DeviceTopology {
  id: string;
  name: string;
  type: DeviceType;
  uStart: number; // from bottom, 1..uHeight
  uSize: number; // how many U it occupies
  powerBudgetWatts?: number;

  drives?: DriveBay[];
  ports?: NicPort[];
}

export interface DriveBay {
  id: string; // stable id
  slot: string; // e.g. "NVMe1", "sda", "sdc"
}

export interface NicPort {
  id: string; // stable id
  label: string; // e.g. "ens20f0"
}

export interface RackTelemetry {
  rackId: string;
  ts: number;
  devices: Record<string, DeviceTelemetry>;
}

export interface DeviceTelemetry {
  powerWatts: number;

  tempsC: Record<string, number | null>;
  fansRpm: Record<string, number | null>;
  voltagesV: Record<string, number | null>;

  ports: Record<string, PortTelemetry>;
  drives: Record<string, DriveTelemetry>;
}

export interface PortTelemetry {
  linkUp: boolean;
  speedGbps: number;
  rxPackets: number;
  txPackets: number;
  rxBytes: number;
  txBytes: number;
  rxErrors: number;
  txErrors: number;
  rxMissed: number;
}

export interface DriveTelemetry {
  smartOk: boolean;
  tempC: number | null;
  percentUsed: number;
  utilizationPct: number;
  powerOnHours: number;
  unsafeShutdowns: number;
}

// History / sparklines
export type MetricKey =
  | "thermal.maxTempC"
  | "airflow.avgRpm"
  | "power.watts"
  | "network.errDelta"
  | "drive.tempC"
  | "drive.utilPct"
  | "port.rxPps"
  | "port.txPps"
  | "port.errDelta";

export interface HistoryPoint {
  ts: number;
  value: number;
}

// For logs
export type EventSeverity = "info" | "warn" | "crit";
export type EventDomain = "thermal" | "airflow" | "power" | "network" | "storage";

export type EntityRef =
  | { kind: "rack"; rackId: string }
  | { kind: "device"; rackId: string; deviceId: string }
  | { kind: "drive"; rackId: string; deviceId: string; driveId: string }
  | { kind: "port"; rackId: string; deviceId: string; portId: string };

export type EventLogEntry = {
  id: string;           // unique id for rendering
  ts: number;           // timestamp (ms)

  severity: EventSeverity;
  domain: EventDomain;

  code: string;         // e.g. "THERMAL_WARN", "PORT_DOWN", "RESOLVED"
  incidentKey: string;  // stable key used to dedupe and resolve

  message: string;
  entity: EntityRef;

  meta?: Record<string, unknown>;

  state: "open" | "resolved";
  resolvedTs?: number;
  ackTs?: number;
};
