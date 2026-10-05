import sharp, { type Metadata } from "sharp";

/**
 * Every uploaded image is re-encoded before it is stored:
 *  - WebP (or PNG/JPEG where a consumer cannot show WebP, e.g. email clients),
 *  - longest side capped so phone photos do not store 12-megapixel originals,
 *  - EXIF orientation applied, then all metadata (GPS, camera) removed,
 *  - animation kept for GIF/WebP,
 *  - SVG rendered to pixels, so no script or external reference is ever stored.
 * Photos use high-quality lossy WebP; graphics with transparency (logos, icons)
 * use near-lossless WebP so edges and flat colours stay sharp.
 */

export type ImageTarget = "webp" | "keep";
export interface OptimizeOptions {
  /** Longest side in pixels (never enlarged). */
  maxSide?: number;
  /** `keep` produces PNG (transparency) or JPEG instead of WebP. */
  target?: ImageTarget;
}
export interface OptimizedImage { buffer: Buffer; mime: "image/webp" | "image/png" | "image/jpeg" | "image/gif"; ext: ".webp" | ".png" | ".jpg" | ".gif"; width: number; height: number }

export class ImageRejectedError extends Error {
  code = "IMAGE_INVALID";
  constructor(message: string) { super(message); }
}

const INPUT_PIXEL_LIMIT = 50_000_000;

/** Raster formats sharp may read; anything else (TIFF, HEIF, PDF…) is refused. */
const RASTER = new Set(["jpeg", "png", "webp", "gif", "avif"]);

/**
 * SVG is accepted only as a picture: no script, no event handlers, no DTD/entities
 * and no references outside the file. It is rasterised below and never stored as SVG.
 */
export function assertSafeSvg(text: string) {
  const svg = text.replace(/^﻿/, "").trim();
  if (!/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(svg)) throw new ImageRejectedError("Berkas SVG tidak valid.");
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) throw new ImageRejectedError("SVG dengan DOCTYPE/ENTITY tidak diizinkan.");
  if (/<script|<foreignObject|\son[a-z]+\s*=|javascript:/i.test(svg)) throw new ImageRejectedError("SVG berisi skrip tidak diizinkan.");
  for (const match of svg.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']|url\(\s*["']?([^"')]*)/gi)) {
    const target = (match[1] ?? match[2] ?? "").trim();
    if (target && !target.startsWith("#") && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(target)) throw new ImageRejectedError("SVG tidak boleh memuat berkas atau alamat dari luar.");
  }
}

export function looksLikeSvg(buffer: Buffer) {
  const head = buffer.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && /<svg[\s>]/i.test(buffer.subarray(0, 4096).toString("utf8"))) || (head.startsWith("<!--") && /<svg[\s>]/i.test(buffer.subarray(0, 4096).toString("utf8")));
}

export async function optimizeImage(input: Buffer, { maxSide = 2560, target = "webp" }: OptimizeOptions = {}): Promise<OptimizedImage> {
  const isSvg = looksLikeSvg(input);
  if (isSvg) assertSafeSvg(input.toString("utf8"));
  let meta: Metadata;
  try {
    // Vector art is rendered large enough that the cap below decides the final size.
    meta = await sharp(input, { limitInputPixels: INPUT_PIXEL_LIMIT, ...(isSvg ? { density: 300 } : {}) }).metadata();
  } catch {
    throw new ImageRejectedError("Berkas bukan gambar yang dapat dibaca.");
  }
  if (!isSvg && !RASTER.has(meta.format ?? "")) throw new ImageRejectedError("Format gambar tidak didukung. Gunakan PNG, JPG, WebP, GIF, atau SVG.");
  const animated = !isSvg && (meta.pages ?? 1) > 1 && (meta.format === "gif" || meta.format === "webp");
  const graphic = isSvg || meta.format === "png" || meta.format === "gif" || Boolean(meta.hasAlpha);

  const pipeline = sharp(input, { limitInputPixels: INPUT_PIXEL_LIMIT, animated, ...(isSvg ? { density: 300 } : {}) })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });

  let buffer: Buffer, mime: OptimizedImage["mime"], ext: OptimizedImage["ext"];
  if (target === "keep") {
    if (animated) { buffer = await pipeline.gif().toBuffer(); mime = "image/gif"; ext = ".gif"; }
    else if (graphic) { buffer = await pipeline.png({ compressionLevel: 9, effort: 8 }).toBuffer(); mime = "image/png"; ext = ".png"; }
    else { buffer = await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer(); mime = "image/jpeg"; ext = ".jpg"; }
  } else {
    buffer = await pipeline.webp(graphic
      ? { nearLossless: true, quality: 90, alphaQuality: 100, effort: 5 }
      : { quality: 86, alphaQuality: 100, effort: 5, smartSubsample: true }).toBuffer();
    mime = "image/webp"; ext = ".webp";
  }
  // An image that was already a small WebP may grow when re-encoded: keep the smaller one.
  if (target === "webp" && meta.format === "webp" && !animated && input.length < buffer.length && (meta.width ?? 0) <= maxSide && (meta.height ?? 0) <= maxSide) {
    const clean = await sharp(input, { limitInputPixels: INPUT_PIXEL_LIMIT }).rotate().webp({ lossless: true, effort: 4 }).toBuffer().catch(() => buffer);
    if (clean.length < buffer.length) buffer = clean;
  }
  const out = await sharp(buffer, { animated }).metadata();
  return { buffer, mime, ext, width: out.width ?? 0, height: (out.pageHeight ?? out.height) ?? 0 };
}
