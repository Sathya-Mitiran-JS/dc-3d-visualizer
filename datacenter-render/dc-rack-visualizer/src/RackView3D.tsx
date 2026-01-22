import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, Grid, ContactShadows, Environment } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { useMemo, useRef, useEffect } from "react";
import { useRackStore } from "./store";
import type { CameraPreset, Overlay, Severity, Selection, RackTopology, DeviceTopology, RackTelemetry } from "./types";
import { clamp, severityColor } from "./utils";

const U = 0.18;
const RACK_W = 0.75;
const RACK_D = 0.85;

type AisleKind = "cold" | "hot";
type Aisle = { z: number; kind: AisleKind };

const FLOOR_Y = -4.2;

function computeSceneLayout(dc: { racks: RackTopology[] }) {
  const rackHalfW = RACK_W / 2;
  const rackHalfD = RACK_D / 2;

  // Group racks into "rows" by Z (all racks in same row share the same z)
  const rowMap = new Map<string, { z: number; rot: number }>();
  for (const r of dc.racks) {
    const key = r.position.z.toFixed(3);
    if (!rowMap.has(key)) rowMap.set(key, { z: r.position.z, rot: r.rotationY });
  }
  const rows = Array.from(rowMap.values()).sort((a, b) => a.z - b.z);

  // Typical row-to-row spacing
  const gaps = rows.slice(1).map((r, i) => Math.abs(r.z - rows[i].z));
  const typicalGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 2.6;

  const aisleWidth = 2.2; // keep your previous visual width
  const aisles: Aisle[] = [];

  // Outer hot aisles (outside the first/last row)
  if (rows.length > 0) {
    aisles.push({ z: rows[0].z - typicalGap / 2, kind: "hot" });

    // Helper: does this row’s FRONT face the aisle at aisleZ?
    const facesAisle = (row: { z: number; rot: number }, aisleZ: number) => {
      // Local front is +Z; after rotation, world Z component of front is cos(rot).
      const frontZ = Math.cos(row.rot);          // ~ +1 (faces +Z) or -1 (faces -Z)
      const toAisleZ = aisleZ > row.z ? 1 : -1;  // aisle is in +Z or -Z direction
      return frontZ * toAisleZ > 0;              // front points toward aisle?
    };

    // Between rows: cold = front-front, hot = back-back, mixed -> hot
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i];
      const b = rows[i + 1];
      const mid = (a.z + b.z) / 2;

      const aFront = facesAisle(a, mid);
      const bFront = facesAisle(b, mid);

      const kind: AisleKind =
        aFront && bFront ? "cold" :
        !aFront && !bFront ? "hot" :
        "hot";

      aisles.push({ z: mid, kind });
    }

    aisles.push({ z: rows[rows.length - 1].z + typicalGap / 2, kind: "hot" });
  }

  // Rack extents
  const xs = dc.racks.map((r) => r.position.x);
  const zs = dc.racks.map((r) => r.position.z);

  let minX = Math.min(...xs) - rackHalfW;
  let maxX = Math.max(...xs) + rackHalfW;
  let minZ = Math.min(...zs) - rackHalfD;
  let maxZ = Math.max(...zs) + rackHalfD;

  // Extend extents to include aisle bands
  if (aisles.length > 0) {
    const minA = Math.min(...aisles.map((a) => a.z)) - aisleWidth / 2;
    const maxA = Math.max(...aisles.map((a) => a.z)) + aisleWidth / 2;
    minZ = Math.min(minZ, minA);
    maxZ = Math.max(maxZ, maxA);
  }

  // Add generous space around the whole scene (walls farther away)
  const padX = 14; // <-- increase/decrease to taste
  const padZ = 14; // <-- increase/decrease to taste
  minX -= padX;
  maxX += padX;
  minZ -= padZ;
  maxZ += padZ;


  const roomW = maxX - minX;
  const roomD = maxZ - minZ;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  return { roomW, roomD, centerX, centerZ, aisleWidth, aisles };
}


function ledColor(sev: Severity): string {
  if (sev === "ok") return "#22c55e";   // green
  if (sev === "warn") return "#f59e0b"; // amber
  if (sev === "crit") return "#ef4444"; // red
  return "#111827"; // na/off
}

function ledIntensity(sev: Severity): number {
  if (sev === "ok") return 1.2;
  if (sev === "warn") return 1.6;
  if (sev === "crit") return 2.0;
  return 0.0;
}

