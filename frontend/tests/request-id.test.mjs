import assert from "node:assert/strict";
import test from "node:test";

import { createPrefixedRequestId, createRequestId } from "../src/lib/requestId.ts";

test("createRequestId uses native randomUUID when available", () => {
  assert.equal(createRequestId({ randomUUID: () => "00000000-0000-4000-8000-000000000001", getRandomValues() {} }), "00000000-0000-4000-8000-000000000001");
});

test("createRequestId falls back to secure RFC4122 UUID v4 bytes", () => {
  let seed = 0;
  const id = createRequestId({
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = seed++;
      return bytes;
    },
  });

  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(id, "00010203-0405-4607-8809-0a0b0c0d0e0f");
});

test("createRequestId refuses insecure fallback sources", () => {
  assert.throws(() => createRequestId(null), /Secure random generator/);
});

test("webcam request IDs use distinct role prefixes and secure UUIDs", () => {
  const cryptoApi = { randomUUID: () => "00000000-0000-4000-8000-000000000001", getRandomValues() {} };
  assert.equal(createPrefixedRequestId("user-webcam", cryptoApi), "user-webcam-00000000-0000-4000-8000-000000000001");
  assert.equal(createPrefixedRequestId("admin-webcam", cryptoApi), "admin-webcam-00000000-0000-4000-8000-000000000001");
  assert.throws(() => createPrefixedRequestId("bad prefix", cryptoApi), /Invalid request ID prefix/);
});
