// Camera presets + cutaway button
import type { CameraPreset } from "./types";
import { useRackStore } from "./store";

const presets: { id: CameraPreset; label: string }[] = [
  { id: "iso", label: "Iso" },
  { id: "front", label: "Front" },
  { id: "back", label: "Back" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
];

export function ViewControls() {
  const cameraPreset = useRackStore((s) => s.cameraPreset);
  const setCameraPreset = useRackStore((s) => s.setCameraPreset);
  const cutaway = useRackStore((s) => s.cutaway);
  const toggleCutaway = useRackStore((s) => s.toggleCutaway);

  return (
    <div className="btnrow">
      {presets.map((p) => (
        <button
          key={p.id}
          className={`btn ${cameraPreset === p.id ? "active" : ""}`}
          onClick={() => setCameraPreset(p.id)}
        >
          {p.label}
        </button>
      ))}

      <button
        className={`btn ${cutaway ? "active" : ""}`}
        onClick={toggleCutaway}
        title="Hide the rack front door to see internal overlays"
      >
        Cutaway
      </button>
    </div>
  );
}