function PduStrip({ rackHeight }: { rackHeight: number }) {
  // Simple non-interactive vertical strip inside the rack (right side).
  const bodyW = 0.05;
  const bodyD = 0.06;

  // Place it slightly inside the rack volume, near the right wall.
  const x = RACK_W / 2 - bodyW / 2 - 0.02;
  const z = -RACK_D * 0.25;

  const usableH = rackHeight * 0.90;
  const y0 = -usableH / 2;

  const outlets = 12;

  return (
    <group position={[x, 0, z]} raycast={() => null}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[bodyW, rackHeight * 0.95, bodyD]} />
        <meshStandardMaterial
          color={"#0b1220"}
          roughness={0.35}
          metalness={0.45}
          envMapIntensity={0.9}
        />
      </mesh>

      {/* Outlet indicators */}
      {Array.from({ length: outlets }).map((_, i) => {
        const y = y0 + (i / (outlets - 1)) * usableH;
        return (
          <mesh key={i} position={[0, y, bodyD / 2 + 0.001]}>
            <boxGeometry args={[bodyW * 0.62, 0.03, 0.006]} />
            <meshStandardMaterial
              color={"#111827"}
              emissive={new THREE.Color("#10b981")}
              emissiveIntensity={0.08}
              roughness={0.9}
            />
          </mesh>
        );
      })}
    </group>
  );
}


function RoomShell({
  centerX,
  centerZ,
  roomW,
  roomD,
}: {
  centerX: number;
  centerZ: number;
  roomW: number;
  roomD: number;
}) {
  const thickness = 0.3;
  const wallH = 9.0;
  const wallY = FLOOR_Y + wallH / 2;

  const backZ = centerZ - roomD / 2 - thickness / 2;
  const frontZ = centerZ + roomD / 2 + thickness / 2;
  const leftX = centerX - roomW / 2 - thickness / 2;
  const rightX = centerX + roomW / 2 + thickness / 2;

  return (
    <group raycast={() => null}>
      <mesh position={[centerX, wallY, backZ]} receiveShadow>
        <boxGeometry args={[roomW, wallH, thickness]} />
        <meshStandardMaterial color={"#05070c"} roughness={0.95} />
      </mesh>

      <mesh position={[centerX, wallY, frontZ]} receiveShadow>
        <boxGeometry args={[roomW, wallH, thickness]} />
        <meshStandardMaterial color={"#05070c"} roughness={0.95} />
      </mesh>

      <mesh position={[leftX, wallY, centerZ]} receiveShadow>
        <boxGeometry args={[thickness, wallH, roomD]} />
        <meshStandardMaterial color={"#05070c"} roughness={0.95} />
      </mesh>

      <mesh position={[rightX, wallY, centerZ]} receiveShadow>
        <boxGeometry args={[thickness, wallH, roomD]} />
        <meshStandardMaterial color={"#05070c"} roughness={0.95} />
      </mesh>
    </group>
  );
}

