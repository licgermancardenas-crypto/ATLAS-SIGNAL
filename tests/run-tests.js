// Pruebas del núcleo de Atlas Signal.  Uso:  node tests/run-tests.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
function load(rel, shims = {}) {
  const code = fs.readFileSync(path.join(root, rel), "utf8");
  const names = Object.keys(shims);
  new Function(...names, code)(...names.map((n) => shims[n]));
}

// pako y UPNG esperan `module` / `require`; se les da un entorno mínimo.
const pakoModule = { exports: {} };
load("js/vendor/pako.min.js", { module: pakoModule, exports: pakoModule.exports, define: undefined });
const upngModule = { exports: {} };
load("js/vendor/UPNG.js", { module: upngModule, require: () => pakoModule.exports, window: undefined });
globalThis.UPNG = upngModule.exports;
globalThis.UPNG.decode._inflate = (d) => pakoModule.exports.inflate(d);
load("js/core/crypto.js");
load("js/core/stego.js");
load("js/core/carriers.js");

const { AtlasCrypto: C, AtlasStego: S, AtlasCarriers: K } = globalThis;
const te = new TextEncoder(), td = new TextDecoder();

function noisyImage(w, h, alphaFn = () => 255) {
  const rgba = new Uint8Array(w * h * 4);
  let seed = 12345;
  for (let i = 0; i < rgba.length; i += 4) {
    for (let c = 0; c < 3; c++) { seed = (seed * 1103515245 + 12345) >>> 0; rgba[i + c] = seed >>> 24; }
    rgba[i + 3] = alphaFn(i / 4);
  }
  return rgba;
}

function makeWav(samples, bits = 16, channels = 2, rate = 44100) {
  const bps = bits / 8, dataSize = samples * bps;
  const b = new Uint8Array(44 + dataSize), dv = new DataView(b.buffer);
  const w = (o, s) => [...s].forEach((ch, i) => (b[o + i] = ch.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + dataSize, true); w(8, "WAVE");
  w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * channels * bps, true); dv.setUint16(32, channels * bps, true);
  dv.setUint16(34, bits, true); w(36, "data"); dv.setUint32(40, dataSize, true);
  for (let i = 44; i < b.length; i++) b[i] = (i * 7919) & 255;
  return b;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("permutación es biyectiva", () => {
  for (const n of [5, 97, 1000, 65537, 300000]) {
    const perm = S.makePermutation(n, new Uint8Array(32).map((_, i) => i * 13));
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const v = perm(i); assert(v >= 0 && v < n); assert(!seen[v], `repetido en n=${n}`); seen[v] = 1; }
  }
});

test("archivo en imagen PNG (1 y 2 bits) → extraer", async () => {
  for (const depth of [1, 2]) {
    const w = 120, h = 90, rgba = noisyImage(w, h);
    const original = rgba.slice();
    const data = te.encode("contenido secreto ".repeat(40));
    const inner = await C.pack({ kind: C.KIND.FILE, name: "plan.txt", mime: "text/plain", data });
    await S.hide(K.imageCarrier(rgba), inner, "Clave-Muy-Segura-2026", depth);

    let maxDiff = 0;
    for (let i = 0; i < rgba.length; i++) maxDiff = Math.max(maxDiff, Math.abs(rgba[i] - original[i]));
    assert(maxDiff <= (1 << depth) - 1, "solo deben cambiar los bits bajos");

    const png = K.encodePNG(rgba, w, h);
    const back = K.decodePNG(png.buffer);
    const { inner: out, depth: found } = await S.reveal(K.imageCarrier(back.rgba), "Clave-Muy-Segura-2026");
    assert.strictEqual(found, depth);
    const item = await C.unpack(out);
    assert.strictEqual(item.name, "plan.txt");
    assert.strictEqual(td.decode(item.data), td.decode(data));
  }
});

