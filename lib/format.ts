/** Display formatting helpers (pure, UI-only). */
import type { Severity } from "./astro/types";

export function fmtPc(pc: number): string {
  if (pc <= 0) return "0";
  if (pc < 1e-12) return "<1e-12";
  return pc.toExponential(2);
}

export function fmtKm(km: number): string {
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  if (km < 100) return `${km.toFixed(2)} km`;
  return `${km.toFixed(0)} km`;
}

export function fmtDuration(ms: number): string {
  const s = Math.abs(ms) / 1000;
  const sign = ms < 0 ? "-" : "";
  if (s < 60) return `${sign}${s.toFixed(0)}s`;
  const m = s / 60;
  if (m < 60) return `${sign}${m.toFixed(0)}m`;
  const h = m / 60;
  if (h < 48) return `${sign}${h.toFixed(1)}h`;
  return `${sign}${(h / 24).toFixed(1)}d`;
}

export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  INFO: "#43e08a",
  WATCH: "#ffc94d",
  WARNING: "#ff8a3d",
  CRITICAL: "#ff3d71",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  INFO: "NOMINAL",
  WATCH: "WATCH",
  WARNING: "WARNING",
  CRITICAL: "CRITICAL",
};

export function typeLabel(code: number): string {
  return ["PAYLOAD", "ROCKET BODY", "DEBRIS", "UNKNOWN"][code] ?? "UNKNOWN";
}
