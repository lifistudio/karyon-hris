import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOffer } from "./offer-parse";

const server = "https://lisensi.example";

test("keeps https links and copy from the license website", () => {
  const offer = parseOffer({
    website: "https://karyon.example/",
    upgrade: { title: "Upgrade", text: "Teks", ctaLabel: "Beli", url: "https://karyon.example/pricing", points: ["A", "", "B"] },
    renew: { ctaLabel: "Perpanjang", url: "https://karyon.example/dashboard/licenses" },
    promo: { title: "Diskon", text: "20%", code: "PRO-20", ctaLabel: "Pakai", url: "https://karyon.example/pricing", endsAt: "2026-12-31" },
  }, server);
  assert.equal(offer.website, "https://karyon.example");
  assert.deepEqual(offer.upgrade?.points, ["A", "B"]);
  assert.equal(offer.promo?.code, "PRO-20");
  assert.equal(offer.renew.url, "https://karyon.example/dashboard/licenses");
});

test("drops unsafe links and falls back to the configured license server", () => {
  const offer = parseOffer({
    upgrade: { title: "Upgrade", url: "javascript:alert(1)" },
    renew: { ctaLabel: "Perpanjang", url: "http://evil.example/renew" },
    promo: { title: "Diskon", url: "https://user:pass@evil.example/" },
  }, server);
  assert.equal(offer.upgrade?.url, `${server}/pricing`);
  assert.equal(offer.renew.url, `${server}/dashboard/licenses`);
  assert.equal(offer.promo, null);
});

test("respects a disabled upgrade card and strips odd characters from codes", () => {
  const offer = parseOffer({ upgrade: null, promo: { title: "Promo", code: "<b>X1</b>", url: "https://karyon.example/" } }, server);
  assert.equal(offer.upgrade, null);
  assert.equal(offer.promo?.code, "bX1b");
});
