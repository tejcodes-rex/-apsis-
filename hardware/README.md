# APSIS Ground Node — Receiver Reference Design

The APSIS Ground Node is a low cost, GPS disciplined satellite receiver that closes
the loop on the APSIS platform. The software side predicts where objects will be;
the Ground Node **observes** real passes and feeds timing and Doppler measurements
back, which is exactly the input an orbit determination filter needs to shrink the
position covariance that drives collision probability. Better observations make the
conjunction screening sharper. A distributed mesh of these nodes turns hobby grade
hardware into a contributing sensor network.

This folder is the **electrical reference design**: signal chain, RF analysis, bill
of materials, and the manufacturing notes for the front end PCB. The board layout is
the planned Round 2 hardware deliverable; everything needed to route and fabricate it
is specified here.

---

## 1. What it does

- Receives satellite downlinks in two bands used by a large population of LEO objects:
  - **137 MHz** (NOAA APT / weather sats, many cubesat beacons)
  - **435 MHz** (amateur and cubesat telemetry, the 70 cm satellite band)
- Time stamps every sample against a **GPS disciplined 1 PPS reference** so that the
  recovered Doppler curve is accurate enough to be useful for orbit refinement.
- Streams IQ to a host SDR (RTL-SDR class) and uploads reduced observations
  (timestamped Doppler, signal carrier frequency, pass geometry) to the APSIS backend.

Why this matters for the platform: a single ground station that records the Doppler
shift across a pass constrains the along track and radial position of the emitter.
That is the dominant uncertainty axis in the APSIS covariance model
(`lib/conjunction/covariance.ts`). Replacing the modelled along track sigma with a
measured one is a direct, physically grounded improvement to every collision
probability the platform reports.

---

## 2. RF signal chain

```
 Antenna ─► ESD/DC block ─► Band select filter ─► LNA ─► Post filter ─► [Bias tee] ─► SDR
   SMA         TVS              SAW (137/435)     0.6 dB    SAW            5V over coax   USB
```

Design intent: put a low noise figure amplifier **first**, immediately behind only the
ESD protection and a low loss pre select filter, so the cascade noise figure is set by
the LNA and the insertion loss ahead of it, not by the SDR.

### 2.1 Cascade noise figure

Stages (gain G in dB, noise figure F in dB), 435 MHz path:

| Stage              | Gain (dB) | NF (dB) |
|--------------------|-----------|---------|
| ESD + DC block     | -0.2      | 0.2     |
| Pre select SAW     | -1.3      | 1.3     |
| LNA (SPF5189Z)     | +18.0     | 0.6     |
| Post select SAW    | -1.6      | 1.6     |
| SDR front end      | 0 (ref)   | 5.5     |

Using the Friis cascade, converting to linear (F = 10^(NF/10), G = 10^(dB/10)):

```
F_total = F1 + (F2-1)/G1 + (F3-1)/(G1 G2) + (F4-1)/(G1 G2 G3) + (F5-1)/(G1 G2 G3 G4)
```

The two passive stages ahead of the LNA contribute their loss directly
(F1 = 1.047, F2 = 1.349 with G1 G2 = -1.5 dB = 0.708). The LNA (F3 = 1.148,
G3 = 63.1) then dominates the denominator for everything behind it:

```
F_total ≈ 1.047 + 0.349/0.955 + 0.148/0.708 + 0.445/(0.708·63.1) + 2.55/(0.708·63.1·0.692)
        ≈ 1.047 + 0.365 + 0.209 + 0.0100 + 0.0826
        ≈ 1.71  ->  NF_total ≈ 2.33 dB
```

So a 5.5 dB SDR is pulled down to a **system noise figure of about 2.3 dB**, set mostly
by the unavoidable filter loss in front of the LNA. That is the entire point of the
board: an RTL-SDR alone on this band sits near 5–6 dB.

### 2.2 Link budget sanity check (435 MHz cubesat beacon)

```
EIRP (typical 1 U beacon)          : +27 dBm  (0.5 W into a low gain antenna)
Free space path loss @ 1000 km     : -145.2 dB  (FSPL = 20log10(4π d / λ), λ=0.69 m)
Polarization + pointing margin     : -3.0 dB
Received power at antenna           : -121 dBm
System noise floor (NF 2.3 dB,
  3 kHz BW): -174 + 10log10(3000) + 2.3 = -137.0 dBm
Carrier to noise (CNR)              : ~16 dB  -> comfortable beacon lock
```

The 16 dB margin is what makes GPS disciplined Doppler extraction reliable rather than
marginal, which is the measurement the platform actually consumes.

### 2.3 Timing

Doppler is only as good as the time base. The node uses a GNSS module that outputs a
1 PPS pulse disciplining a TCXO; sample timestamps are tagged to PPS edges. A 1 ppm
TCXO at 435 MHz is 435 Hz of frequency uncertainty, while the GNSS discipline brings
the effective reference to the 10^-8 range, so Doppler error is dominated by SNR and
geometry rather than the oscillator.

---

## 3. Board

- 4 layer stack (signal / ground / power / signal), 1.6 mm FR-4, controlled 50 Ω
  coplanar waveguide on the RF layer.
- RF section guarded by a stitched ground fence and an optional shield can footprint.
- Separate analog 3.3 V (LNA bias) and digital 3.3 V rails from a common 5 V USB input
  through an LDO and a pi filter, to keep digital noise out of the front end.
- Connectors: SMA (antenna in), SMA (SDR out), USB-C (power + data to host), uFL (GNSS
  antenna).

See `bom.csv` for parts and `schematic.svg` for the annotated signal chain. The
manufacturing target is any 4 layer process (JLCPCB / PCBWay class), with gerbers and
the routed `.kicad_pcb` produced from this specification as the Round 2 deliverable.

---

## 4. Files

| File            | Contents                                                        |
|-----------------|-----------------------------------------------------------------|
| `README.md`     | This design document (RF analysis, link budget, board notes)    |
| `schematic.svg` | Annotated signal chain with gain / noise figure at each stage   |
| `bom.csv`       | Bill of materials with manufacturer part numbers                |
| `apsis-ground-node.net` | KiCad netlist of the front end (connectivity)           |
