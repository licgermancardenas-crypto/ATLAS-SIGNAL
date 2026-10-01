/*!
 * Atlas Signal — motor de esteganografía
 * © 2026 Germán Cárdenas — Licencia MIT
 *
 * Los bits se reparten en posiciones pseudoaleatorias del portador mediante
 * una permutación con clave (red de Feistel + "cycle walking"), así no
 * quedan concentrados al principio del archivo ni hay cabeceras visibles.
 *
 * Flujo oculto:  sal(16) | iv(12) | longitud enmascarada(4) | datos cifrados
 */
(function (root) {
  "use strict";

  const ROUNDS = 6;
  const HEADER_LEN = 16 + 12 + 4;
  const CHUNK = 1 << 18; // posiciones por bloque antes de ceder el hilo

  function fmix32(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function readU32(bytes, o) {
    return ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  }

  /** Permutación pseudoaleatoria de [0, n) determinada por `key` (32 bytes). */
  function makePermutation(n, key) {
    let bits = Math.max(2, Math.ceil(Math.log2(n)));
    if (bits % 2) bits++;
    const half = bits / 2;
    const mask = half === 16 ? 0xffff : (1 << half) - 1;
    const roundKeys = [];
    for (let r = 0; r < ROUNDS; r++) roundKeys.push(readU32(key, 4 + r * 4));

    function encipher(x) {
      let L = Math.floor(x / (mask + 1));
      let R = x & mask;
      for (let r = 0; r < ROUNDS; r++) {
        const t = (L ^ fmix32(R ^ roundKeys[r])) & mask;
        L = R; R = t;
      }
      return L * (mask + 1) + R;
    }

    return function permute(i) {
      let x = i;
      do { x = encipher(x); } while (x >= n);
      return x;
    };
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  /**
   * carrier = { buf: Uint8Array, count: número de posiciones, index(s) → índice en buf }
   * depth   = bits menos significativos usados por posición (1 o 2)
   */
  function capacity(carrier, depth) {
    return Math.max(0, Math.floor((carrier.count * depth) / 8) - HEADER_LEN);
  }

  async function writeBits(carrier, depth, permute, bytes, onProgress) {
    const { buf, index } = carrier;
    const totalBits = bytes.length * 8;
    const slots = Math.ceil(totalBits / depth);
    const clear = ~((1 << depth) - 1);
    let p = 0;
    for (let start = 0; start < slots; start += CHUNK) {
      const end = Math.min(slots, start + CHUNK);
      for (let i = start; i < end; i++) {
        let v = 0;
        for (let j = 0; j < depth; j++, p++) {
          v <<= 1;
          if (p < totalBits) v |= (bytes[p >> 3] >> (7 - (p & 7))) & 1;
        }
        const idx = index(permute(i));
        buf[idx] = (buf[idx] & clear) | v;
      }
      if (onProgress) onProgress(end / slots);
      await tick();
    }
  }

  async function readBits(carrier, depth, permute, byteOffset, byteCount, onProgress) {
    const { buf, index } = carrier;
    const out = new Uint8Array(byteCount);
    const firstBit = byteOffset * 8;
    const lastBit = firstBit + byteCount * 8;
    let slot = -1, value = 0, done = 0;
    for (let p = firstBit; p < lastBit; p++) {
      const s = Math.floor(p / depth);
      if (s !== slot) { slot = s; value = buf[index(permute(s))]; }
      const bit = (value >> (depth - 1 - (p % depth))) & 1;
      const q = p - firstBit;
      out[q >> 3] |= bit << (7 - (q & 7));
      if (++done % (CHUNK * 8) === 0) { if (onProgress) onProgress(done / (byteCount * 8)); await tick(); }
    }
    return out;
  }

  /** Oculta `inner` (ya empaquetado) cifrándolo con `password` dentro del portador. */
  async function hide(carrier, inner, password, depth, onProgress) {
    const C = root.AtlasCrypto;
    const cap = capacity(carrier, depth);
    const progress = (f) => onProgress && onProgress(f);
    progress(0.02);
    const layout = await C.layoutKey(password);
    progress(0.1);
    const { salt, iv, ct } = await C.seal(inner, password);
    if (ct.length > cap) {
      const err = new Error(`El contenido cifrado (${ct.length} bytes) no cabe en el portador (capacidad ${cap} bytes).`);
      err.code = "CAPACITY";
      throw err;
    }
    progress(0.25);
    const lenMasked = (ct.length ^ readU32(layout, 0)) >>> 0;
    const stream = new Uint8Array(HEADER_LEN + ct.length);
    stream.set(salt, 0);
    stream.set(iv, 16);
    stream[28] = lenMasked >>> 24; stream[29] = (lenMasked >>> 16) & 255;
    stream[30] = (lenMasked >>> 8) & 255; stream[31] = lenMasked & 255;
    stream.set(ct, HEADER_LEN);

    const permute = makePermutation(carrier.count, layout);
    await writeBits(carrier, depth, permute, stream, (f) => progress(0.25 + f * 0.75));
    return { bytesHidden: stream.length, capacity: cap + HEADER_LEN };
  }

  /** Busca y descifra contenido oculto. Prueba las profundidades indicadas. */
  async function reveal(carrier, password, depths = [1, 2], onProgress) {
    const C = root.AtlasCrypto;
    const layout = await C.layoutKey(password);
    const permute = makePermutation(carrier.count, layout);
    const mask = readU32(layout, 0);
    let lastError = new C.WrongPasswordError();

    for (const depth of depths) {
      const cap = capacity(carrier, depth);
      if (cap <= 16) continue;
      const header = await readBits(carrier, depth, permute, 0, HEADER_LEN);
      const len = (readU32(header, 28) ^ mask) >>> 0;
      if (len < 17 || len > cap) continue; // GCM: al menos 1 byte + 16 de etiqueta
      const ct = await readBits(carrier, depth, permute, HEADER_LEN, len, onProgress);
      try {
        const inner = await C.open(header.subarray(0, 16), header.subarray(16, 28), ct, password);
        return { inner, depth };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }

  root.AtlasStego = { HEADER_LEN, capacity, hide, reveal, makePermutation };
})(globalThis);
