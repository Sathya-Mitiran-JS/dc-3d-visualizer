import { useMemo } from "react";
import { useRackStore } from "./store";
import type { Selection, Severity, MetricKey, HistoryPoint, RackTopology, RackTelemetry} from "./types";
import { fmt, fmt1, severityColor } from "./utils";
import { Sparkline } from "./Sparkline";

function sevBadge(sev: Severity, text: string) {
  const c = severityColor(sev);
  return (
    <span className="badge" style={{ borderColor: `${c}55` }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: c,
          display: "inline-block",
        }}
      />
      {text}
    </span>
  );
}

function seriesValues(
  history: Record<string, Partial<Record<MetricKey, HistoryPoint[]>>>,
  entity: string,
  metric: MetricKey
) {
  return (history[entity]?.[metric] ?? []).map((p) => p.value);
}

function lastValue(arr: number[]) {
  if (arr.length === 0) return null;
  return arr[arr.length - 1];
}

function Breadcrumbs({
  sel,
  onSelect,
}: {
  sel: Selection;
  onSelect: (s: Selection) => void;
}) {
  const dc = useRackStore((s) => s.dc);

  const parts: { label: string; sel: Selection }[] = [
    { label: dc.name, sel: { kind: "datacenter" } },
  ];

  if (sel.kind === "rack" || sel.kind === "device" || sel.kind === "drive" || sel.kind === "port") {
    const rack = dc.racks.find((r) => r.id === sel.rackId);
    if (rack) parts.push({ label: rack.name, sel: { kind: "rack", rackId: rack.id } });
  }

  if (sel.kind === "device" || sel.kind === "drive" || sel.kind === "port") {
    parts.push({ label: sel.deviceId, sel: { kind: "device", rackId: sel.rackId, deviceId: sel.deviceId } });
  }
  if (sel.kind === "drive") parts.push({ label: `Drive:${sel.driveId}`, sel });
  if (sel.kind === "port") parts.push({ label: `Port:${sel.portId}`, sel });

  return (
    <div className="breadcrumbs">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " / "}
          <a onClick={() => onSelect(p.sel)}>{p.label}</a>
        </span>
      ))}
    </div>
  );
}

function maxTempRack(rack: RackTopology, t: RackTelemetry | undefined) {
  if (!t) return null;
  const vals: number[] = [];
  for (const dev of rack.devices) {
    const dt = t.devices[dev.id];
    if (!dt) continue;
    for (const v of Object.values(dt.tempsC)) if (v !== null) vals.push(v);
  }
  if (vals.length === 0) return null;
  return Math.max(...vals);
}

function totalPowerRack(rack: RackTopology, t: RackTelemetry | undefined) {
  if (!t) return 0;
  return rack.devices.reduce((sum, dev) => sum + (t.devices[dev.id]?.powerWatts ?? 0), 0);
}

