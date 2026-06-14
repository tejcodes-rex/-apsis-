"use client";

/**
 * Shared, lazily-loaded catalog for the main thread. The engine worker owns the
 * authoritative copy for screening; this lighter copy lets UI components that
 * need full SpaceObjects (orbit-path sampling, encounter-plane analysis) work
 * without a worker round-trip. It loads the bundled snapshot exactly once.
 */
import { buildCatalog, type LoadedCatalog } from "../lib/astro/catalog";
import type { SpaceObject } from "../lib/astro/types";

let promise: Promise<LoadedCatalog> | null = null;

export function ensureClientCatalog(url = "/data/catalog.json"): Promise<LoadedCatalog> {
  if (!promise) {
    promise = fetch(url)
      .then((r) => r.json())
      .then((raw) => buildCatalog(raw));
  }
  return promise;
}

/** Synchronous lookup; returns undefined until the catalog has loaded. */
let cache: LoadedCatalog | null = null;
ensureClientCatalogThen((c) => (cache = c));

function ensureClientCatalogThen(cb: (c: LoadedCatalog) => void) {
  ensureClientCatalog().then(cb).catch(() => {});
}

export function getClientObject(id: number): SpaceObject | undefined {
  return cache?.byId.get(id);
}

export function clientCatalogReady(): boolean {
  return cache !== null;
}
