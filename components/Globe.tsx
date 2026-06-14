"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as sat from "satellite.js";
import { useApp } from "../app/store";
import { ensureClientCatalog, getClientObject } from "../app/clientCatalog";
import { sampleOrbit, sampleManeuveredArc } from "../lib/astro/orbitpath";
import { R_EARTH_WGS84 } from "../lib/astro/constants";

const SCALE = 1 / 1000; // km -> scene units
const EARTH_R = R_EARTH_WGS84 * SCALE;

// Type colours (payload, rocket body, debris, unknown).
const TYPE_COLORS = [
  new THREE.Color("#4fd6ff"),
  new THREE.Color("#ffc94d"),
  new THREE.Color("#ff7a4d"),
  new THREE.Color("#8aa0b8"),
];
const PRIMARY_COLOR = new THREE.Color("#5dffa8");
const SECONDARY_COLOR = new THREE.Color("#ff3d71");

const POINT_VERT = `
  attribute float size;
  attribute vec3 pcolor;
  varying vec3 vColor;
  void main() {
    vColor = pcolor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = `
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(vColor, glow);
  }
`;

const ATMO_VERT = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const ATMO_FRAG = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = 1.0 - max(dot(vNormal, vView), 0.0);
    float intensity = pow(rim, 3.0);
    gl_FragColor = vec4(0.31, 0.84, 1.0, intensity * 0.9);
  }
`;

