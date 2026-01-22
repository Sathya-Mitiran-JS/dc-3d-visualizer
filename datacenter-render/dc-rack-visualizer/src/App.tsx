import { useEffect } from "react";
import { RackView3D } from "./RackView3D";
import { DetailsPanel } from "./DetailsPanel";
import { OverlaySelector } from "./OverlaySelector";
import { useRackStore } from "./store";
import { ViewControls } from "./ViewControls";
import { LogExportButtons } from "./LogExportButtons";


export default function App() {
  const startSim = useRackStore((s) => s.startSim);
  const stopSim = useRackStore((s) => s.stopSim);

  useEffect(() => {
    startSim();
    return () => stopSim();
  }, [startSim, stopSim]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__left">
          <div className="title">Data Center Rack Visualizer</div>
          <div className="subtitle">Fintech Lab digital twin</div>
        </div>

        <div className="topbar__right">
          <ViewControls />
          <OverlaySelector />
          <LogExportButtons />
        </div>
      </header>

      <div className="content">
        <div className="viewport">
          <RackView3D />
        </div>
        <aside className="sidebar">
          <DetailsPanel />
        </aside>
      </div>
    </div>
  );
}
