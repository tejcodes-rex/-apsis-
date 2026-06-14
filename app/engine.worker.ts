/**
 * Engine worker.
 *
 * All astrodynamics runs off the main thread so the 3D view never drops frames.
 * The worker owns the catalog and answers four kinds of request:
 *   init        -> load the catalog, return lightweight metadata for the UI
 *   propagate   -> ECI positions of every object at a time (transferable buffer)
 *   screen      -> conjunctions for one protected asset vs the whole catalog
 *   plan        -> the autonomous avoidance maneuver for a conjunction
 *   screenAll   -> full all-pairs sieve over a chosen shell
 */
import { buildCatalog, type LoadedCatalog } from "../lib/astro/catalog";
import { propagate } from "../lib/astro/sgp4";
import { screenPrimary } from "../lib/conjunction/screening";
import { screenAllPairs } from "../lib/conjunction/sieve";
import { planAvoidance } from "../lib/maneuver/optimizer";
import type { Conjunction } from "../lib/astro/types";

let catalog: LoadedCatalog | null = null;

const TYPE_CODE: Record<string, number> = {
  PAYLOAD: 0,
  ROCKET_BODY: 1,
  DEBRIS: 2,
  UNKNOWN: 3,
};

type Req =
  | { kind: "init"; url?: string }
  | { kind: "propagate"; timeMs: number; reqId: number }
  | { kind: "screen"; primaryId: number; nowMs: number; windowHours: number; gateKm: number; reqId: number }
  | {
      kind: "plan";
      primaryId: number;
      secondaryId: number;
      conjunction: Conjunction;
      nowMs: number;
      targetPc?: number;
      reqId: number;
    }
  | { kind: "screenAll"; minAltKm: number; maxAltKm: number; windowHours: number; nowMs?: number; reqId: number }
  | {
      kind: "screenFleet";
      operatorTags: string[];
      maxAssets: number;
      nowMs: number;
      windowHours: number;
      reqId: number;
    };

