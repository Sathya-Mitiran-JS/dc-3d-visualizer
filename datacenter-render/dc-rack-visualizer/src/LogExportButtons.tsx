import { useRackStore } from "./store";

export function LogExportButtons() {
  const exportEventLog = useRackStore((s) => s.exportEventLog);

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button className="btn"
        onClick={() => exportEventLog({ format: "ndjson", scope: "open" })}
        title="Downloads only currently open incidents (best for log ingestion)"
      >
        Download OPEN (NDJSON)
      </button>

      <button className="btn"
        onClick={() => exportEventLog({ format: "json", scope: "all" })}
        title="Downloads the full event log"
      >
        Download ALL (JSON)
      </button>
    </div>
  );
}
