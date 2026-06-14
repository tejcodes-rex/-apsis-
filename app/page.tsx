"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useApp } from "./store";
import BootScreen from "../components/BootScreen";

// The globe touches the DOM/WebGL directly, so render it client-only.
const Globe = dynamic(() => import("../components/Globe"), { ssr: false });
// The dashboard renders live, time-based readouts; render it client-only so the
// server never emits a clock value the client then has to reconcile.
const Dashboard = dynamic(() => import("../components/Dashboard"), { ssr: false });

export default function Page() {
  const initEngine = useApp((s) => s.initEngine);
  const ready = useApp((s) => s.ready);

  useEffect(() => {
    initEngine();
  }, [initEngine]);

  // Simulation clock: advances sim time and throttles position requests so the
  // worker propagates the full catalog ~12x per second without flooding.
  const lastReal = useRef<number>(0);
  const lastPropagate = useRef<number>(0);
  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const s = useApp.getState();
      if (lastReal.current === 0) lastReal.current = t;
      const dtReal = (t - lastReal.current) / 1000;
      lastReal.current = t;
      if (s.playing) {
        useApp.setState({ simTimeMs: s.simTimeMs + dtReal * 1000 * s.timeScale });
      }
      if (t - lastPropagate.current > 80) {
        lastPropagate.current = t;
        s.requestPropagate();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <Globe />
      <Dashboard />
      {!ready && <BootScreen />}
    </main>
  );
}