function AisleBandsAndLabels({
  aisles,
  centerX,
  xLen,
  y,
  width,
}: {
  aisles: Aisle[];
  centerX: number;
  xLen: number;
  y: number;
  width: number;
}) {
  return (
    <group raycast={() => null}>
      {aisles.map((a, i) => {
        const isCold = a.kind === "cold";
        const bandColor = isCold ? "#0b1b2e" : "#2a0b0b";
        const bandOpacity = isCold ? 0.22 : 0.16;
        const label = isCold ? "COLD AISLE" : "HOT AISLE";
        const labelColor = isCold ? "#93c5fd" : "#fca5a5";
        const fontSize = isCold ? 0.30 : 0.26;

        return (
          <group key={`${a.kind}-${i}`}>
            <mesh position={[centerX, y, a.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[xLen, width]} />
              <meshStandardMaterial color={bandColor} transparent opacity={bandOpacity} />
            </mesh>

            <Text
              position={[centerX, y + 0.04, a.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={fontSize}
              color={labelColor}
            >
              {label}
            </Text>
          </group>
        );
      })}
    </group>
  );
}



function maxTempOf(tempsC: Record<string, number | null>) {
  const vals = Object.values(tempsC).filter((x): x is number => x !== null);
  if (vals.length === 0) return null;
  return Math.max(...vals);
}

function avgFanOf(fansRpm: Record<string, number | null>) {
  const vals = Object.values(fansRpm).filter((x): x is number => x !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function deviceSeverity(overlay: Overlay, dev: DeviceTopology, t: any): Severity {
  if (!t) return "na";

  if (overlay === "thermal") {
    const mx = maxTempOf(t.tempsC);
    if (mx === null) return "na";
    if (mx >= 95) return "crit";
    if (mx >= 85) return "warn";
    return "ok";
  }

  if (overlay === "airflow") {
    const fans = Object.values(t.fansRpm).filter((x): x is number => x !== null);
    if (fans.length === 0) return "na";
    const mn = Math.min(...fans);
    if (mn < 700) return "crit";
    if (mn < 1200) return "warn";
    return "ok";
  }

  if (overlay === "power") {
    const budget = dev.powerBudgetWatts ?? (dev.type === "server" ? 650 : dev.type === "switch" ? 250 : 0);
    if (budget <= 0) return "na";
    const pct = t.powerWatts / budget;
    if (pct >= 0.95) return "crit";
    if (pct >= 0.8) return "warn";
    return "ok";
  }

  if (overlay === "network") {
    const ports = Object.values(t.ports);
    if (ports.length === 0) return "na";
    const anyDown = ports.some((p: any) => !p.linkUp);
    const err = ports.reduce((a: number, p: any) => a + p.rxErrors + p.txErrors + p.rxMissed, 0);
    if (anyDown) return "crit";
    if (err >= 10) return "crit";
    if (err > 0) return "warn";
    return "ok";
  }

  // storage
  const drives = Object.values(t.drives);
  if (drives.length === 0) return "na";
  const smartFail = drives.some((d: any) => !d.smartOk);
  if (smartFail) return "crit";
  const hot = drives.some((d: any) => (d.tempC ?? 0) >= 70);
  if (hot) return "warn";
  const veryFull = drives.some((d: any) => d.utilizationPct >= 90);
  if (veryFull) return "warn";
  return "ok";
}

function CameraRig({
  preset,
  controlsRef,
}: {
  preset: CameraPreset;
  controlsRef: React.RefObject<OrbitControlsImpl>;
}) {
  const { camera } = useThree();

  const desiredPos = useRef(new THREE.Vector3(4.2, 2.2, 4.8));
  const desiredTarget = useRef(new THREE.Vector3(0, 0, 0));
  const tween = useRef(0);

  useEffect(() => {
    const map: Record<CameraPreset, THREE.Vector3> = {
      iso: new THREE.Vector3(4.2, 2.2, 4.8),
      front: new THREE.Vector3(0, 1.5, 7.0),
      back: new THREE.Vector3(0, 1.5, -7.0),
      left: new THREE.Vector3(-7.0, 1.5, 0),
      right: new THREE.Vector3(7.0, 1.5, 0),
    };

    desiredPos.current.copy(map[preset]);
    desiredTarget.current.set(0, 0, 0);
    tween.current = 1;
  }, [preset]);

  useFrame(() => {
    if (tween.current <= 0.001) return;

    camera.position.lerp(desiredPos.current, 0.16);

    const c = controlsRef.current;
    if (c) {
      c.target.lerp(desiredTarget.current, 0.16);
      c.update();
    }

    tween.current *= 0.82;
  });

  return null;
}

function RackFrame({
  height,
  cutaway,
  label,
  onSelectRack,
}: {
  height: number;
  cutaway: boolean;
  label: string;
  onSelectRack: () => void;
}) {
  return (
    <group>
      {/* Rack shell should NOT intercept clicks (otherwise it blocks device selection) */}
        <mesh raycast={() => null} castShadow>
        <boxGeometry args={[RACK_W, height, RACK_D]} />
        <meshBasicMaterial color={"#94a3b8"} wireframe transparent opacity={0.35} />
      </mesh>

      {/* Front door plane, doesnt block clicks, set opacity here too */}
      <mesh
        position={[0, 0, RACK_D / 2 + 0.001]}
        visible={!cutaway}
        raycast={() => null}
      >
        <planeGeometry args={[RACK_W * 0.98, height * 0.98]} />
        <meshStandardMaterial
          color={"#94a3b8"}
          transparent
          opacity={0.3} 
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Clickable rack label “plate” ABOVE the rack (doesn't block devices) */}
      <group position={[0, height / 2 + 0.14, 0]}>
        <mesh
          onPointerDown={(e) => {
            e.stopPropagation();
            onSelectRack();
          }}
        >
          <planeGeometry args={[0.75, 0.18]} />
          <meshStandardMaterial
            color={"#111827"}
            transparent
            opacity={0.35}
            side={THREE.DoubleSide}
          />
        </mesh>

        <Text
          position={[0, 0, 0.002]}
          fontSize={0.10}
          color={"#e5e7eb"}
          anchorX="center"
          anchorY="middle"
        >
          {label}
        </Text>
      </group>
    </group>
  );
}


function AirflowArrow({ avgRpm, severity }: { avgRpm: number; severity: Severity }) {
  const norm = clamp((avgRpm - 1200) / (12000 - 1200), 0, 1);
  const length = 0.12 + norm * 0.45;
  const headLen = 0.08;
  const shaftLen = Math.max(0.02, length - headLen);

  const col = severityColor(severity);

  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -shaftLen / 2]}>
        <cylinderGeometry args={[0.012, 0.012, shaftLen, 10]} />
        <meshStandardMaterial color={col} transparent opacity={0.85} />
      </mesh>

      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -(shaftLen + headLen / 2)]}>
        <coneGeometry args={[0.03, headLen, 12]} />
        <meshStandardMaterial color={col} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function HotspotVolume({ deviceHeight, maxTemp }: { deviceHeight: number; maxTemp: number }) {
  const s = clamp((maxTemp - 30) / 70, 0, 1);
  const h = 0.05 + s * (deviceHeight * 0.65);

  const sev: Severity = maxTemp >= 95 ? "crit" : maxTemp >= 85 ? "warn" : "ok";
  const col = severityColor(sev);

  return (
    <mesh position={[0, -deviceHeight * 0.15, 0]}>
      <boxGeometry args={[RACK_W * 0.55, h, RACK_D * 0.40]} />
      <meshStandardMaterial color={col} transparent opacity={0.22} />
    </mesh>
  );
}

function DeviceMesh({
  rackId,
  dev,
  t,
  y,
  h,
  onSelect,
}: {
  rackId: string;
  dev: DeviceTopology;
  t: any;
  y: number;
  h: number;
  onSelect: (sel: Selection) => void;
}) {
  const overlay = useRackStore((s) => s.overlay);
  const selection = useRackStore((s) => s.selection);

  const sev = deviceSeverity(overlay, dev, t);

  // Body material is dark/metal; overlay shows via emissive “tint”
  const bodyColor =
    dev.type === "server" ? "#0b1220" :
    dev.type === "switch" ? "#0f172a" :
    "#111827";

  const overlayTint = sev === "na" ? "#000000" : severityColor(sev);
  const overlayGlow =
    sev === "ok" ? 0.06 :
    sev === "warn" ? 0.12 :
    sev === "crit" ? 0.18 : 0.0;


  const selected =
    selection.kind === "device" && selection.rackId === rackId && selection.deviceId === dev.id;

  const drives = dev.drives ?? [];
  const ports = dev.ports ?? [];

  const frontZ = RACK_D / 2 + 0.001;
  const bodyDepth = RACK_D * 0.8;
  const deviceFrontZ = bodyDepth / 2 + 0.001; // front face of device body (for bezel + LED)
  const panelW = RACK_W * 0.88;
  const panelH = h * 0.88;

  const mxTemp = t ? maxTempOf(t.tempsC) : null;
  const avgR = t ? avgFanOf(t.fansRpm) : null;

  return (
    <group position={[0, y, 0]}>
      <mesh
        castShadow
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect({ kind: "device", rackId, deviceId: dev.id });
        }}
      >
        <boxGeometry args={[RACK_W * 0.92, h * 0.92, RACK_D * 0.8]} />
        <meshStandardMaterial
          color={bodyColor}
          roughness={dev.type === "server" ? 0.28 : 0.35}
          metalness={dev.type === "server" ? 0.45 : 0.35}
          envMapIntensity={0.9}
          emissive={selected ? new THREE.Color("#60a5fa") : new THREE.Color(overlayTint)}
          emissiveIntensity={selected ? 0.28 : overlayGlow}
        />
      </mesh>

      {/* Bezel outline on the device face (thin frame) */}
      <lineSegments position={[0, 0, deviceFrontZ + 0.002]} raycast={() => null}>
        <primitive
          attach="geometry"
          object={new THREE.EdgesGeometry(new THREE.BoxGeometry(panelW, panelH, 0.01))}
        />
        <lineBasicMaterial
          color={selected ? "#60a5fa" : "#334155"}
          transparent
          opacity={0.9}
        />
      </lineSegments>

      {/* Severity LED (green / amber / red) */}
      <mesh
        position={[panelW / 2 - 0.04, panelH / 2 - 0.05, deviceFrontZ + 0.015]}
        raycast={() => null}
      >
        <sphereGeometry args={[0.012, 16, 16]} />
        <meshStandardMaterial
          color={"#000000"}
          emissive={new THREE.Color(ledColor(sev))}
          emissiveIntensity={ledIntensity(sev)}
          roughness={0.2}
          metalness={0.0}
          toneMapped={false}
        />
      </mesh>



      {t && (
        <Text
          position={[RACK_W / 2 + 0.12, 0, 0]}
          fontSize={0.045}
          color={"#e5e7eb"}
          anchorX="left"
          anchorY="middle"
        >
          {overlay === "power"
            ? `${t.powerWatts.toFixed(0)} W`
            : overlay === "thermal"
              ? mxTemp === null ? "" : `${mxTemp.toFixed(0)} °C`
              : overlay === "airflow"
                ? avgR === null ? "" : `${avgR.toFixed(0)} RPM`
                : ""}
        </Text>
      )}

      {overlay === "airflow" && avgR !== null && (
        <AirflowArrow avgRpm={avgR} severity={deviceSeverity("airflow", dev, t)} />
      )}

      {overlay === "thermal" && mxTemp !== null && (
        <HotspotVolume deviceHeight={h} maxTemp={mxTemp} />
      )}

      {drives.length > 0 && (
        <group position={[0, -panelH * 0.15, frontZ]}>
          {drives.map((d, i) => {
            const cols = 4;
            const cellW = panelW / cols;
            const x = -panelW / 2 + cellW / 2 + (i % cols) * cellW;
            const row = Math.floor(i / cols);
            const y2 = -panelH / 2 + 0.08 + row * 0.1;

            const isSel =
              selection.kind === "drive" &&
              selection.rackId === rackId &&
              selection.deviceId === dev.id &&
              selection.driveId === d.id;

            const dt = t?.drives?.[d.id];
            const driveSev: Severity =
              !dt ? "na" :
              !dt.smartOk ? "crit" :
              (dt.tempC ?? 0) >= 70 ? "warn" : "ok";

            return (
              <mesh
                key={`${rackId}:${dev.id}:${d.id}`}
                position={[x, y2, 0]}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: "drive", rackId, deviceId: dev.id, driveId: d.id });
                }}
              >
                <boxGeometry args={[cellW * 0.55, 0.06, 0.02]} />
                <meshStandardMaterial
                  color={overlay === "storage" ? severityColor(driveSev) : "#111827"}
                  emissive={isSel ? new THREE.Color("#60a5fa") : new THREE.Color("#000000")}
                  emissiveIntensity={isSel ? 0.35 : 0}
                  roughness={0.8}
                />
              </mesh>
            );
          })}
        </group>
      )}

      {ports.length > 0 && (
        <group position={[0, panelH * 0.25, frontZ]}>
          {ports.map((p, i) => {
            const cols = 4;
            const cellW = panelW / cols;
            const x = -panelW / 2 + cellW / 2 + (i % cols) * cellW;
            const row = Math.floor(i / cols);
            const y2 = -panelH / 2 + 0.08 + row * 0.1;

            const isSel =
              selection.kind === "port" &&
              selection.rackId === rackId &&
              selection.deviceId === dev.id &&
              selection.portId === p.id;

            const pt = t?.ports?.[p.id];
            const portSev: Severity =
              !pt ? "na" :
              !pt.linkUp ? "crit" :
              (pt.rxErrors + pt.txErrors + pt.rxMissed) > 0 ? "warn" : "ok";

            return (
              <mesh
                key={`${rackId}:${dev.id}:${p.id}`}
                position={[x, y2, 0]}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: "port", rackId, deviceId: dev.id, portId: p.id });
                }}
              >
                <boxGeometry args={[cellW * 0.4, 0.05, 0.02]} />
                <meshStandardMaterial
                  color={overlay === "network" ? severityColor(portSev) : "#0b1220"}
                  emissive={isSel ? new THREE.Color("#60a5fa") : new THREE.Color("#000000")}
                  emissiveIntensity={isSel ? 0.35 : 0}
                  roughness={0.85}
                />
              </mesh>
            );
          })}
        </group>
      )}
    </group>
  );
}

