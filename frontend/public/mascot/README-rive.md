# Daru Rive asset contract

The application currently has no `.riv` asset. Keep `DARU_RIVE_CONFIG.assetPath`
set to `null` until an asset satisfying this contract has been exported and
tested. The PNG fallback must remain available after the Rive asset ships.

## Export

- Final file: `frontend/public/mascot/daru.riv`
- Artboard: `Daru`
- State machine: `DaruStateMachine`
- Transparent background
- Square canvas, with Daru aligned to bottom center and enough room for the tail
- One character asset; theme changes must affect the Scarf material only

## Required hierarchy

```text
DaruRoot
├─ Body
├─ Head
├─ FrontLegLeft
├─ FrontLegRight
├─ BackLegLeft
├─ BackLegRight
├─ TailRoot
│  └─ TailMid
│     └─ TailTip
└─ Scarf
```

Do not merge the four legs, Head, three tail controls, or Scarf into Body.
Facing may use a state-machine turn/flip, but the scarf logo must remain readable.

## State-machine inputs

Numbers:

- `speed`: normalized screen movement speed; `0` is idle, `1` is normal walk
- `lookX`, `lookY`: normalized head-look target
- `tailEnergy`: normalized secondary-motion strength

Booleans:

- `isDragging`
- `reducedMotion`

Triggers:

- `turn`, `land`, `hover`, `click`
- `groom`, `sniff`, `happy`, `match`, `alert`, `scan`, `rest`

Unknown or temporarily missing inputs must not make the state machine fail.

## Locomotion

Support `IDLE → START_WALK → WALK → STOP_WALK → IDLE`, plus `TURN`, `DRAG`,
and `LAND`. In WALK, `FrontLegLeft + BackLegRight` oppose
`FrontLegRight + BackLegLeft`. Derive playback rate from `speed` so the feet do
not slide against screen movement. Keep body/head vertical movement very small.

## Secondary motion

- Tail uses the `TailRoot → TailMid → TailTip` chain, with delayed follow-through.
- TURN briefly lets the tail lag opposite the body turn.
- ALERT/SCAN reduce tail amplitude; HAPPY/MATCH may increase it slightly.
- DRAG lets the tail lag opposite pointer movement; LAND settles it once.
- Reduced motion disables repeated walk and secondary motion.

## Behaviors and theme

Behavior animations may layer over locomotion: LOOK, SNIFF, GROOM, ALERT,
HAPPY, MATCH, SCAN, and REST. Avoid running several prominent behaviors at once.

Only Scarf color changes by theme:

- DAWN: FlowLink coral/peach semantic primary
- DAY: Flow Cobalt `#2F61F5`
- NIGHT: Current Lilac `#8B7CFF`

Body, face, fur, eyes, nose, and belly must not be recolored. Wire theme color
only after the exported asset exposes a supported color/property binding.
