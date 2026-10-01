/*!
 * Atlas Signal — módulo de cifrado
 * © 2026 Germán Cárdenas — Licencia MIT
 *
 * AES-256-GCM con clave derivada de contraseña (PBKDF2-SHA256).
 * El contenido se empaqueta (tipo, nombre, tipo MIME, datos), se comprime
 * si conviene y se cifra. El nombre del archivo viaja DENTRO del cifrado.
 */
(function (root) {
  "use strict";

  const subtle = root.crypto.subtle;
  const te = new TextEncoder();
  const td = new TextDecoder();

  const FORMAT_VERSION = 1;
  const KDF_ITERATIONS = 600000;
  const LAYOUT_ITERATIONS = 150000;
  const LAYOUT_SALT = te.encode("ATLAS-SIGNAL/layout/v1");
  const SALT_LEN = 16;
  const IV_LEN = 12;
  const TEXT_PREFIX = "AS1.";

  const KIND = { TEXT: 0, FILE: 1 };

  function randomBytes(n) {
    const out = new Uint8Array(n);
    root.crypto.getRandomValues(out);
    return out;
  }

  async function pbkdf2(password, salt, iterations, bits) {
    const base = await subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveBits", "deriveKey"]);
    return new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, bits));
  }

  /** Clave de 32 bytes que decide DÓNDE se esconden los bits (no protege el contenido). */
  function layoutKey(password) {
    return pbkdf2(password, LAYOUT_SALT, LAYOUT_ITERATIONS, 256);
  }

  async function aesKey(password, salt) {
    const raw = await pbkdf2(password, salt, KDF_ITERATIONS, 256);
    return subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async function streamThrough(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const canCompress = typeof root.CompressionStream === "function";

  /** Empaqueta el contenido: [flags][ cuerpo (posiblemente comprimido) ] */
  async function pack({ kind, name = "", mime = "", data }) {
    const nameBytes = te.encode(name).slice(0, 65535);
    const mimeBytes = te.encode(mime).slice(0, 255);
    const body = new Uint8Array(1 + 1 + 2 + nameBytes.length + 1 + mimeBytes.length + data.length);
    let o = 0;
    body[o++] = FORMAT_VERSION;
    body[o++] = kind;
    body[o++] = nameBytes.length >> 8;
    body[o++] = nameBytes.length & 255;
    body.set(nameBytes, o); o += nameBytes.length;
    body[o++] = mimeBytes.length;
    body.set(mimeBytes, o); o += mimeBytes.length;
    body.set(data, o);

    let flags = 0;
    let payload = body;
    if (canCompress) {
      const deflated = await streamThrough(body, new CompressionStream("deflate-raw"));
      if (deflated.length < body.length) { payload = deflated; flags |= 1; }
    }
    const out = new Uint8Array(1 + payload.length);
    out[0] = flags;
    out.set(payload, 1);
    return out;
  }

  async function unpack(inner) {
    const flags = inner[0];
    let body = inner.subarray(1);
    if (flags & 1) {
      if (typeof root.DecompressionStream !== "function") throw new Error("Este navegador no puede descomprimir el contenido.");
      body = await streamThrough(body, new DecompressionStream("deflate-raw"));
    }
    let o = 0;
    const version = body[o++];
    if (version !== FORMAT_VERSION) throw new Error("Versión de formato no soportada.");
    const kind = body[o++];
    const nameLen = (body[o] << 8) | body[o + 1]; o += 2;
    const name = td.decode(body.subarray(o, o + nameLen)); o += nameLen;
    const mimeLen = body[o++];
    const mime = td.decode(body.subarray(o, o + mimeLen)); o += mimeLen;
    return { kind, name, mime, data: body.slice(o) };
  }

  async function seal(inner, password) {
    const salt = randomBytes(SALT_LEN);
    const iv = randomBytes(IV_LEN);
    const key = await aesKey(password, salt);
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, inner));
    return { salt, iv, ct };
  }

  async function open(salt, iv, ct, password) {
    const key = await aesKey(password, salt);
    try {
      return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
    } catch (_) {
      throw new WrongPasswordError();
    }
  }

  class WrongPasswordError extends Error {
    constructor() { super("Contraseña incorrecta o no hay contenido oculto."); this.name = "WrongPasswordError"; }
  }

  // ---- Cifrado de texto suelto (sin portador) ----

  function toB64Url(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromB64Url(str) {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function encryptText(text, password) {
    const inner = await pack({ kind: KIND.TEXT, data: te.encode(text) });
    const { salt, iv, ct } = await seal(inner, password);
    const all = new Uint8Array(salt.length + iv.length + ct.length);
    all.set(salt, 0); all.set(iv, SALT_LEN); all.set(ct, SALT_LEN + IV_LEN);
    return TEXT_PREFIX + toB64Url(all);
  }

  async function decryptText(token, password) {
    const clean = token.trim().replace(/\s+/g, "");
    if (!clean.startsWith(TEXT_PREFIX)) throw new Error("El texto no tiene formato Atlas Signal (debe empezar por AS1.).");
    let all;
    try { all = fromB64Url(clean.slice(TEXT_PREFIX.length)); } catch (_) { throw new Error("El texto cifrado está dañado."); }
    if (all.length < SALT_LEN + IV_LEN + 16) throw new Error("El texto cifrado está incompleto.");
    const inner = await open(all.subarray(0, SALT_LEN), all.subarray(SALT_LEN, SALT_LEN + IV_LEN), all.subarray(SALT_LEN + IV_LEN), password);
    const item = await unpack(inner);
    return td.decode(item.data);
  }

  // ---- Utilidades de contraseña ----

  function generatePassword(length = 20) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.!?#";
    const out = [];
    const limit = 256 - (256 % alphabet.length);
    while (out.length < length) {
      for (const b of randomBytes(length * 2)) {
        if (b < limit && out.length < length) out.push(alphabet[b % alphabet.length]);
      }
    }
    return out.join("");
  }

  /** Estimación simple de fuerza: 0 (muy débil) a 4 (excelente). */
  function passwordStrength(pw) {
    if (!pw) return 0;
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
    const unique = new Set(pw).size;
    const bits = Math.log2(Math.max(pool, 2)) * Math.min(pw.length, unique * 2);
    if (bits < 35) return 0;
    if (bits < 50) return 1;
    if (bits < 65) return 2;
    if (bits < 85) return 3;
    return 4;
  }

  root.AtlasCrypto = {
    KIND, SALT_LEN, IV_LEN,
    layoutKey, pack, unpack, seal, open,
    encryptText, decryptText,
    generatePassword, passwordStrength,
    WrongPasswordError,
  };
})(globalThis);
