/**
 * Build the bundled orbital catalog from live CelesTrak GP data.
 *
 * APSIS works against a real NORAD-derived catalog. To keep the demo fully
 * reproducible and network-independent we snapshot a curated set of groups into
 * public/data/catalog.json. The groups are chosen deliberately:
 *   - operational assets we protect (stations, active payloads, Starlink shell)
 *   - the three most consequential debris clouds in the public catalog:
 *       Iridium-33 / Cosmos-2251  (2009 accidental hypervelocity collision)
 *       Fengyun-1C                (2007 anti-satellite test)
 *       Cosmos-1408               (2021 anti-satellite test)
 *     These clouds are the real-world reason space traffic management exists.
 *
 * Run: npm run data:refresh
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

interface SourceGroup {
  group: string;
  /** Tag we attach to every object from this group for provenance/colour. */
  tag: string;
  /** Optional cap to keep large shells from dominating the snapshot. */
  cap?: number;
}

const SOURCES: SourceGroup[] = [
  { group: "stations", tag: "STATION" },
  { group: "active", tag: "ACTIVE", cap: 6500 },
  { group: "starlink", tag: "STARLINK", cap: 800 },
  { group: "last-30-days", tag: "RECENT", cap: 400 },
  { group: "cosmos-1408-debris", tag: "ASAT_2021" },
  { group: "fengyun-1c-debris", tag: "ASAT_2007", cap: 900 },
  { group: "iridium-33-debris", tag: "COLLISION_2009" },
  { group: "cosmos-2251-debris", tag: "COLLISION_2009", cap: 900 },
];

type ObjectType = "PAYLOAD" | "ROCKET_BODY" | "DEBRIS" | "UNKNOWN";

interface CatalogEntry {
  noradId: number;
  name: string;
  line1: string;
  line2: string;
  type: ObjectType;
  tag: string;
}

function classify(name: string): ObjectType {
  const n = name.toUpperCase();
  if (n.includes("DEB") || n.includes("DEBRIS") || n.includes("FRAG")) return "DEBRIS";
  if (n.includes("R/B") || n.includes("ROCKET") || n.includes("AKM") || n.includes("PKM")) return "ROCKET_BODY";
  return "PAYLOAD";
}

async function fetchGroup(src: SourceGroup): Promise<CatalogEntry[]> {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${src.group}&FORMAT=tle`;
  const res = await fetch(url, { headers: { "User-Agent": "APSIS/1.0 (space traffic management research)" } });
  if (!res.ok) throw new Error(`${src.group}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: CatalogEntry[] = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const name = lines[i]?.trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!name || !line1?.startsWith("1 ") || !line2?.startsWith("2 ")) continue;
    const noradId = parseInt(line1.slice(2, 7), 10);
    if (!Number.isFinite(noradId)) continue;
    out.push({ noradId, name, line1, line2, type: classify(name), tag: src.tag });
    if (src.cap && out.length >= src.cap) break;
  }
  return out;
}

async function main() {
  const byId = new Map<number, CatalogEntry>();
  for (const src of SOURCES) {
    try {
      const entries = await fetchGroup(src);
      let added = 0;
      for (const e of entries) {
        // First writer wins, but debris/collision tags override generic "ACTIVE"
        // so provenance survives even when an object appears in two groups.
        const existing = byId.get(e.noradId);
        if (!existing) {
          byId.set(e.noradId, e);
          added++;
        } else if (existing.tag === "ACTIVE" && e.tag !== "ACTIVE") {
          byId.set(e.noradId, e);
        }
      }
      console.log(`  ${src.group.padEnd(22)} fetched ${entries.length}, +${added} new`);
    } catch (err) {
      console.warn(`  ${src.group.padEnd(22)} FAILED: ${(err as Error).message}`);
    }
  }

  const catalog = Array.from(byId.values()).sort((a, b) => a.noradId - b.noradId);
  const counts = catalog.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {});

  const payload = {
    generatedAtIso: new Date().toISOString(),
    source: "CelesTrak GP (NORAD)",
    objectCount: catalog.length,
    typeCounts: counts,
    objects: catalog,
  };

  const dir = join(process.cwd(), "public", "data");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "catalog.json"), JSON.stringify(payload));
  console.log(`\nWrote ${catalog.length} objects to public/data/catalog.json`);
  console.log("Type breakdown:", counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
