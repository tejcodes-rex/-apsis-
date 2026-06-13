/**
 * Catalog loading and indexing.
 *
 * The bundled snapshot (public/data/catalog.json) is real CelesTrak GP data.
 * A live refresh can replace it at runtime via loadCatalogFrom(url), but the
 * bundled copy guarantees the demo and screening run with zero network calls.
 */
import { summarize } from "./sgp4";
import type { ObjectType, SpaceObject, TLE } from "./types";

export interface CatalogMeta {
  generatedAtIso: string;
  source: string;
  objectCount: number;
  typeCounts: Record<string, number>;
}

interface RawEntry {
  noradId: number;
  name: string;
  line1: string;
  line2: string;
  type: ObjectType;
  tag: string;
}

interface RawCatalog extends CatalogMeta {
  objects: RawEntry[];
}

export interface LoadedCatalog {
  meta: CatalogMeta;
  objects: SpaceObject[];
  byId: Map<number, SpaceObject>;
}

function build(raw: RawCatalog): LoadedCatalog {
  const objects: SpaceObject[] = [];
  const byId = new Map<number, SpaceObject>();
  for (const e of raw.objects) {
    const tle: TLE = {
      noradId: e.noradId,
      name: e.name,
      line1: e.line1,
      line2: e.line2,
      type: e.type,
      operator: e.tag,
    };
    try {
      const orbit = summarize(tle);
      // Drop entries SGP4 cannot characterise (malformed/decayed elements).
      if (!isFinite(orbit.periodMin) || orbit.perigeeKm < -200) continue;
      const obj: SpaceObject = { tle, orbit };
      objects.push(obj);
      byId.set(e.noradId, obj);
    } catch {
      // Skip un-parseable element sets rather than fail the whole load.
    }
  }
  return {
    meta: {
      generatedAtIso: raw.generatedAtIso,
      source: raw.source,
      objectCount: objects.length,
      typeCounts: raw.typeCounts,
    },
    objects,
    byId,
  };
}

/** Load the catalog from a URL (defaults to the bundled snapshot). */
export async function loadCatalog(url = "/data/catalog.json"): Promise<LoadedCatalog> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load catalog: HTTP ${res.status}`);
  const raw = (await res.json()) as RawCatalog;
  return build(raw);
}

/** Build a catalog directly from an already-parsed object (used in tests/workers). */
export function buildCatalog(raw: RawCatalog): LoadedCatalog {
  return build(raw);
}
