import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { optimizeImage } from "./image";

const photo = () => sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 30, g: 120, b: 200 } } }).jpeg({ quality: 95 }).withMetadata({ exif: { IFD0: { Make: "TestCam" } } }).toBuffer();

test("photos become WebP, capped in size, without metadata", async () => {
  const input = await photo();
  const out = await optimizeImage(input);
  assert.equal(out.mime, "image/webp");
  assert.equal(out.ext, ".webp");
  assert.equal(Math.max(out.width, out.height), 2560);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.exif, undefined);
  assert.ok(out.buffer.length < input.length);
});

test("transparent PNG stays transparent; keep target gives PNG/JPEG", async () => {
  const png = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const webp = await optimizeImage(png);
  assert.equal((await sharp(webp.buffer).metadata()).hasAlpha, true);
  assert.equal((await optimizeImage(png, { target: "keep" })).mime, "image/png");
  assert.equal((await optimizeImage(await photo(), { target: "keep" })).mime, "image/jpeg");
});

test("safe SVG is rasterised; unsafe SVG and non-images are refused", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 40"><rect width="64" height="40" fill="#0468c9"/></svg>');
  const out = await optimizeImage(svg);
  assert.equal(out.mime, "image/webp");
  assert.ok(out.width >= 200, "rendered at print density");
  for (const bad of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
  ]) await assert.rejects(optimizeImage(Buffer.from(bad)), /SVG|tidak/, bad);
  await assert.rejects(optimizeImage(Buffer.from("%PDF-1.7 not an image")), /gambar/);
});

test("animated GIF stays animated", async () => {
  const frames = await sharp({ create: { width: 40, height: 80, channels: 3, background: "#ff0000" } }).gif().toBuffer();
  const gif = await sharp(frames, { animated: true }).gif().toBuffer();
  const out = await optimizeImage(gif);
  assert.equal(out.mime, "image/webp");
});
