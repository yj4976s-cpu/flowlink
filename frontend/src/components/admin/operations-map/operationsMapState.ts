import type { MapMarkerKind } from "./mockOperationsMapData";

type Layers = Record<MapMarkerKind, boolean>;

export function getLayerToggleTransition(
  kind: MapMarkerKind,
  layers: Layers,
  spotlightCameraId: string | null,
  selectedKind: MapMarkerKind | null,
) {
  const turningOff = layers[kind];

  return {
    layers: { ...layers, [kind]: !turningOff },
    spotlightCameraId:
      kind === "camera" && turningOff && spotlightCameraId
        ? null
        : spotlightCameraId,
    clearSelection: turningOff && selectedKind === kind,
  };
}