self.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data;

  if (msg.kind === "init") {
    const res = await fetch(msg.url ?? "/data/catalog.json");
    const raw = await res.json();
    catalog = buildCatalog(raw);
    const n = catalog.objects.length;
    // Stable per-object arrays the UI keeps for the session.
    const ids = new Int32Array(n);
    const types = new Uint8Array(n);
    const names: string[] = new Array(n);
    const operators: string[] = new Array(n);
    const apogee = new Float32Array(n);
    const perigee = new Float32Array(n);
    const incl = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = catalog.objects[i];
      ids[i] = o.tle.noradId;
      types[i] = TYPE_CODE[o.tle.type] ?? 3;
      names[i] = o.tle.name;
      operators[i] = o.tle.operator ?? "UNKNOWN";
      apogee[i] = o.orbit.apogeeKm;
      perigee[i] = o.orbit.perigeeKm;
      incl[i] = o.orbit.inclinationDeg;
    }
    (self as unknown as Worker).postMessage(
      {
        kind: "init:done",
        meta: catalog.meta,
        count: n,
        ids,
        types,
        names,
        operators,
        apogee,
        perigee,
        incl,
      },
      [ids.buffer, types.buffer, apogee.buffer, perigee.buffer, incl.buffer],
    );
    return;
  }

  if (!catalog) {
    // A request arrived before the catalog finished loading. Still post the
    // matching terminal message so the UI never gets stuck waiting on a response.
    const w = self as unknown as Worker;
    switch (msg.kind) {
      case "propagate":
        w.postMessage({ kind: "propagate:done", reqId: msg.reqId, timeMs: msg.timeMs, pos: new Float32Array(0), alive: new Uint8Array(0) });
        break;
      case "screen":
        w.postMessage({ kind: "screen:done", reqId: msg.reqId, conjunctions: [] });
        break;
      case "plan":
        w.postMessage({ kind: "plan:done", reqId: msg.reqId, secondaryId: msg.secondaryId, maneuver: null });
        break;
      case "screenFleet":
        w.postMessage({ kind: "screenFleet:done", reqId: msg.reqId, board: [], fleetSize: 0, sampled: 0 });
        break;
      case "screenAll":
        w.postMessage({ kind: "screenAll:done", reqId: msg.reqId, conjunctions: [], shellCount: 0 });
        break;
    }
    return;
  }

  if (msg.kind === "propagate") {
    const n = catalog.objects.length;
    const pos = new Float32Array(n * 3);
    const alive = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const st = propagate(catalog.objects[i].tle, msg.timeMs);
      if (st) {
        pos[i * 3] = st.position[0];
        pos[i * 3 + 1] = st.position[1];
        pos[i * 3 + 2] = st.position[2];
        alive[i] = 1;
      }
    }
    (self as unknown as Worker).postMessage({ kind: "propagate:done", reqId: msg.reqId, timeMs: msg.timeMs, pos, alive }, [
      pos.buffer,
      alive.buffer,
    ]);
    return;
  }

  if (msg.kind === "screen") {
    // Always post a terminal message (even empty) so the UI never gets stuck in
    // the "screening" state if the asset is missing or the call throws.
    let conjunctions: Conjunction[] = [];
    const primary = catalog.byId.get(msg.primaryId);
    if (primary) {
      try {
        conjunctions = screenPrimary(primary, catalog.objects, msg.nowMs, {
          windowHours: msg.windowHours,
          gateKm: msg.gateKm,
        });
      } catch {
        conjunctions = [];
      }
    }
    (self as unknown as Worker).postMessage({ kind: "screen:done", reqId: msg.reqId, conjunctions });
    return;
  }

  if (msg.kind === "plan") {
    let maneuver = null;
    const primary = catalog.byId.get(msg.primaryId);
    const secondary = catalog.byId.get(msg.secondaryId);
    if (primary && secondary) {
      try {
        maneuver = planAvoidance(primary, secondary, msg.conjunction, msg.nowMs, {
          targetPc: msg.targetPc,
        });
      } catch {
        maneuver = null;
      }
    }
    (self as unknown as Worker).postMessage({ kind: "plan:done", reqId: msg.reqId, secondaryId: msg.secondaryId, maneuver });
    return;
  }

  if (msg.kind === "screenFleet") {
    const board: {
      assetId: number;
      name: string;
      worstPc: number;
      count: number;
      worstSecondary: string;
    }[] = [];
    let fleetSize = 0;
    let sampled = 0;
    try {
      const tags = new Set(msg.operatorTags);
      // Spread the sample across the fleet rather than taking the first N in id
      // order, so the board reflects the whole constellation.
      const fleet = catalog.objects.filter((o) => o.tle.type === "PAYLOAD" && tags.has(o.tle.operator ?? ""));
      fleetSize = fleet.length;
      const step = Math.max(1, Math.floor(fleet.length / msg.maxAssets));
      const sample = fleet.filter((_, i) => i % step === 0).slice(0, msg.maxAssets);
      sampled = sample.length;
      for (let i = 0; i < sample.length; i++) {
        const asset = sample[i];
        const conjunctions = screenPrimary(asset, catalog.objects, msg.nowMs, {
          windowHours: msg.windowHours,
          gateKm: 20,
        });
        const worst = conjunctions[0];
        board.push({
          assetId: asset.tle.noradId,
          name: asset.tle.name,
          // Only a valid Foster conjunction counts as a real risk score.
          worstPc: worst && worst.fosterValid ? worst.pc : 0,
          count: conjunctions.length,
          worstSecondary: worst?.secondaryName ?? "none",
        });
        (self as unknown as Worker).postMessage({
          kind: "screenFleet:progress",
          reqId: msg.reqId,
          fraction: (i + 1) / sample.length,
        });
      }
      board.sort((a, b) => b.worstPc - a.worstPc);
    } catch {
      /* fall through and post whatever we have */
    }
    (self as unknown as Worker).postMessage({
      kind: "screenFleet:done",
      reqId: msg.reqId,
      board,
      fleetSize,
      sampled,
    });
    return;
  }

  if (msg.kind === "screenAll") {
    let conjunctions: Conjunction[] = [];
    let shellCount = 0;
    try {
      const shell = catalog.objects.filter((o) => {
        const a = (o.orbit.apogeeKm + o.orbit.perigeeKm) / 2;
        return a >= msg.minAltKm && a <= msg.maxAltKm;
      });
      shellCount = shell.length;
      conjunctions = screenAllPairs(shell, msg.nowMs ?? Date.now(), {
        windowHours: msg.windowHours,
        onProgress: (fraction, phase) =>
          (self as unknown as Worker).postMessage({ kind: "screenAll:progress", reqId: msg.reqId, fraction, phase }),
      });
    } catch {
      conjunctions = [];
    }
    (self as unknown as Worker).postMessage({ kind: "screenAll:done", reqId: msg.reqId, conjunctions, shellCount });
    return;
  }
};
