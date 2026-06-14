"use client";

import { create } from "zustand";
import type { Conjunction, Maneuver } from "../lib/astro/types";
import type { CatalogMeta } from "../lib/astro/catalog";

export interface ObjectMeta {
  count: number;
  ids: Int32Array;
  types: Uint8Array; // 0 payload,1 rocket,2 debris,3 unknown
  names: string[];
  operators: string[];
  apogee: Float32Array;
  perigee: Float32Array;
  incl: Float32Array;
}

export interface FeaturedEvent extends Conjunction {}

interface AppState {
  worker: Worker | null;
  ready: boolean;
  meta: CatalogMeta | null;
  objects: ObjectMeta | null;

  positions: Float32Array | null;
  alive: Uint8Array | null;
  posTimeMs: number;

  // Simulation clock
  simTimeMs: number;
  baseTimeMs: number; // anchor (catalog "now")
  playing: boolean;
  timeScale: number; // sim seconds per real second

  // Selection / analysis
  primaryId: number | null;
  conjunctions: Conjunction[];
  selectedConjunctionIndex: number;
  maneuver: Maneuver | null;
  screening: boolean;
  planning: boolean;

  featured: FeaturedEvent[];
  globalScan: { running: boolean; fraction: number; phase: string; results: Conjunction[] };
  fleetScan: {
    running: boolean;
    fraction: number;
    operator: string;
    fleetSize: number;
    sampled: number;
    board: { assetId: number; name: string; worstPc: number; count: number; worstSecondary: string }[];
  };

  pendingFocusSecondary: number | null;

  initEngine: () => void;
  setPrimary: (id: number) => void;
  loadFeatured: (event: Conjunction) => void;
  typeOf: (id: number) => number;
  runScreen: () => void;
  selectConjunction: (index: number) => void;
  planSelected: () => void;
  setPlaying: (p: boolean) => void;
  setTimeScale: (s: number) => void;
  setSimTime: (ms: number) => void;
  requestPropagate: () => void;
  runGlobalScan: (minAltKm: number, maxAltKm: number, windowHours: number) => void;
  runFleetScan: (operator: string, operatorTags: string[], maxAssets: number, windowHours: number) => void;
}

let reqCounter = 1;
let lastPropagateReq = 0;
let lastScreenReq = 0;
let lastPlanSecondary = -1;

