const HAVE_CURRENT_DATA = 2;

type VideoFrameReadyTarget = Pick<HTMLVideoElement, "readyState" | "addEventListener" | "removeEventListener"> &
  Partial<Pick<HTMLVideoElement, "requestVideoFrameCallback" | "cancelVideoFrameCallback">>;

type FrameScheduler = {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
};

function browserFrameScheduler(): FrameScheduler {
  return {
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };
}

export function waitForSeekedDecodedFrame(seeked: Promise<void>, decodedFrameReady: Promise<void>) {
  return Promise.all([seeked, decodedFrameReady]).then(() => undefined);
}

export function waitForDecodedVideoFrame(
  video: VideoFrameReadyTarget,
  timeoutMs: number,
  suppliedFrameScheduler?: FrameScheduler,
  expectedMediaTime?: number,
) {
  return new Promise<void>((resolve, reject) => {
    const frameScheduler = suppliedFrameScheduler ?? browserFrameScheduler();
    let animationFrameHandle: number | null = null;
    let videoFrameHandle: number | null = null;
    let settled = false;

    const timer = globalThis.setTimeout(() => {
      finish(() => reject(new Error("영상 프레임을 준비하지 못했습니다.")));
    }, timeoutMs);

    function cleanup() {
      globalThis.clearTimeout(timer);
      video.removeEventListener("loadeddata", handleMediaReady);
      video.removeEventListener("canplay", handleMediaReady);
      video.removeEventListener("error", handleError);
      if (animationFrameHandle !== null) frameScheduler.cancelAnimationFrame(animationFrameHandle);
      if (videoFrameHandle !== null) video.cancelVideoFrameCallback?.(videoFrameHandle);
    }

    function finish(callback: () => void) {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    }

    function handleError() {
      finish(() => reject(new Error("영상 프레임을 읽지 못했습니다.")));
    }

    function resolveAfterRenderOpportunity() {
      animationFrameHandle = frameScheduler.requestAnimationFrame(() => {
        animationFrameHandle = null;
        if (video.readyState >= HAVE_CURRENT_DATA) finish(resolve);
      });
    }

    function handleMediaReady() {
      if (video.readyState >= HAVE_CURRENT_DATA && animationFrameHandle === null) {
        resolveAfterRenderOpportunity();
      }
    }

    video.addEventListener("error", handleError, { once: true });

    if (typeof video.requestVideoFrameCallback === "function") {
      const requestPresentedFrame = () => {
        videoFrameHandle = video.requestVideoFrameCallback?.((_now, metadata) => {
          videoFrameHandle = null;
          const isExpectedFrame = expectedMediaTime === undefined
            || Math.abs(metadata.mediaTime - expectedMediaTime) <= 0.1;
          if (video.readyState >= HAVE_CURRENT_DATA && isExpectedFrame) {
            finish(resolve);
          } else if (!settled) {
            requestPresentedFrame();
          }
        }) ?? null;
      };
      requestPresentedFrame();
      return;
    }

    video.addEventListener("loadeddata", handleMediaReady);
    video.addEventListener("canplay", handleMediaReady);
    handleMediaReady();
  });
}
