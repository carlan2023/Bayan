import { test } from "node:test";
import assert from "node:assert/strict";

// A zero-length cache makes every call go back to the loader, which is the
// only way to observe the "read failed after a good read" path. node --test
// runs each file in its own process, so this does not affect config.test.js.
process.env.SETTINGS_CACHE_MS = "0";
const { getSettings, setSettingsLoader } = await import("../src/config.js");

test("a failed read serves the last good copy instead of failing checkout", async () => {
  let fail = false;
  setSettingsLoader(async () => {
    if (fail) throw new Error("db blip");
    return { delivery_fee_cents: 123400 };
  });
  assert.equal((await getSettings()).delivery_fee_cents, 123400);
  fail = true;
  assert.equal((await getSettings()).delivery_fee_cents, 123400, "last good copy");
});
