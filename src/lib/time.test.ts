import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime, isoOffset, setTimezoneOffset, timezoneLabel, timezoneName, wibDateKey, wibStartOfDay } from "./time";

test("default company time is GMT+7 (WIB)", () => {
  setTimezoneOffset(420);
  assert.equal(timezoneLabel(), "GMT+7 (WIB)");
  assert.equal(timezoneName(), "Etc/GMT-7");
  assert.equal(isoOffset(), "+07:00");
  // 17:30 UTC is already the next day in WIB.
  assert.equal(wibDateKey(new Date("2026-10-11T17:30:00Z")), "2026-10-12");
  assert.equal(wibStartOfDay("2026-10-12").toISOString(), "2026-10-11T17:00:00.000Z");
  assert.equal(formatTime(new Date("2026-10-11T01:05:00Z")), "08.05");
});

test("a configured offset moves day boundaries and formatting", () => {
  setTimezoneOffset(540);
  assert.equal(timezoneLabel(), "GMT+9 (WIT)");
  assert.equal(wibStartOfDay("2026-10-12").toISOString(), "2026-10-11T15:00:00.000Z");
  assert.equal(formatTime(new Date("2026-10-11T01:05:00Z")), "10.05");
  setTimezoneOffset(-300);
  assert.equal(timezoneName(), "Etc/GMT+5");
  assert.equal(isoOffset(), "-05:00");
  assert.equal(timezoneLabel(), "GMT−5");
  setTimezoneOffset(0);
  assert.equal(timezoneName(), "UTC");
  setTimezoneOffset(420);
});

test("invalid offsets are ignored", () => {
  setTimezoneOffset(420);
  for (const bad of [330, 900, -780, Number.NaN, "420"]) setTimezoneOffset(bad);
  assert.equal(timezoneLabel(), "GMT+7 (WIB)");
});
