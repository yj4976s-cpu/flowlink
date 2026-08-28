import assert from "node:assert/strict";
import test from "node:test";

import { waitForDecodedVideoFrame, waitForSeekedDecodedFrame } from "../src/components/detection/videoFrameReadiness.ts";
import { loadDetectionMediaFile, prepareCurrentDetectionReport, prepareDetectionReportPreview } from "../src/components/detection/detectionReportMedia.ts";

class FakeVideo extends EventTarget {
  readyState = 2;
  requestedCallback = null;
  cancelledVideoFrameHandles = [];
  nextHandle = 1;

  requestVideoFrameCallback(callback) {
    this.requestedCallback = callback;
    return this.nextHandle++;
  }

  cancelVideoFrameCallback(handle) {
    this.cancelledVideoFrameHandles.push(handle);
  }

  presentFrame(mediaTime = 0) {
    const callback = this.requestedCallback;
    this.requestedCallback = null;
    callback?.(0, { mediaTime });
  }
}

function fakeFrameScheduler() {
  const callbacks = new Map();
  let nextHandle = 1;
  return {
    callbacks,
    requestAnimationFrame(callback) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      callbacks.delete(handle);
    },
    render() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(0));
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("waits for a presented decoded frame when requestVideoFrameCallback is supported", async () => {
  const video = new FakeVideo();
  const scheduler = fakeFrameScheduler();
  let resolved = false;
  const waiting = waitForDecodedVideoFrame(video, 100, scheduler).then(() => { resolved = true; });

  await Promise.resolve();
  assert.equal(resolved, false);
  assert.equal(typeof video.requestedCallback, "function");

  video.presentFrame();
  await waiting;
  assert.equal(resolved, true);
});

test("falls back to media readiness plus a render opportunity", async () => {
  const video = new FakeVideo();
  video.requestVideoFrameCallback = undefined;
  video.cancelVideoFrameCallback = undefined;
  video.readyState = 1;
  const scheduler = fakeFrameScheduler();
  let resolved = false;
  const waiting = waitForDecodedVideoFrame(video, 100, scheduler).then(() => { resolved = true; });

  video.readyState = 2;
  video.dispatchEvent(new Event("loadeddata"));
  await Promise.resolve();
  assert.equal(resolved, false);

  scheduler.render();
  await waiting;
  assert.equal(resolved, true);
});

test("times out and cancels a pending video frame callback", async () => {
  const video = new FakeVideo();
  const scheduler = fakeFrameScheduler();

  await assert.rejects(waitForDecodedVideoFrame(video, 1, scheduler), /영상 프레임/);
  assert.deepEqual(video.cancelledVideoFrameHandles, [1]);
  assert.equal(video.requestedCallback !== null, true);
});

test("waits for a new presented frame for each consecutive timestamp capture", async () => {
  const video = new FakeVideo();
  const scheduler = fakeFrameScheduler();

  const first = waitForDecodedVideoFrame(video, 100, scheduler, 3.5);
  video.presentFrame(3.5);
  await first;

  let secondResolved = false;
  const second = waitForDecodedVideoFrame(video, 100, scheduler, 14.2).then(() => { secondResolved = true; });
  await Promise.resolve();
  assert.equal(secondResolved, false);

  video.presentFrame(3.5);
  await Promise.resolve();
  assert.equal(secondResolved, false);

  video.presentFrame(14.2);
  await second;
  assert.equal(secondResolved, true);
});

test("aggregates seeked and decoded readiness regardless of resolution order", async () => {
  for (const first of ["seeked", "decoded"]) {
    const seeked = deferred();
    const decoded = deferred();
    let resolved = false;
    const readiness = waitForSeekedDecodedFrame(seeked.promise, decoded.promise).then(() => { resolved = true; });

    (first === "seeked" ? seeked : decoded).resolve();
    await Promise.resolve();
    assert.equal(resolved, false);

    (first === "seeked" ? decoded : seeked).resolve();
    await readiness;
    assert.equal(resolved, true);
  }
});

test("handles a decoded-frame rejection while seeked is still pending", async () => {
  const seeked = deferred();
  const decoded = deferred();
  const readiness = waitForSeekedDecodedFrame(seeked.promise, decoded.promise);
  const failure = new Error("decoded frame failed");

  decoded.reject(failure);
  await assert.rejects(readiness, failure);
});

test("handles a seeked rejection while decoded-frame readiness is still pending", async () => {
  const seeked = deferred();
  const decoded = deferred();
  const readiness = waitForSeekedDecodedFrame(seeked.promise, decoded.promise);
  const failure = new Error("seek failed");

  seeked.reject(failure);
  await assert.rejects(readiness, failure);
});

test("uses the current uploaded video without loading history media", async () => {
  const localFile = { name: "current.mp4" };
  let historyLoads = 0;
  let capturedFile = null;

  const preview = await prepareDetectionReportPreview({
    sourceType: "video",
    localFile,
    originalMediaUrl: "detections/original.mp4",
    loadHistoryFile: async () => { historyLoads += 1; return { name: "history.mp4" }; },
    prepareImage: async () => null,
    captureVideo: async (sourceFile) => { capturedFile = sourceFile; return { name: "preview.jpg" }; },
  });

  assert.equal(historyLoads, 0);
  assert.equal(capturedFile, localFile);
  assert.equal(preview.name, "preview.jpg");
});

