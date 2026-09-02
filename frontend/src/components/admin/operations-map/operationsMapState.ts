import type { MapMarkerKind } from "./mockOperationsMapData";

type Layers = Record<MapMarkerKind, boolean>;
type SearchTarget = { id: string; kind: MapMarkerKind } | null;

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

export function getSearchSelectionTransition(
  markerId: string | undefined,
  target: SearchTarget,
  spotlightCameraId: string | null,
) {
  const keepsSpotlight =
    target?.kind === "camera" && target.id === spotlightCameraId;

  return {
    selectedId: markerId ?? null,
    spotlightCameraId: keepsSpotlight ? spotlightCameraId : null,
  };
}

export function getMapMarkerSelectionTransition(
  markerId: string | null,
  target: SearchTarget,
  spotlightCameraId: string | null,
) {
  if (!markerId) {
    return { selectedId: null, spotlightCameraId };
  }

  return {
    selectedId: markerId,
    spotlightCameraId:
      target?.kind === "camera" && spotlightCameraId ? target.id : null,
  };
}

export function getSearchClearTransition(sequence: number) {
  return {
    query: "",
    places: [],
    placeState: "idle" as const,
    active: 0,
    sequence: sequence + 1,
  };
}

export function getResetMapTransition() {
  return {
    searchPoint: null,
    selectedId: null,
    queriedBounds: null,
    spotlightCameraId: null,
  };
}

export function isSearchRequestCurrent(sequence: number, requestId: number) {
  return sequence === requestId;
}