export const useApp = create<AppState>((set, get) => ({
  worker: null,
  ready: false,
  meta: null,
  objects: null,
  positions: null,
  alive: null,
  posTimeMs: 0,
  simTimeMs: Date.now(),
  baseTimeMs: Date.now(),
  playing: true,
  timeScale: 60,
  primaryId: null,
  conjunctions: [],
  selectedConjunctionIndex: 0,
  maneuver: null,
  screening: false,
  planning: false,
  featured: [],
  globalScan: { running: false, fraction: 0, phase: "", results: [] },
  fleetScan: { running: false, fraction: 0, operator: "", fleetSize: 0, sampled: 0, board: [] },
  pendingFocusSecondary: null,

  initEngine: () => {
    if (get().worker) return;
    const worker = new Worker(new URL("./engine.worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      switch (m.kind) {
        case "init:done": {
          const objects: ObjectMeta = {
            count: m.count,
            ids: m.ids,
            types: m.types,
            names: m.names,
            operators: m.operators,
            apogee: m.apogee,
            perigee: m.perigee,
            incl: m.incl,
          };
          set({ ready: true, meta: m.meta, objects });
          // Default protected asset: the ISS if present, else first payload.
          const issIdx = m.names.findIndex((n: string) => n.includes("ISS"));
          const idx = issIdx >= 0 ? issIdx : 0;
          get().setPrimary(m.ids[idx]);
          get().requestPropagate();
          get().runScreen();
          break;
        }
        case "propagate:done": {
          if (m.reqId >= lastPropagateReq) {
            set({ positions: m.pos, alive: m.alive, posTimeMs: m.timeMs });
          }
          break;
        }
        case "screen:done": {
          // Drop a stale screen result so a slow earlier request cannot overwrite
          // the watchlist for a newer protected asset (rapid selection race).
          if (m.reqId < lastScreenReq) break;
          const focus = get().pendingFocusSecondary;
          let selIdx = 0;
          if (focus != null) {
            const found = m.conjunctions.findIndex((c: Conjunction) => c.secondaryId === focus);
            if (found >= 0) selIdx = found;
          }
          set({
            screening: false,
            conjunctions: m.conjunctions,
            selectedConjunctionIndex: selIdx,
            maneuver: null,
            pendingFocusSecondary: null,
          });
          break;
        }
        case "plan:done": {
          // Ignore a maneuver that arrives after the selection moved on, so we
          // never show one conjunction's burn against a different conjunction.
          const cur = get().conjunctions[get().selectedConjunctionIndex];
          if (!cur || cur.secondaryId !== lastPlanSecondary) {
            set({ planning: false });
            break;
          }
          set({ planning: false, maneuver: m.maneuver });
          break;
        }
        case "screenAll:progress": {
          set((s) => ({ globalScan: { ...s.globalScan, fraction: m.fraction, phase: m.phase } }));
          break;
        }
        case "screenAll:done": {
          set((s) => ({
            globalScan: { ...s.globalScan, running: false, fraction: 1, results: m.conjunctions },
          }));
          break;
        }
        case "screenFleet:progress": {
          set((s) => ({ fleetScan: { ...s.fleetScan, fraction: m.fraction } }));
          break;
        }
        case "screenFleet:done": {
          set((s) => ({
            fleetScan: {
              ...s.fleetScan,
              running: false,
              fraction: 1,
              board: m.board,
              fleetSize: m.fleetSize,
              sampled: m.sampled,
            },
          }));
          break;
        }
      }
    };
    set({ worker });

    // Load precomputed featured events first so we can anchor the mission clock
    // to the same snapshot epoch the events were screened from. This keeps the
    // probabilities the app computes live identical to the featured values
    // (otherwise wall-clock drift past the element epoch would change them).
    fetch("/data/featured-events.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.screenedFromEpochMs) {
          set({ baseTimeMs: d.screenedFromEpochMs, simTimeMs: d.screenedFromEpochMs });
        }
        if (d?.events) set({ featured: d.events });
      })
      .catch(() => {})
      .finally(() => worker.postMessage({ kind: "init" }));
  },

  setPrimary: (id) => {
    set({ primaryId: id, maneuver: null });
  },

  typeOf: (id) => {
    const o = get().objects;
    if (!o) return 3;
    for (let i = 0; i < o.ids.length; i++) if (o.ids[i] === id) return o.types[i];
    return 3;
  },

  loadFeatured: (event) => {
    // Decide which side to protect. Prefer the operationally active object (an
    // asset we would actually maneuver) over a debris fragment, using the catalog
    // provenance tag, then fall back to object class.
    const o = get().objects;
    const ACTIVE = new Set(["ACTIVE", "STARLINK", "RECENT", "STATION"]);
    const operatorOf = (id: number) => {
      if (!o) return "UNKNOWN";
      for (let i = 0; i < o.ids.length; i++) if (o.ids[i] === id) return o.operators[i];
      return "UNKNOWN";
    };
    const typeOf = get().typeOf;
    const score = (id: number) => (ACTIVE.has(operatorOf(id)) ? 2 : 0) + (typeOf(id) === 0 ? 1 : 0);
    const protectPrimary = score(event.primaryId) >= score(event.secondaryId);
    const protectedId = protectPrimary ? event.primaryId : event.secondaryId;
    const threatId = protectPrimary ? event.secondaryId : event.primaryId;
    set({ pendingFocusSecondary: threatId, maneuver: null });
    get().setPrimary(protectedId);
    get().runScreen();
  },

  runScreen: () => {
    const { worker, primaryId, baseTimeMs } = get();
    if (!worker || primaryId == null) return;
    set({ screening: true, conjunctions: [], maneuver: null });
    const reqId = reqCounter++;
    lastScreenReq = reqId;
    worker.postMessage({
      kind: "screen",
      primaryId,
      nowMs: baseTimeMs,
      windowHours: 48,
      gateKm: 25,
      reqId,
    });
  },

  selectConjunction: (index) => set({ selectedConjunctionIndex: index, maneuver: null }),

  planSelected: () => {
    const { worker, conjunctions, selectedConjunctionIndex, primaryId, baseTimeMs } = get();
    const c = conjunctions[selectedConjunctionIndex];
    if (!worker || !c || primaryId == null) return;
    set({ planning: true, maneuver: null });
    lastPlanSecondary = c.secondaryId;
    // Manual planning always yields a result: drive probability below the safe
    // line if it is above it, otherwise compute a precautionary burn that cuts
    // the current probability by two orders of magnitude.
    const targetPc = Math.min(1e-5, c.pc / 100);
    worker.postMessage({
      kind: "plan",
      primaryId,
      secondaryId: c.secondaryId,
      conjunction: c,
      nowMs: baseTimeMs,
      targetPc,
      reqId: reqCounter++,
    });
  },

  setPlaying: (p) => set({ playing: p }),
  setTimeScale: (s) => set({ timeScale: s }),
  setSimTime: (ms) => set({ simTimeMs: ms }),

  requestPropagate: () => {
    const { worker, simTimeMs } = get();
    if (!worker) return;
    const reqId = reqCounter++;
    lastPropagateReq = reqId;
    worker.postMessage({ kind: "propagate", timeMs: simTimeMs, reqId });
  },

  runGlobalScan: (minAltKm, maxAltKm, windowHours) => {
    const { worker, baseTimeMs } = get();
    if (!worker) return;
    set({ globalScan: { running: true, fraction: 0, phase: "starting", results: [] } });
    worker.postMessage({
      kind: "screenAll",
      minAltKm,
      maxAltKm,
      windowHours,
      nowMs: baseTimeMs,
      reqId: reqCounter++,
    });
  },

  runFleetScan: (operator, operatorTags, maxAssets, windowHours) => {
    const { worker, baseTimeMs } = get();
    if (!worker) return;
    set({
      fleetScan: { running: true, fraction: 0, operator, fleetSize: 0, sampled: 0, board: [] },
    });
    worker.postMessage({
      kind: "screenFleet",
      operatorTags,
      maxAssets,
      nowMs: baseTimeMs,
      windowHours,
      reqId: reqCounter++,
    });
  },
}));