test("loads original history video before using the existing frame capture", async () => {
  const historyFile = { name: "history.mp4" };
  let capturedFile = null;

  const preview = await prepareDetectionReportPreview({
    sourceType: "video",
    localFile: null,
    originalMediaUrl: "detections/original.mp4",
    loadHistoryFile: async () => historyFile,
    prepareImage: async () => null,
    captureVideo: async (sourceFile) => { capturedFile = sourceFile; return { name: "preview.jpg" }; },
  });

  assert.equal(capturedFile, historyFile);
  assert.equal(preview.name, "preview.jpg");
});

test("loads original history image before using the existing crop preparation", async () => {
  const historyFile = { name: "history.jpg" };
  let preparedFile = null;

  const preview = await prepareDetectionReportPreview({
    sourceType: "image",
    localFile: null,
    originalMediaUrl: "detections/original.jpg",
    loadHistoryFile: async () => historyFile,
    prepareImage: async (sourceFile) => { preparedFile = sourceFile; return { name: "preview.jpg" }; },
    captureVideo: async () => null,
  });

  assert.equal(preparedFile, historyFile);
  assert.equal(preview.name, "preview.jpg");
});

test("propagates history media load failures for the modal fallback handler", async () => {
  const failure = new Error("history media failed");
  await assert.rejects(prepareDetectionReportPreview({
    sourceType: "video",
    localFile: null,
    originalMediaUrl: "detections/original.mp4",
    loadHistoryFile: async () => { throw failure; },
    prepareImage: async () => null,
    captureVideo: async () => null,
  }), failure);
});

test("keeps the empty preview fallback when history has no original media", async () => {
  let historyLoads = 0;
  const preview = await prepareDetectionReportPreview({
    sourceType: "image",
    localFile: null,
    originalMediaUrl: "",
    loadHistoryFile: async () => { historyLoads += 1; return { name: "unexpected.jpg" }; },
    prepareImage: async () => ({ name: "unexpected-preview.jpg" }),
    captureVideo: async () => null,
  });

  assert.equal(preview, null);
  assert.equal(historyLoads, 0);
});

test("uses only the supplied original media URL for history report preparation", async () => {
  const requestedUrls = [];
  const originalMediaUrl = "detections/original.mp4";
  await prepareDetectionReportPreview({
    sourceType: "video",
    localFile: null,
    originalMediaUrl,
    loadHistoryFile: async () => { requestedUrls.push(originalMediaUrl); return { name: "history.mp4" }; },
    prepareImage: async () => null,
    captureVideo: async () => ({ name: "preview.jpg" }),
  });

  assert.deepEqual(requestedUrls, [originalMediaUrl]);
  assert.equal(requestedUrls.includes("detections/result.mp4"), false);
});

test("resolves and fetches history media with credentials", async () => {
  const calls = [];
  const file = await loadDetectionMediaFile({
    mediaUrl: "detections/original.mp4",
    eventId: 42,
    sourceType: "video",
    resolveMediaUrl: (value) => `/uploads/${value}`,
    fetchMedia: async (url, init) => {
      calls.push({ url, init });
      return new Response(new Blob(["video"], { type: "video/mp4" }), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      });
    },
  });

  assert.deepEqual(calls, [{ url: "/uploads/detections/original.mp4", init: { credentials: "include" } }]);
  assert.equal(file.name, "history-detection-42.mp4");
  assert.equal(file.type, "video/mp4");
});

test("accepts generic static media content type using the expected history type", async () => {
  const file = await loadDetectionMediaFile({
    mediaUrl: "detections/original.jpg",
    eventId: 7,
    sourceType: "image",
    resolveMediaUrl: (value) => `/uploads/${value}`,
    fetchMedia: async () => new Response(new Blob(["image"]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }),
  });

  assert.equal(file.name, "history-detection-7.jpg");
  assert.equal(file.type, "image/jpeg");
});

test("rejects empty or mismatched history media responses", async () => {
  const baseOptions = {
    mediaUrl: "detections/original.mp4",
    eventId: 9,
    sourceType: "video",
    resolveMediaUrl: (value) => `/uploads/${value}`,
  };

  await assert.rejects(loadDetectionMediaFile({
    ...baseOptions,
    fetchMedia: async () => new Response(new Blob([]), { status: 200 }),
  }), /비어/);
  await assert.rejects(loadDetectionMediaFile({
    ...baseOptions,
    fetchMedia: async () => new Response(new Blob(["image"], { type: "image/jpeg" }), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }),
  }), /일치하지 않습니다/);
});

test("ignores a stale successful history report preparation", async () => {
  const pending = deferred();
  let currentGeneration = 1;
  const preparation = prepareCurrentDetectionReport({
    generation: currentGeneration,
    getCurrentGeneration: () => currentGeneration,
    prepare: () => pending.promise,
  });

  currentGeneration += 1;
  pending.resolve({ name: "stale-preview.jpg" });

  assert.deepEqual(await preparation, { status: "stale" });
});

test("ignores a stale failed history report preparation", async () => {
  const pending = deferred();
  let currentGeneration = 5;
  const preparation = prepareCurrentDetectionReport({
    generation: currentGeneration,
    getCurrentGeneration: () => currentGeneration,
    prepare: () => pending.promise,
  });

  currentGeneration += 1;
  pending.reject(new Error("stale history failure"));

  assert.deepEqual(await preparation, { status: "stale" });
});

test("applies report preparation while its detection context is current", async () => {
  const preview = { name: "current-preview.jpg" };
  const preparation = await prepareCurrentDetectionReport({
    generation: 3,
    getCurrentGeneration: () => 3,
    prepare: async () => preview,
  });

  assert.deepEqual(preparation, { status: "success", value: preview });
});
