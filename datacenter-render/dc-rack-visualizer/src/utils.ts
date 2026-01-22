import type { Severity } from "./types";

export function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

// deterministic PRNG (seeded) for stable fake data
export function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function severityColor(sev: Severity) {
  // Used for mesh colors + badges
  switch (sev) {
    case "ok":
      return "#22c55e";
    case "warn":
      return "#f59e0b";
    case "crit":
      return "#ef4444";
    default:
      return "#94a3b8";
  }
}

export function fmt(val: number | null, unit: string) {
  if (val === null || Number.isNaN(val)) return "na";
  return `${val.toFixed(0)} ${unit}`;
}

export function fmt1(val: number | null, unit: string) {
  if (val === null || Number.isNaN(val)) return "na";
  return `${val.toFixed(1)} ${unit}`;
}
