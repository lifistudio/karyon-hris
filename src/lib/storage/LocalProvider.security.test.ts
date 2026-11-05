import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalProvider } from "./LocalProvider";
import { decodeDataUrl } from ".";

test("new local files are encrypted at rest and transparently decrypted", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hris-storage-test-"));
  const previousPath = process.env.LOCAL_STORAGE_PATH;
  const previousEncryptionKey = process.env.ENCRYPTION_KEY;
  const previousSigningKey = process.env.STORAGE_SIGNING_SECRET;
  process.env.LOCAL_STORAGE_PATH = dir;
  process.env.ENCRYPTION_KEY = "test-encryption-key-with-sufficient-entropy";
  process.env.STORAGE_SIGNING_SECRET = "test-signing-key-with-sufficient-entropy";

  try {
    const provider = new LocalProvider();
    const plain = Buffer.from("private biometric sample");
    const key = "faces/employee/reference.jpg";
    await provider.upload(plain, key, "image/jpeg");

    const stored = await fs.readFile(path.join(dir, key));
    assert.equal(stored.subarray(0, 8).toString("ascii"), "HRISENC1");
    assert.equal(stored.includes(plain), false);
    assert.deepEqual((await provider.read(key)).buffer, plain);

    stored[25] ^= 0xff;
    await fs.writeFile(path.join(dir, key), stored);
    await assert.rejects(() => provider.read(key));
    await fs.writeFile(path.join(dir, key), Buffer.from("HRISENC1broken"));
    await assert.rejects(() => provider.read(key), /tidak lengkap/);
    assert.equal(provider.verifySignature(key, Math.floor(Date.now() / 1000) + 600, "é".repeat(64)), false);
    const signed = new URL(await provider.getSignedUrl(key), "https://example.test");
    assert.equal(provider.verifySignature(key, Number(signed.searchParams.get("expires")), signed.searchParams.get("sig")!), true);
  } finally {
    if (previousPath === undefined) delete process.env.LOCAL_STORAGE_PATH;
    else process.env.LOCAL_STORAGE_PATH = previousPath;
    if (previousEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousEncryptionKey;
    if (previousSigningKey === undefined) delete process.env.STORAGE_SIGNING_SECRET;
    else process.env.STORAGE_SIGNING_SECRET = previousSigningKey;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("legacy plaintext files remain readable during migration", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hris-storage-legacy-"));
  const previousPath = process.env.LOCAL_STORAGE_PATH;
  process.env.LOCAL_STORAGE_PATH = dir;
  try {
    const provider = new LocalProvider();
    const key = "legacy/document.pdf";
    const plain = Buffer.from("legacy-content");
    await fs.mkdir(path.dirname(path.join(dir, key)), { recursive: true });
    await fs.writeFile(path.join(dir, key), plain);
    assert.deepEqual((await provider.read(key)).buffer, plain);
  } finally {
    if (previousPath === undefined) delete process.env.LOCAL_STORAGE_PATH;
    else process.env.LOCAL_STORAGE_PATH = previousPath;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("data URLs are checked by file signature, not only claimed MIME", () => {
  const fakePdf = `data:application/pdf;base64,${Buffer.from("not a pdf").toString("base64")}`;
  assert.throws(() => decodeDataUrl(fakePdf, ["application/pdf"]), /tidak sesuai/);

  const pdf = Buffer.from("%PDF-1.7\nminimal");
  assert.deepEqual(
    decodeDataUrl(`data:application/pdf;base64,${pdf.toString("base64")}`, ["application/pdf"]),
    { buffer: pdf, mime: "application/pdf", ext: ".pdf" }
  );
});

test("a storage key has one spelling, so folder-based access rules cannot be sidestepped", async () => {
  const { isCanonicalKey } = await import("./StorageProvider");
  assert.equal(isCanonicalKey("faces/abc/ref.webp"), true);
  for (const key of ["", "./faces/abc/ref.webp", "faces//abc", "faces/./abc", "faces/../payrolls/x", "faces/abc/", "faces\\abc"]) {
    assert.equal(isCanonicalKey(key), false, key);
  }
});
