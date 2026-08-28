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

test("selected history deletion invalidates its pending report preview", async () => {
  const pending = deferred();
  let generation = 10;
  const preparation = prepareCurrentDetectionReport({
    generation,
    getCurrentGeneration: () => generation,
    prepare: () => pending.promise,
  });

  generation += 1;
  pending.resolve({ name: "deleted-history-preview.jpg" });

  assert.deepEqual(await preparation, { status: "stale" });
});

test("delete-all invalidates a pending report failure", async () => {
  const pending = deferred();
  let generation = 20;
  const preparation = prepareCurrentDetectionReport({
    generation,
    getCurrentGeneration: () => generation,
    prepare: () => pending.promise,
  });

  generation += 1;
  pending.reject(new Error("deleted history failure"));

  assert.deepEqual(await preparation, { status: "stale" });
});

test("newer history detail wins when an older response completes last", async () => {
  const historyA = deferred();
  const historyB = deferred();
  let generation = 0;
  const requestA = prepareCurrentDetectionReport({
    generation: ++generation,
    getCurrentGeneration: () => generation,
    prepare: () => historyA.promise,
  });
  const requestB = prepareCurrentDetectionReport({
    generation: ++generation,
    getCurrentGeneration: () => generation,
    prepare: () => historyB.promise,
  });

  historyB.resolve({ id: "B" });
  assert.deepEqual(await requestB, { status: "success", value: { id: "B" } });
  historyA.resolve({ id: "A" });
  assert.deepEqual(await requestA, { status: "stale" });
});

test("stale history detail failure does not replace the current context", async () => {
  const historyA = deferred();
  let generation = 30;
  const requestA = prepareCurrentDetectionReport({
    generation,
    getCurrentGeneration: () => generation,
    prepare: () => historyA.promise,
  });

  generation += 1;
  historyA.reject(new Error("stale detail failure"));

  assert.deepEqual(await requestA, { status: "stale" });
});

test("current history detail response is applied normally", async () => {
  const detail = { id: 42 };
  const result = await prepareCurrentDetectionReport({
    generation: 40,
    getCurrentGeneration: () => 40,
    prepare: async () => detail,
  });

  assert.deepEqual(result, { status: "success", value: detail });
});

test("detail loading invalidates the previously displayed event report", async () => {
  const previousReport = deferred();
  let generation = 50;
  let currentEventId = "B";
  let historyDetailLoading = false;
  const report = prepareCurrentDetectionReport({
    generation,
    getCurrentGeneration: () => generation,
    prepare: () => previousReport.promise,
  });

  generation += 1;
  historyDetailLoading = true;
  assert.equal(historyDetailLoading, true);
  currentEventId = "A";
  historyDetailLoading = false;
  previousReport.resolve({ eventId: "B" });

  assert.deepEqual(await report, { status: "stale" });
  assert.equal(currentEventId, "A");
});

test("deleting a pending detail makes its late success stale", async () => {
  const pendingDetail = deferred();
  let generation = 60;
  let pendingHistoryDetailId = "A";
  const detail = prepareCurrentDetectionReport({
    generation,
    getCurrentGeneration: () => generation,
    prepare: () => pendingDetail.promise,
  });

  if (pendingHistoryDetailId === "A") {
    generation += 1;
    pendingHistoryDetailId = null;
  }
  pendingDetail.resolve({ id: "A" });

  assert.deepEqual(await detail, { status: "stale" });
  assert.equal(pendingHistoryDetailId, null);
});

test("deleting a pending detail makes its late failure stale", async () => {
  const pendingDetail = deferred();
  let generation = 70;
  let pendingHistoryDetailId = "A";
  const detail = prepareCurrentDetectionReport({
    generation,
    getCurrentGeneration: () => generation,
    prepare: () => pendingDetail.promise,
  });

  if (pendingHistoryDetailId === "A") {
    generation += 1;
    pendingHistoryDetailId = null;
  }
  pendingDetail.reject(new Error("deleted pending detail"));

  assert.deepEqual(await detail, { status: "stale" });
});

test("an older detail cleanup does not clear a newer pending detail", async () => {
  let generation = 80;
  let pendingHistoryDetailId = "A";
  const requestAGeneration = generation;

  generation += 1;
  pendingHistoryDetailId = "B";
  if (pendingHistoryDetailId === "A" && generation === requestAGeneration) {
    pendingHistoryDetailId = null;
  }

  assert.equal(pendingHistoryDetailId, "B");
});

test("the latest detail request still applies normally", async () => {
  let generation = 90;
  const pendingHistoryDetailId = "A";
  const result = await prepareCurrentDetectionReport({
    generation,
    getCurrentGeneration: () => generation,
    prepare: async () => ({ id: pendingHistoryDetailId }),
  });

  assert.deepEqual(result, { status: "success", value: { id: "A" } });
});

test("deleting an unrelated history keeps current and pending context valid", async () => {
  let generation = 100;
  const currentEventId = "A";
  const pendingHistoryDetailId = "A";
  const deletedId = "C";

  if (currentEventId === deletedId || pendingHistoryDetailId === deletedId) generation += 1;

  assert.equal(generation, 100);
  assert.equal(currentEventId, "A");
  assert.equal(pendingHistoryDetailId, "A");
});

