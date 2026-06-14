"use client";

/** Full-screen boot overlay shown while the catalog loads into the worker. */
export default function BootScreen() {
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-vacuum-900/95 backdrop-blur-sm">
      <div className="relative h-20 w-20">
        <div className="absolute inset-0 rounded-full border border-instrument/30" />
        <div className="absolute inset-0 animate-sweep rounded-full border-t-2 border-instrument" />
        <div className="absolute inset-3 rounded-full border border-instrument/20" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="h-2 w-2 animate-pulseRing rounded-full bg-instrument" />
        </div>
      </div>
      <div className="mt-8 text-center">
        <div className="font-mono text-sm tracking-[0.4em] text-instrument-soft">APSIS</div>
        <div className="eyebrow mt-2">Loading orbital catalog · SGP4 engine</div>
        <div className="readout mt-4 text-xs text-white/40">
          Propagating NORAD elements · initializing conjunction screening
        </div>
      </div>
    </div>
  );
}
