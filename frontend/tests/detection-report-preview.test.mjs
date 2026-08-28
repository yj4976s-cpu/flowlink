import assert from "node:assert/strict";
import test from "node:test";

import { waitForDecodedVideoFrame, waitForSeekedDecodedFrame } from "../src/components/detection/videoFrameReadiness.ts";

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