export default function Globe() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    ensureClientCatalog(); // start loading the shared catalog for path/analysis lookups

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(0, 8, 26);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = EARTH_R + 1.5;
    controls.maxDistance = 120;
    controls.rotateSpeed = 0.5;

    // --- Earth group (rotated by GMST so ECI points sit correctly) ---
    const earthGroup = new THREE.Group();
    scene.add(earthGroup);

    const earthMat = new THREE.MeshBasicMaterial({ color: 0x0a1426 });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 64, 48), earthMat);
    earthGroup.add(earth);

    // Graticule (lat/long grid) for the holographic look.
    const grat = new THREE.LineSegments(
      graticuleGeometry(EARTH_R * 1.001),
      new THREE.LineBasicMaterial({ color: 0x2b6fa0, transparent: true, opacity: 0.5 }),
    );
    earthGroup.add(grat);

    // Atmosphere shell.
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R * 1.025, 64, 48),
      new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    );
    scene.add(atmo);

    // Starfield backdrop.
    scene.add(starfield());

    // --- Object point cloud (filled when meta arrives) ---
    let points: THREE.Points | null = null;
    let baseColors: Float32Array | null = null;
    let sizes: Float32Array | null = null;

    // Lines: primary orbit, secondary orbit, maneuvered arc.
    const primaryOrbit = makeLine(0x5dffa8, 0.7);
    const secondaryOrbit = makeLine(0xff3d71, 0.45);
    const maneuverArc = makeLine(0x7ee4ff, 0.95);
    earthGroup.add(primaryOrbit.line, secondaryOrbit.line, maneuverArc.line);
    // Markers for primary & secondary (rings).
    const primaryRing = makeRing(0x5dffa8);
    const secondaryRing = makeRing(0xff3d71);
    scene.add(primaryRing, secondaryRing);

    function buildPoints(count: number, types: Uint8Array) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      baseColors = new Float32Array(count * 3);
      sizes = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const c = TYPE_COLORS[types[i]] ?? TYPE_COLORS[3];
        baseColors[i * 3] = c.r;
        baseColors[i * 3 + 1] = c.g;
        baseColors[i * 3 + 2] = c.b;
        sizes[i] = types[i] === 2 ? 1.5 : 2.2; // debris a touch smaller
      }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("pcolor", new THREE.BufferAttribute(baseColors.slice(), 3));
      geo.setAttribute("size", new THREE.BufferAttribute(sizes.slice(), 1));
      const mat = new THREE.ShaderMaterial({
        vertexShader: POINT_VERT,
        fragmentShader: POINT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      earthGroup.add(points);
    }

    // Resize handling.
    function resize() {
      const w = mount!.clientWidth;
      const h = mount!.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // Recompute orbit/arc lines when selection changes.
    let lastSig = "";
    function refreshLines() {
      const s = useApp.getState();
      if (!s.objects || s.primaryId == null) return;
      const idx = indexOfId(s.objects.ids, s.primaryId);
      if (idx < 0) return;
      const conj = s.conjunctions[s.selectedConjunctionIndex];
      const sig = `${s.primaryId}|${conj?.secondaryId ?? "-"}|${s.maneuver ? s.maneuver.deltaVmagMps.toFixed(4) : "-"}`;
      if (sig === lastSig) return;
      lastSig = sig;

      const primaryObj = getClientObject(s.primaryId);
      if (!primaryObj) {
        lastSig = ""; // retry once cache hydrates
        return;
      }
      const orbit = sampleOrbit(primaryObj, s.baseTimeMs, 300);
      setLine(primaryOrbit, orbit);

      if (conj) {
        const secObj = getClientObject(conj.secondaryId);
        if (secObj) {
          setLine(secondaryOrbit, sampleOrbit(secObj, s.baseTimeMs, 300));
        }
      } else {
        setLine(secondaryOrbit, new Float32Array(0));
      }

      if (s.maneuver && conj) {
        const burnMs = conj.tcaMs - s.maneuver.leadTimeSec * 1000;
        const arc = sampleManeuveredArc(
          primaryObj,
          burnMs,
          s.maneuver.deltaVricMps,
          s.maneuver.leadTimeSec + 600,
          240,
        );
        setLine(maneuverArc, arc);
      } else {
        setLine(maneuverArc, new Float32Array(0));
      }
    }

    const unsub = useApp.subscribe(() => refreshLines());

    // --- Render loop ---
    let raf = 0;
    const tmp = new THREE.Vector3();
    function frame() {
      raf = requestAnimationFrame(frame);
      const s = useApp.getState();

      // Build points once meta is ready.
      if (!points && s.objects) buildPoints(s.objects.count, s.objects.types);

      // Rotate Earth to GMST so ECI positions register with the surface.
      const gmst = sat.gstime(new Date(s.simTimeMs));
      earthGroup.rotation.y = gmst;

      // Stream positions into the point cloud.
      if (points && s.positions) {
        const attr = points.geometry.getAttribute("position") as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        const n = Math.min(arr.length, s.positions.length);
        for (let i = 0; i < n; i++) arr[i] = s.positions[i] * SCALE;
        attr.needsUpdate = true;

        // Highlight primary & secondary, place rings.
        const colAttr = points.geometry.getAttribute("pcolor") as THREE.BufferAttribute;
        const sizeAttr = points.geometry.getAttribute("size") as THREE.BufferAttribute;
        if (baseColors && sizes) {
          // reset previous highlight cheaply by restoring from base each frame
          (colAttr.array as Float32Array).set(baseColors);
          (sizeAttr.array as Float32Array).set(sizes);
          const pIdx = indexOfId(s.objects!.ids, s.primaryId ?? -1);
          if (pIdx >= 0) {
            writeColor(colAttr.array as Float32Array, pIdx, PRIMARY_COLOR);
            (sizeAttr.array as Float32Array)[pIdx] = 6;
            tmp.set(arr[pIdx * 3], arr[pIdx * 3 + 1], arr[pIdx * 3 + 2]);
            tmp.applyEuler(earthGroup.rotation);
            primaryRing.position.copy(tmp);
            primaryRing.visible = true;
          }
          const conj = s.conjunctions[s.selectedConjunctionIndex];
          if (conj) {
            const sIdx = indexOfId(s.objects!.ids, conj.secondaryId);
            if (sIdx >= 0) {
              writeColor(colAttr.array as Float32Array, sIdx, SECONDARY_COLOR);
              (sizeAttr.array as Float32Array)[sIdx] = 6;
              tmp.set(arr[sIdx * 3], arr[sIdx * 3 + 1], arr[sIdx * 3 + 2]);
              tmp.applyEuler(earthGroup.rotation);
              secondaryRing.position.copy(tmp);
              secondaryRing.visible = true;
            }
          } else {
            secondaryRing.visible = false;
          }
          colAttr.needsUpdate = true;
          sizeAttr.needsUpdate = true;
        }
      }

      const t = performance.now() * 0.004;
      primaryRing.scale.setScalar(1 + Math.sin(t) * 0.12);
      secondaryRing.scale.setScalar(1 + Math.sin(t + 1) * 0.18);
      primaryRing.lookAt(camera.position);
      secondaryRing.lookAt(camera.position);

      controls.update();
      renderer.render(scene, camera);
    }
    frame();

    return () => {
      cancelAnimationFrame(raf);
      unsub();
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className="absolute inset-0" />;
}

// ---------- helpers ----------

function indexOfId(ids: Int32Array, id: number): number {
  for (let i = 0; i < ids.length; i++) if (ids[i] === id) return i;
  return -1;
}

function writeColor(arr: Float32Array, idx: number, c: THREE.Color) {
  arr[idx * 3] = c.r;
  arr[idx * 3 + 1] = c.g;
  arr[idx * 3 + 2] = c.b;
}

function makeLine(color: number, opacity: number) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  return { line, geo };
}

function setLine(l: { line: THREE.Line; geo: THREE.BufferGeometry }, ptsKm: Float32Array) {
  const scaled = new Float32Array(ptsKm.length);
  for (let i = 0; i < ptsKm.length; i++) scaled[i] = ptsKm[i] * SCALE;
  l.geo.setAttribute("position", new THREE.BufferAttribute(scaled, 3));
  l.geo.computeBoundingSphere();
}

function makeRing(color: number) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.62, 32),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  );
  ring.visible = false;
  return ring;
}

function graticuleGeometry(r: number): THREE.BufferGeometry {
  const pts: number[] = [];
  const seg = 64;
  for (let lat = -60; lat <= 60; lat += 30) {
    const phi = (lat * Math.PI) / 180;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const b = ((i + 1) / seg) * Math.PI * 2;
      pts.push(
        r * Math.cos(phi) * Math.cos(a), r * Math.sin(phi), r * Math.cos(phi) * Math.sin(a),
        r * Math.cos(phi) * Math.cos(b), r * Math.sin(phi), r * Math.cos(phi) * Math.sin(b),
      );
    }
  }
  for (let lon = 0; lon < 360; lon += 30) {
    const th = (lon * Math.PI) / 180;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI - Math.PI / 2;
      const b = ((i + 1) / seg) * Math.PI - Math.PI / 2;
      pts.push(
        r * Math.cos(a) * Math.cos(th), r * Math.sin(a), r * Math.cos(a) * Math.sin(th),
        r * Math.cos(b) * Math.cos(th), r * Math.sin(b), r * Math.cos(b) * Math.sin(th),
      );
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function starfield(): THREE.Points {
  const n = 1400;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 400 + Math.random() * 600;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    g,
    new THREE.PointsMaterial({ color: 0x6b8299, size: 0.6, sizeAttenuation: false, transparent: true, opacity: 0.7 }),
  );
}
