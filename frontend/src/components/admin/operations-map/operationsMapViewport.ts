type LevelMap = { getLevel: () => number };

export function createProgrammaticViewportGuard(onUserZoom: () => void) {
  const activeChanges: { zoomObserved: boolean }[] = [];
  const pendingLevels: number[] = [];

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
      if (!active.zoomObserved && after !== before) pendingLevels.push(after);
    },
    onZoomChanged(map: LevelMap) {
      const active = activeChanges.at(-1);
      if (active) {
        active.zoomObserved = true;
        return;
      }
      const pendingIndex = pendingLevels.indexOf(map.getLevel());
      if (pendingIndex >= 0) {
        pendingLevels.splice(0, pendingIndex + 1);
        return;
      }
      pendingLevels.length = 0;
      onUserZoom();
    },
    reset() {
      activeChanges.length = 0;
      pendingLevels.length = 0;
    },
  };
}