function RackGroup({
  rack,
  rackTelemetry,
  cutaway,
  onSelect,
}: {
  rack: RackTopology;
  rackTelemetry: RackTelemetry | undefined;
  cutaway: boolean;
  onSelect: (sel: Selection) => void;
}) {
  const rackHeight = rack.uHeight * U;
  const yBottom = -rackHeight / 2;

  const deviceMeshes = useMemo(() => {
    return rack.devices
      .filter((d) => d.type !== "pdu")
      .map((d) => {
        const h = d.uSize * U;
        const y = yBottom + (d.uStart - 1) * U + h / 2;
        return { dev: d, y, h };
      });
  }, [rack.devices, yBottom]);

  return (
    <group position={[rack.position.x, rack.position.y, rack.position.z]} rotation={[0, rack.rotationY, 0]}>
      <RackFrame
        height={rackHeight}
        cutaway={cutaway}
        label={rack.name}
        onSelectRack={() => onSelect({ kind: "rack", rackId: rack.id })}
      />

      <PduStrip rackHeight={rackHeight} />

      {deviceMeshes.map(({ dev, y, h }) => (
        <DeviceMesh
          key={`${rack.id}:${dev.id}`}
          rackId={rack.id}
          dev={dev}
          t={rackTelemetry?.devices?.[dev.id]}
          y={y}
          h={h}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

export function RackView3D() {
  const dc = useRackStore((s) => s.dc);
  const layout = useMemo(() => computeSceneLayout(dc), [dc]);
  const fogNear = Math.max(layout.roomW, layout.roomD) * 0.35;
  const fogFar = Math.max(layout.roomW, layout.roomD) * 1.15;
  const telemetryByRack = useRackStore((s) => s.telemetryByRack);

  const select = useRackStore((s) => s.select);
  const cutaway = useRackStore((s) => s.cutaway);
  const cameraPreset = useRackStore((s) => s.cameraPreset);

  const controlsRef = useRef<OrbitControlsImpl>(null!);

  return (
    <Canvas 
      shadows
      camera={{ position: [4.2, 2.2, 4.8], fov: 45 }}
      gl={{ antialias: true }}
    >
      {/* Lighting: one key light + soft ambient + environment reflections */}
      <ambientLight intensity={0.35} />

      <directionalLight
        position={[6, 10, 6]}
        intensity={1.05}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />

      <fog attach="fog" args={["#070a10", fogNear, fogFar]} />

      <Environment preset="warehouse" />

      <RoomShell
        centerX={layout.centerX}
        centerZ={layout.centerZ}
        roomW={layout.roomW}
        roomD={layout.roomD}
      />

      <CameraRig preset={cameraPreset} controlsRef={controlsRef} />

      {dc.racks.map((rack) => (
        <RackGroup
          key={rack.id}
          rack={rack}
          rackTelemetry={telemetryByRack[rack.id]}
          cutaway={cutaway}
          onSelect={select}
        />
      ))}

      {/* Visible floor plane (receives shadows), click to empty selection */}
      <mesh
        receiveShadow
        onPointerDown={() => select({ kind: "datacenter" })}
        position={[layout.centerX, FLOOR_Y, layout.centerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[layout.roomW, layout.roomD]} />
        <meshStandardMaterial color={"#070a10"} roughness={0.95} metalness={0.0} />
      </mesh>

      <AisleBandsAndLabels
        aisles={layout.aisles}
        centerX={layout.centerX}
        xLen={layout.roomW * 0.9}
        y={FLOOR_Y + 0.011}
        width={layout.aisleWidth}
      />

      {/* Grid overlay (purely visual) */}
      <Grid
        position={[layout.centerX, FLOOR_Y + 0.01, layout.centerZ]}
        args={[layout.roomW, layout.roomD]}
        cellSize={0.6}
        cellThickness={0.7}
        sectionSize={3.0}
        sectionThickness={1.2}
        fadeDistance={Math.max(layout.roomW, layout.roomD) * 0.6}
        fadeStrength={1.2}
      />


      {/* Soft contact shadows under racks */}
      <ContactShadows
        position={[layout.centerX, FLOOR_Y + 0.01, layout.centerZ]}
        opacity={0.35}
        scale={Math.max(layout.roomW, layout.roomD)}
        blur={2.8}
        far={Math.max(layout.roomW, layout.roomD) * 0.4}
      />



      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.08}
        minDistance={1.2}
        maxDistance={70.0}
      />
    </Canvas>
  );
}
