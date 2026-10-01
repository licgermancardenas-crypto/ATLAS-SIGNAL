/*!
 * Atlas Signal — portadores (imágenes y audio)
 * © 2026 Germán Cárdenas — Licencia MIT
 *
 * Imágenes: se usan los canales R, G y B de los píxeles totalmente opacos.
 *           La salida siempre es PNG sin pérdida.
 * Audio:    WAV PCM 8/16/24/32 bits o coma flotante de 32 bits; se usa el
 *           byte menos significativo de cada muestra.
 */
(function (root) {
  "use strict";

  // ---------- Imágenes ----------

  function imageCarrier(rgba) {
    const pixels = rgba.length >> 2;
    let opaque = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 255) opaque++;

    if (opaque === pixels) {
      return {
        buf: rgba,
        count: pixels * 3,
        index: (s) => { const q = (s / 3) | 0; return q * 4 + (s - q * 3); },
      };
    }
    const map = new Uint32Array(opaque);
    for (let p = 0, k = 0; p < pixels; p++) if (rgba[p * 4 + 3] === 255) map[k++] = p;
    return {
      buf: rgba,
      count: opaque * 3,
      index: (s) => { const q = (s / 3) | 0; return map[q] * 4 + (s - q * 3); },
    };
  }

  function isPNG(bytes) {
    return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }

  function decodePNG(arrayBuffer) {
    const img = root.UPNG.decode(arrayBuffer);
    const rgba = new Uint8Array(root.UPNG.toRGBA8(img)[0]);
    return { width: img.width, height: img.height, rgba };
  }

  /** Decodificación con el navegador (JPG, WEBP, BMP, GIF…). Solo para portadores de entrada. */
  async function decodeWithBrowser(file) {
    const bmp = await createImageBitmap(file, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    bmp.close && bmp.close();
    return { width: canvas.width, height: canvas.height, rgba: new Uint8Array(data.buffer) };
  }

  function encodePNG(rgba, width, height) {
    const ab = rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength ? rgba.buffer : rgba.slice().buffer;
    return new Uint8Array(root.UPNG.encode([ab], width, height, 0));
  }

  // ---------- Audio WAV ----------

  function parseWAV(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("El archivo no es un WAV válido.");

    let fmt = null, dataOffset = -1, dataSize = 0;
    for (let o = 12; o + 8 <= bytes.length;) {
      const id = tag(o);
      const size = dv.getUint32(o + 4, true);
      if (id === "fmt ") {
        let format = dv.getUint16(o + 8, true);
        if (format === 0xfffe && size >= 26) format = dv.getUint16(o + 32, true);
        fmt = {
          format,
          channels: dv.getUint16(o + 10, true),
          sampleRate: dv.getUint32(o + 12, true),
          bits: dv.getUint16(o + 22, true),
        };
      } else if (id === "data") {
        dataOffset = o + 8;
        dataSize = Math.min(size, bytes.length - dataOffset);
        break;
      }
      o += 8 + size + (size & 1);
    }
    if (!fmt || dataOffset < 0) throw new Error("El WAV no contiene datos de audio reconocibles.");
    const pcm = fmt.format === 1 && [8, 16, 24, 32].includes(fmt.bits);
    const float = fmt.format === 3 && fmt.bits === 32;
    if (!pcm && !float) throw new Error(`Formato WAV no soportado (código ${fmt.format}, ${fmt.bits} bits). Usa WAV PCM.`);

    const bps = fmt.bits / 8;
    const samples = Math.floor(dataSize / bps);
    return {
      ...fmt,
      samples,
      duration: samples / fmt.channels / fmt.sampleRate,
      carrier: { buf: bytes, count: samples, index: (s) => dataOffset + s * bps },
    };
  }

  // ---------- Carga de archivos ----------

  const IMAGE_EXT = /\.(png|bmp|jpe?g|webp|gif)$/i;
  const AUDIO_EXT = /\.wav$/i;

  function kindOf(file) {
    if (AUDIO_EXT.test(file.name) || file.type === "audio/wav" || file.type === "audio/x-wav") return "audio";
    if (IMAGE_EXT.test(file.name) || file.type.startsWith("image/")) return "image";
    return null;
  }

  /** Carga un portador para OCULTAR. */
  async function loadCover(file) {
    const kind = kindOf(file);
    if (!kind) throw new Error("Formato no soportado. Usa una imagen (PNG, BMP, JPG, WEBP) o un audio WAV.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind === "audio") return { kind, name: file.name, bytes, wav: parseWAV(bytes) };
    const img = isPNG(bytes) ? decodePNG(bytes.buffer) : await decodeWithBrowser(file);
    return { kind, name: file.name, ...img, carrier: imageCarrier(img.rgba), lossyInput: !isPNG(bytes) };
  }

  /** Carga un archivo para EXTRAER (PNG o WAV generados por Atlas Signal). */
  async function loadStego(file) {
    const kind = kindOf(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind === "audio") return { kind, name: file.name, bytes, wav: parseWAV(bytes) };
    if (!isPNG(bytes)) throw new Error("Para extraer se necesita el PNG o WAV generado por Atlas Signal.");
    const img = decodePNG(bytes.buffer);
    return { kind: "image", name: file.name, ...img, carrier: imageCarrier(img.rgba) };
  }

  root.AtlasCarriers = { loadCover, loadStego, encodePNG, parseWAV, imageCarrier, decodePNG, kindOf };
})(globalThis);