test("deleting current B preserves pending A and lets its success apply", async () => {
  const pendingDetail = deferred();
  let generation = 110;
  let currentEventId = "B";
  let pendingHistoryDetailId = "A";
  let historyDetailLoading = true;
  const detail = prepareCurrentDetectionReport({
    generation,
    getCurrentGeneration: () => generation,
    prepare: () => pendingDetail.promise,
  });

  const deletedId = "B";
  const deletesCurrentContext = currentEventId === deletedId;
  const deletesPendingContext = pendingHistoryDetailId === deletedId;
  const hasDifferentPendingContext = pendingHistoryDetailId !== null && pendingHistoryDetailId !== deletedId;
  if (deletesPendingContext || (deletesCurrentContext && !hasDifferentPendingContext)) generation += 1;
  if (deletesCurrentContext) currentEventId = null;

  assert.equal(generation, 110);
  assert.equal(pendingHistoryDetailId, "A");
  assert.equal(historyDetailLoading, true);

  pendingDetail.resolve({ id: "A" });
  const result = await detail;
  if (result.status === "success") currentEventId = result.value.id;
  if (pendingHistoryDetailId === "A") {
    pendingHistoryDetailId = null;
    historyDetailLoading = false;
  }

  assert.deepEqual(result, { status: "success", value: { id: "A" } });
  assert.equal(currentEventId, "A");
  assert.equal(pendingHistoryDetailId, null);
  assert.equal(historyDetailLoading, false);
});

test("deleting current B preserves pending A and lets its failure apply", async () => {
  const pendingDetail = deferred();
  let generation = 120;
  let currentEventId = "B";
  let pendingHistoryDetailId = "A";
  let historyDetailLoading = true;
  let error = "";
  const detail = prepareCurrentDetectionReport({
    generation,
    getCurrentGeneration: () => generation,
    prepare: () => pendingDetail.promise,
  });

  const deletedId = "B";
  const hasDifferentPendingContext = pendingHistoryDetailId !== null && pendingHistoryDetailId !== deletedId;
  if (pendingHistoryDetailId === deletedId || (currentEventId === deletedId && !hasDifferentPendingContext)) generation += 1;
  if (currentEventId === deletedId) currentEventId = null;
  pendingDetail.reject(new Error("latest detail failed"));

  const result = await detail;
  if (result.status === "failure") error = result.error.message;
  if (pendingHistoryDetailId === "A") {
    pendingHistoryDetailId = null;
    historyDetailLoading = false;
  }

  assert.equal(result.status, "failure");
  assert.equal(error, "latest detail failed");
  assert.equal(generation, 120);
  assert.equal(pendingHistoryDetailId, null);
  assert.equal(historyDetailLoading, false);
});

test("deleting the current event without a pending detail invalidates its context", () => {
  let generation = 130;
  let currentEventId = "B";
  const pendingHistoryDetailId = null;
  const deletedId = "B";
  const deletesCurrentContext = currentEventId === deletedId;
  const deletesPendingContext = pendingHistoryDetailId === deletedId;
  const hasDifferentPendingContext = pendingHistoryDetailId !== null && pendingHistoryDetailId !== deletedId;

  if (deletesPendingContext || (deletesCurrentContext && !hasDifferentPendingContext)) generation += 1;
  if (deletesCurrentContext) currentEventId = null;

  assert.equal(generation, 131);
  assert.equal(currentEventId, null);
});

test("deleting pending A invalidates and clears its loading context", async () => {
  const pendingDetail = deferred();
  let generation = 140;
  let pendingHistoryDetailId = "A";
  let historyDetailLoading = true;
  const detail = prepareCurrentDetectionReport({
    generation,
    getCurrentGeneration: () => generation,
    prepare: () => pendingDetail.promise,
  });

  const deletedId = "A";
  if (pendingHistoryDetailId === deletedId) {
    generation += 1;
    pendingHistoryDetailId = null;
    historyDetailLoading = false;
  }
  pendingDetail.resolve({ id: "A" });

  assert.deepEqual(await detail, { status: "stale" });
  assert.equal(pendingHistoryDetailId, null);
  assert.equal(historyDetailLoading, false);
});

test("deleting unrelated C preserves current B and pending A contexts", () => {
  let generation = 150;
  const currentEventId = "B";
  const pendingHistoryDetailId = "A";
  const historyDetailLoading = true;
  const deletedId = "C";
  const deletesCurrentContext = currentEventId === deletedId;
  const deletesPendingContext = pendingHistoryDetailId === deletedId;
  const hasDifferentPendingContext = pendingHistoryDetailId !== null && pendingHistoryDetailId !== deletedId;

  if (deletesPendingContext || (deletesCurrentContext && !hasDifferentPendingContext)) generation += 1;

  assert.equal(generation, 150);
  assert.equal(currentEventId, "B");
  assert.equal(pendingHistoryDetailId, "A");
  assert.equal(historyDetailLoading, true);
});