test("contraseña incorrecta falla", async () => {
  const rgba = noisyImage(80, 80);
  await S.hide(K.imageCarrier(rgba), await C.pack({ kind: 0, data: te.encode("hola") }), "correcta-123456", 1);
  await assert.rejects(S.reveal(K.imageCarrier(rgba), "incorrecta-123456"), C.WrongPasswordError);
});

test("imagen sin contenido oculto falla", async () => {
  await assert.rejects(S.reveal(K.imageCarrier(noisyImage(60, 60)), "lo-que-sea-123"), C.WrongPasswordError);
});

test("imagen con transparencia: solo usa píxeles opacos", async () => {
  const w = 100, h = 100, rgba = noisyImage(w, h, (p) => (p % 3 === 0 ? 120 : 255));
  const original = rgba.slice();
  await S.hide(K.imageCarrier(rgba), await C.pack({ kind: 0, data: te.encode("transparente") }), "pw-transp-2026", 1);
  for (let p = 0; p < w * h; p++) if (original[p * 4 + 3] !== 255) for (let c = 0; c < 4; c++) assert.strictEqual(rgba[p * 4 + c], original[p * 4 + c]);
  const back = K.decodePNG(K.encodePNG(rgba, w, h).buffer);
  const { inner } = await S.reveal(K.imageCarrier(back.rgba), "pw-transp-2026");
  assert.strictEqual(td.decode((await C.unpack(inner)).data), "transparente");
});

test("capacidad insuficiente se detecta", async () => {
  const rgba = noisyImage(20, 20); // 1200 posiciones → ~118 bytes a 1 bit
  const big = new Uint8Array(5000); globalThis.crypto.getRandomValues(big);
  await assert.rejects(S.hide(K.imageCarrier(rgba), await C.pack({ kind: 1, name: "x.bin", data: big }), "pw-capacidad-1", 1), (e) => e.code === "CAPACITY");
});

test("WAV 16 y 24 bits → extraer", async () => {
  for (const bits of [16, 24]) {
    const wavBytes = makeWav(200000, bits);
    const wav = K.parseWAV(wavBytes);
    const inner = await C.pack({ kind: 1, name: "audio-secreto.pdf", mime: "application/pdf", data: te.encode("%PDF fake") });
    await S.hide(wav.carrier, inner, "audio-pass-2026", 1);
    const { inner: out } = await S.reveal(K.parseWAV(wavBytes.slice()).carrier, "audio-pass-2026");
    const item = await C.unpack(out);
    assert.strictEqual(item.name, "audio-secreto.pdf");
    assert.strictEqual(td.decode(item.data), "%PDF fake");
    assert.deepStrictEqual([...wavBytes.subarray(0, 44)], [...makeWav(200000, bits).subarray(0, 44)], "la cabecera WAV no se toca");
  }
});

test("cifrado de texto suelto", async () => {
  const token = await C.encryptText("Mensaje con acentos: ñandú, café ☕", "texto-pass-2026");
  assert(token.startsWith("AS1."));
  assert.strictEqual(await C.decryptText(token, "texto-pass-2026"), "Mensaje con acentos: ñandú, café ☕");
  await assert.rejects(C.decryptText(token, "otra-pass-2026"), C.WrongPasswordError);
});

test("el flujo oculto no tiene firma fija", async () => {
  const a = noisyImage(50, 50), b = a.slice();
  const inner = await C.pack({ kind: 0, data: te.encode("igual") });
  await S.hide(K.imageCarrier(a), inner, "misma-clave-2026", 1);
  await S.hide(K.imageCarrier(b), inner, "misma-clave-2026", 1);
  assert(a.some((v, i) => v !== b[i]), "dos ocultaciones iguales deben producir resultados distintos");
});

(async () => {
  let ok = 0;
  for (const t of tests) {
    const t0 = Date.now();
    try { await t.fn(); ok++; console.log(`  ✔ ${t.name} (${Date.now() - t0} ms)`); }
    catch (e) { console.log(`  ✘ ${t.name}\n    ${e && e.stack}`); }
  }
  console.log(`\n${ok}/${tests.length} pruebas superadas`);
  process.exit(ok === tests.length ? 0 : 1);
})();
