import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePositions, sniffImage } from "../lib/plan.mjs";

const bytes = (...values) => Uint8Array.from(values);
const text = (value) => new TextEncoder().encode(value);

test("riconosce i formati ammessi dai primi byte", () => {
  assert.equal(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)), "image/png");
  assert.equal(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)), "image/jpeg");
  assert.equal(sniffImage(text("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
});

test("rifiuta tutto il resto, anche se si finge un'immagine", () => {
  assert.equal(sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffImage(text("<?xml version='1.0'?><svg/>")), null);
  assert.equal(sniffImage(text("<html><script>alert(1)</script>")), null);
  assert.equal(sniffImage(text("GIF89a")), null);
  assert.equal(sniffImage(text("%PDF-1.7")), null);
  assert.equal(sniffImage(text("RIFF\0\0\0\0WAVEfmt ")), null);
  assert.equal(sniffImage(bytes()), null);
  assert.equal(sniffImage(bytes(0x89, 0x50)), null);
});

test("legge le posizioni valide", () => {
  assert.deepEqual(parsePositions('[{"hostId":1,"x":0,"y":1},{"hostId":2,"x":0.5,"y":0.25}]'), [
    { hostId: 1, x: 0, y: 1 },
    { hostId: 2, x: 0.5, y: 0.25 },
  ]);
  assert.deepEqual(parsePositions("[]"), []);
});

test("scarta i campi in più", () => {
  assert.deepEqual(parsePositions('[{"hostId":1,"x":0.1,"y":0.2,"nome":"altro"}]'), [{ hostId: 1, x: 0.1, y: 0.2 }]);
});

test("rifiuta posizioni non valide", () => {
  for (const value of [
    "",
    "niente",
    "{}",
    "null",
    '[{"hostId":1,"x":1.1,"y":0}]',
    '[{"hostId":1,"x":0,"y":-0.1}]',
    '[{"hostId":1,"x":"0","y":0}]',
    '[{"hostId":0,"x":0,"y":0}]',
    '[{"hostId":1.5,"x":0,"y":0}]',
    '[{"x":0,"y":0}]',
    "[null]",
    '[{"hostId":1,"x":0,"y":0},{"hostId":1,"x":1,"y":1}]',
  ]) {
    assert.equal(parsePositions(value), null, value);
  }
});

test("rifiuta un elenco smisurato", () => {
  const items = Array.from({ length: 1001 }, (_, index) => ({ hostId: index + 1, x: 0, y: 0 }));
  assert.equal(parsePositions(JSON.stringify(items)), null);
  assert.equal(parsePositions(JSON.stringify(items.slice(0, 1000))).length, 1000);
});
