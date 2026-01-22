import type { Overlay } from "./types";
import { useRackStore } from "./store";

const overlays: { id: Overlay; label: string }[] = [
  { id: "thermal", label: "Thermal" },
  { id: "airflow", label: "Airflow" },
  { id: "power", label: "Power" },
  { id: "network", label: "Network" },
  { id: "storage", label: "Storage" },
];

export function OverlaySelector() {
  const overlay = useRackStore((s) => s.overlay);
  const setOverlay = useRackStore((s) => s.setOverlay);

  return (
    <div className="btnrow">
      {overlays.map((o) => (
        <button
          key={o.id}
          className={`btn ${overlay === o.id ? "active" : ""}`}
          onClick={() => setOverlay(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
