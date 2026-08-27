import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getPublicApiBaseUrl } from "../src/lib/apiBase.ts";

const homeApiSource = readFileSync(new URL("../src/lib/homeApi.ts", import.meta.url), "utf8");
const composeSource = readFileSync(new URL("../../compose.yaml", import.meta.url), "utf8");

test("home SSR uses the Docker-internal backend instead of the request Host", () => {
  assert.match(homeApiSource, /import "server-only"/);
  assert.match(homeApiSource, /process\.env\.INTERNAL_API_BASE_URL\?\.trim\(\) \|\| "http:\/\/backend:8000"/);
  assert.match(homeApiSource, /buildServerApiUrl\("\/api\/system\/home-summary"\)/);
  assert.doesNotMatch(homeApiSource, /(?:x-forwarded-host|requestHeaders\.get\("host"\))/);
});

test("compose provides the internal API base only to the frontend runtime", () => {
  assert.match(composeSource, /INTERNAL_API_BASE_URL: \$\{INTERNAL_API_BASE_URL:-http:\/\/backend:8000\}/);
});

test("the browser API base remains same-origin by default", () => {
  const previousApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  try {
    assert.equal(getPublicApiBaseUrl(), "/api");
  } finally {
    if (previousApiBaseUrl === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = previousApiBaseUrl;
  }
});
