type LevelMap = { getLevel: () => number };

export function createProgrammaticViewportGuard(onUserZoom: () => void) {
  const activeChanges: { zoomObserved: boolean }[] = [];
  let pendingProgrammaticZooms = 0;

  return {
    run(map: LevelMap, change: () => void) {
      const before = map.getLevel();
      const active = { zoomObserved: false };
      activeChanges.push(active);
      try {
        change();
      } finally {
        activeChanges.pop();
      }
      const after = map.getLevel();
      if (!active.zoomObserved && after !== before) pendingProgrammaticZooms += 1;
    },
    onZoomChanged() {
      const active = activeChanges.at(-1);
      if (active) {
        active.zoomObserved = true;
        return;
      }
      if (pendingProgrammaticZooms > 0) {
        pendingProgrammaticZooms -= 1;
        return;
      }
      onUserZoom();
    },
    reset() {
      activeChanges.length = 0;
      pendingProgrammaticZooms = 0;
    },
  };
}