export function DetailsPanel() {
  const dc = useRackStore((s) => s.dc);
  const telemetryByRack = useRackStore((s) => s.telemetryByRack);
  const selection = useRackStore((s) => s.selection);
  const overlay = useRackStore((s) => s.overlay);
  const select = useRackStore((s) => s.select);
  const history = useRackStore((s) => s.history);

  const ctx = useMemo(() => {
    if (selection.kind === "datacenter") return { kind: "datacenter" as const };

    const rack = dc.racks.find((r) => r.id === selection.rackId);
    const rackTelemetry = telemetryByRack[selection.rackId];
    if (!rack || !rackTelemetry) return { kind: "missing" as const };

    if (selection.kind === "rack") return { kind: "rack" as const, rack, rackTelemetry };

    const dev = rack.devices.find((d) => d.id === selection.deviceId);
    const devTelem = rackTelemetry.devices[selection.deviceId];
    if (!dev || !devTelem) return { kind: "missing" as const };

    if (selection.kind === "device") return { kind: "device" as const, rack, rackTelemetry, dev, devTelem };
    if (selection.kind === "drive") return { kind: "drive" as const, rack, rackTelemetry, dev, devTelem, driveId: selection.driveId };
    return { kind: "port" as const, rack, rackTelemetry, dev, devTelem, portId: selection.portId };
  }, [selection, dc.racks, telemetryByRack]);

  const updatedTs = (() => {
    if (selection.kind === "datacenter") {
      const any = dc.racks[0]?.id;
      return any ? telemetryByRack[any]?.ts : null;
    }
    if (selection.kind === "rack" || selection.kind === "device" || selection.kind === "drive" || selection.kind === "port") {
      return telemetryByRack[selection.rackId]?.ts ?? null;
    }
    return null;
  })();

  return (
    <div>
      <div className="card">
        <Breadcrumbs sel={selection} onSelect={select} />
        <div style={{ marginTop: 8 }} className="small">
          Overlay: <span className="mono">{overlay}</span>
          {" • "}
          Updated: <span className="mono">{updatedTs ? new Date(updatedTs).toLocaleTimeString() : "na"}</span>
        </div>
      </div>

      {ctx.kind === "datacenter" && (
        <>
          <div className="card">
            <h3>Data Center Summary</h3>
            <div className="kv">
              <div className="k">Racks</div>
              <div className="v">{dc.racks.length}</div>
              <div className="k">Selection</div>
              <div className="v">Click a rack (label or frame) to inspect it.</div>
            </div>
          </div>

          <div className="card">
            <h3>Racks</h3>
            <div className="kv">
              {dc.racks.map((r) => {
                const t = telemetryByRack[r.id];
                const p = totalPowerRack(r, t);
                const mt = maxTempRack(r, t);
                return (
                  <div key={r.id} style={{ gridColumn: "1 / -1", padding: "6px 0" }}>
                    <button className="btn" onClick={() => select({ kind: "rack", rackId: r.id })}>
                      {r.name}
                    </button>
                    <span className="mono" style={{ marginLeft: 10, fontSize: 12, color: "#e5e7eb" }}>
                      {p.toFixed(0)} W{" "}
                      {mt === null ? "" : `• max ${mt.toFixed(0)} °C`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {ctx.kind === "rack" && (
        <>
          <div className="card">
            <h3>Rack</h3>
            <div className="kv">
              <div className="k">Name</div>
              <div className="v">{ctx.rack.name}</div>
              <div className="k">Height</div>
              <div className="v">{ctx.rack.uHeight}U</div>
              <div className="k">Devices</div>
              <div className="v">{ctx.rack.devices.length}</div>
              <div className="k">Total Power</div>
              <div className="v">{totalPowerRack(ctx.rack, ctx.rackTelemetry).toFixed(0)} W</div>
            </div>
          </div>

          <div className="card">
            <h3>Pick a device</h3>
            <div className="kv">
              {ctx.rack.devices
                .filter((d) => d.type !== "pdu")
                .map((d) => (
                  <div key={d.id} style={{ gridColumn: "1 / -1", padding: "6px 0" }}>
                    <button className="btn" onClick={() => select({ kind: "device", rackId: ctx.rack.id, deviceId: d.id })}>
                      {d.name} (U{d.uStart}–U{d.uStart + d.uSize - 1})
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}

      {ctx.kind === "device" && (
        <>
          <div className="card">
            <h3>Device</h3>
            <div className="kv">
              <div className="k">Rack</div>
              <div className="v">{ctx.rack.name}</div>
              <div className="k">Name</div>
              <div className="v">{ctx.dev.name}</div>
              <div className="k">Type</div>
              <div className="v">{ctx.dev.type}</div>
              <div className="k">Rack Position</div>
              <div className="v">
                U{ctx.dev.uStart}–U{ctx.dev.uStart + ctx.dev.uSize - 1} ({ctx.dev.uSize}U)
              </div>
              <div className="k">Power</div>
              <div className="v">{ctx.devTelem.powerWatts.toFixed(0)} W</div>
            </div>
          </div>

          <div className="card">
            <h3>Trends (last 60s)</h3>
            {(() => {
              const devEntity = `dev:${ctx.rack.id}:${ctx.dev.id}`;

              const temp = seriesValues(history, devEntity, "thermal.maxTempC");
              const fan = seriesValues(history, devEntity, "airflow.avgRpm");
              const pwr = seriesValues(history, devEntity, "power.watts");
              const err = seriesValues(history, devEntity, "network.errDelta");

              return (
                <>
                  <div className="sparkrow">
                    <div className="sparklabel">
                      Max Temp
                      <span className="sparkvalue">{lastValue(temp) === null ? "na" : `${lastValue(temp)!.toFixed(0)} °C`}</span>
                    </div>
                    <Sparkline data={temp} />
                  </div>

                  <div className="sparkrow">
                    <div className="sparklabel">
                      Avg Fan
                      <span className="sparkvalue">{lastValue(fan) === null ? "na" : `${lastValue(fan)!.toFixed(0)} RPM`}</span>
                    </div>
                    <Sparkline data={fan} />
                  </div>

                  <div className="sparkrow">
                    <div className="sparklabel">
                      Power
                      <span className="sparkvalue">{lastValue(pwr) === null ? "na" : `${lastValue(pwr)!.toFixed(0)} W`}</span>
                    </div>
                    <Sparkline data={pwr} />
                  </div>

                  <div className="sparkrow">
                    <div className="sparklabel">
                      Net Err Δ/s
                      <span className="sparkvalue">{lastValue(err) === null ? "na" : `${lastValue(err)!.toFixed(0)}`}</span>
                    </div>
                    <Sparkline data={err} />
                  </div>
                </>
              );
            })()}
          </div>

          <div className="card">
            <h3>Temperatures (IPMI-like)</h3>
            <div className="kv">
              {Object.entries(ctx.devTelem.tempsC).map(([k, v]) => (
                <FragmentKV key={k} k={k} v={fmt1(v, "°C")} />
              ))}
            </div>
          </div>

          <div className="card">
            <h3>Fans</h3>
            <div className="kv">
              {Object.entries(ctx.devTelem.fansRpm).map(([k, v]) => (
                <FragmentKV key={k} k={k} v={fmt(v, "RPM")} />
              ))}
            </div>
          </div>

          <div className="card">
            <h3>Voltages</h3>
            <div className="kv">
              {Object.entries(ctx.devTelem.voltagesV).map(([k, v]) => (
                <FragmentKV key={k} k={k} v={fmt1(v, "V")} />
              ))}
            </div>
          </div>

          <div className="card">
            <h3>NIC Ports</h3>
            {Object.entries(ctx.devTelem.ports).length === 0 ? (
              <div className="small">No ports modeled for this device.</div>
            ) : (
              <div className="kv">
                {Object.entries(ctx.devTelem.ports).map(([pid, p]) => {
                  const err = p.rxErrors + p.txErrors + p.rxMissed;
                  const sev: Severity = !p.linkUp ? "crit" : err > 0 ? "warn" : "ok";
                  return (
                    <div key={pid} style={{ gridColumn: "1 / -1", padding: "6px 0" }}>
                      <button className="btn" onClick={() => select({ kind: "port", rackId: ctx.rack.id, deviceId: ctx.dev.id, portId: pid })}>
                        {pid}
                      </button>
                      <span style={{ marginLeft: 10 }}>{sevBadge(sev, `link=${p.linkUp ? "up" : "down"} err=${err}`)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Drives</h3>
            {Object.entries(ctx.devTelem.drives).length === 0 ? (
              <div className="small">No drives modeled for this device.</div>
            ) : (
              <div className="kv">
                {Object.entries(ctx.devTelem.drives).map(([did, d]) => {
                  const sev: Severity = !d.smartOk ? "crit" : (d.tempC ?? 0) >= 70 ? "warn" : "ok";
                  return (
                    <div key={did} style={{ gridColumn: "1 / -1", padding: "6px 0" }}>
                      <button className="btn" onClick={() => select({ kind: "drive", rackId: ctx.rack.id, deviceId: ctx.dev.id, driveId: did })}>
                        {did}
                      </button>
                      <span style={{ marginLeft: 10 }}>{sevBadge(sev, `temp=${d.tempC ?? "na"}°C util=${d.utilizationPct.toFixed(1)}%`)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {ctx.kind === "drive" && (
        <>
          {(() => {
            const d = ctx.devTelem.drives[ctx.driveId];
            const sev: Severity =
              !d ? "na" :
              !d.smartOk ? "crit" :
              (d.tempC ?? 0) >= 70 ? "warn" : "ok";

            return (
              <>
                <div className="card">
                  <h3>Drive</h3>
                  <div style={{ marginBottom: 8 }}>{sevBadge(sev, `rack=${ctx.rack.name} device=${ctx.dev.name} drive=${ctx.driveId}`)}</div>
                  {!d ? (
                    <div className="small">No telemetry for this drive id.</div>
                  ) : (
                    <div className="kv">
                      <FragmentKV k="SMART Health" v={d.smartOk ? "PASSED" : "FAILED"} />
                      <FragmentKV k="Temperature" v={fmt1(d.tempC, "°C")} />
                      <FragmentKV k="Percent Used" v={`${d.percentUsed.toFixed(0)}%`} />
                      <FragmentKV k="Utilization" v={`${d.utilizationPct.toFixed(1)}%`} />
                      <FragmentKV k="Power On Hours" v={`${d.powerOnHours}`} />
                      <FragmentKV k="Unsafe Shutdowns" v={`${d.unsafeShutdowns}`} />
                    </div>
                  )}
                </div>

                <div className="card">
                  <h3>Trends (last 60s)</h3>
                  {(() => {
                    const driveEntity = `drive:${ctx.rack.id}:${ctx.dev.id}:${ctx.driveId}`;
                    const t = seriesValues(history, driveEntity, "drive.tempC");
                    const u = seriesValues(history, driveEntity, "drive.utilPct");

                    return (
                      <>
                        <div className="sparkrow">
                          <div className="sparklabel">
                            Drive Temp
                            <span className="sparkvalue">{lastValue(t) === null ? "na" : `${lastValue(t)!.toFixed(0)} °C`}</span>
                          </div>
                          <Sparkline data={t} />
                        </div>

                        <div className="sparkrow">
                          <div className="sparklabel">
                            Utilization
                            <span className="sparkvalue">{lastValue(u) === null ? "na" : `${lastValue(u)!.toFixed(1)} %`}</span>
                          </div>
                          <Sparkline data={u} />
                        </div>
                      </>
                    );
                  })()}
                </div>
              </>
            );
          })()}
        </>
      )}

      {ctx.kind === "port" && (
        <>
          {(() => {
            const p = ctx.devTelem.ports[ctx.portId];
            const sev: Severity =
              !p ? "na" :
              !p.linkUp ? "crit" :
              (p.rxErrors + p.txErrors + p.rxMissed) > 0 ? "warn" : "ok";

            return (
              <>
                <div className="card">
                  <h3>NIC Port</h3>
                  <div style={{ marginBottom: 8 }}>{sevBadge(sev, `rack=${ctx.rack.name} device=${ctx.dev.name} port=${ctx.portId}`)}</div>
                  {!p ? (
                    <div className="small">No telemetry for this port id.</div>
                  ) : (
                    <div className="kv">
                      <FragmentKV k="Link" v={p.linkUp ? "up" : "down"} />
                      <FragmentKV k="Speed" v={`${p.speedGbps} Gbps`} />
                      <FragmentKV k="rx_packets" v={`${p.rxPackets}`} />
                      <FragmentKV k="tx_packets" v={`${p.txPackets}`} />
                      <FragmentKV k="rx_bytes" v={`${p.rxBytes}`} />
                      <FragmentKV k="tx_bytes" v={`${p.txBytes}`} />
                      <FragmentKV k="rx_errors" v={`${p.rxErrors}`} />
                      <FragmentKV k="tx_errors" v={`${p.txErrors}`} />
                      <FragmentKV k="rx_missed" v={`${p.rxMissed}`} />
                    </div>
                  )}
                </div>

                <div className="card">
                  <h3>Trends (last 60s)</h3>
                  {(() => {
                    const portEntity = `port:${ctx.rack.id}:${ctx.dev.id}:${ctx.portId}`;
                    const rx = seriesValues(history, portEntity, "port.rxPps");
                    const tx = seriesValues(history, portEntity, "port.txPps");
                    const e = seriesValues(history, portEntity, "port.errDelta");

                    return (
                      <>
                        <div className="sparkrow">
                          <div className="sparklabel">
                            rx_packets Δ/s
                            <span className="sparkvalue">{lastValue(rx) === null ? "na" : `${lastValue(rx)!.toFixed(0)}`}</span>
                          </div>
                          <Sparkline data={rx} />
                        </div>

                        <div className="sparkrow">
                          <div className="sparklabel">
                            tx_packets Δ/s
                            <span className="sparkvalue">{lastValue(tx) === null ? "na" : `${lastValue(tx)!.toFixed(0)}`}</span>
                          </div>
                          <Sparkline data={tx} />
                        </div>

                        <div className="sparkrow">
                          <div className="sparklabel">
                            errors Δ/s
                            <span className="sparkvalue">{lastValue(e) === null ? "na" : `${lastValue(e)!.toFixed(0)}`}</span>
                          </div>
                          <Sparkline data={e} />
                        </div>
                      </>
                    );
                  })()}
                </div>
              </>
            );
          })()}
        </>
      )}

      {ctx.kind === "missing" && (
        <div className="card">
          <h3>Selection</h3>
          <div className="small">Selected item not found in topology/telemetry.</div>
        </div>
      )}
    </div>
  );
}

function FragmentKV({ k, v }: { k: string; v: string }) {
  return (
    <>
      <div className="k">{k}</div>
      <div className="v mono">{v}</div>
    </>
  );
}
