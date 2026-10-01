/*!
 * Atlas Signal — interfaz
 * © 2026 Germán Cárdenas — Licencia MIT
 */
(function () {
  "use strict";

  const C = window.AtlasCrypto;
  const S = window.AtlasStego;
  const K = window.AtlasCarriers;
  const $ = (id) => document.getElementById(id);
  const te = new TextEncoder();
  const MIN_PW = 8;

  // ---------- utilidades ----------

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    const units = ["KB", "MB", "GB"];
    let v = n / 1024, u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return `${v.toFixed(v < 10 ? 2 : 1)} ${units[u]}`;
  }

  function formatDuration(sec) {
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  /** Nombre de archivo seguro: sin rutas ni caracteres reservados. */
  function safeName(name, fallback) {
    const base = String(name || "").split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/^\.+/, "").trim();
    return (base || fallback).slice(0, 180);
  }

  function baseName(name) { return name.replace(/\.[^.]+$/, ""); }

  function toast(msg, type = "") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    $("toasts").appendChild(el);
    setTimeout(() => el.remove(), type === "error" ? 6000 : 3200);
  }

  async function copy(text, what = "Copiado") {
    try { await navigator.clipboard.writeText(text); toast(`${what} al portapapeles`, "ok"); }
    catch (_) { toast("No se pudo copiar automáticamente", "error"); }
  }

  function revokeAll(set) { for (const u of set) URL.revokeObjectURL(u); set.clear(); }

  const overlay = {
    show(msg) { $("overlayMsg").textContent = msg; this.set(0); $("overlay").hidden = false; },
    set(f) {
      const pct = Math.max(0, Math.min(1, f));
      $("ringFg").style.strokeDashoffset = String(326.7 * (1 - pct));
      $("overlayPct").textContent = `${Math.round(pct * 100)}%`;
    },
    msg(m) { $("overlayMsg").textContent = m; },
    hide() { $("overlay").hidden = true; },
  };
  const paint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  // ---------- navegación ----------

  const views = ["ocultar", "extraer", "texto", "historial", "acerca"];
  function go(view) {
    if (!views.includes(view)) view = "ocultar";
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
    document.querySelectorAll(".nav-item").forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle("active", on);
      b.setAttribute("aria-current", on ? "page" : "false");
    });
    if (view === "historial") renderHistory();
  }
  document.querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.view; }));
  window.addEventListener("hashchange", () => go(location.hash.slice(1)));

  // ---------- zonas de arrastre ----------

  function setupDrop(zone, input, onFile) {
    const pick = (file) => { if (file) onFile(file); };
    input.addEventListener("change", () => { pick(input.files[0]); input.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove("drag")));
    zone.addEventListener("drop", (e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); });
  }

  function showFilled(zone, filled) {
    zone.querySelector(".drop-empty").hidden = filled;
    zone.querySelector(".drop-filled").hidden = !filled;
  }

  function previewInto(el, kind, url) {
    el.replaceChildren();
    if (kind === "image") {
      const img = new Image(); img.alt = ""; img.src = url; el.appendChild(img);
    } else {
      el.innerHTML = '<svg class="audio-glyph"><use href="#i-wave"/></svg>';
    }
  }

  // ---------- campos de contraseña ----------

  document.querySelectorAll("[data-pw]").forEach((wrap) => {
    const input = wrap.querySelector("input");
    const t = wrap.querySelector("[data-toggle]");
    const g = wrap.querySelector("[data-generate]");
    const c = wrap.querySelector("[data-copy]");
    if (t) t.addEventListener("click", () => { input.type = input.type === "password" ? "text" : "password"; });
    if (g) g.addEventListener("click", () => {
      const pw = C.generatePassword(20);
      input.value = pw; input.type = "text";
      if (input.id === "hidePw") { $("hidePw2").value = pw; $("hidePw2").type = "text"; }
      input.dispatchEvent(new Event("input"));
      toast("Contraseña generada. Cópiala y guárdala en un lugar seguro.", "ok");
    });
    if (c) c.addEventListener("click", () => input.value ? copy(input.value, "Contraseña copiada") : toast("No hay contraseña que copiar"));
  });

  const STRENGTH = ["Muy débil", "Débil", "Aceptable", "Fuerte", "Excelente"];
  function updateStrength() {
    const pw = $("hidePw").value;
    const el = $("hideStrength");
    if (!pw) { el.removeAttribute("data-level"); el.querySelector("span").textContent = ""; return; }
    const lvl = pw.length < MIN_PW ? 0 : C.passwordStrength(pw);
    el.dataset.level = lvl;
    el.querySelector("span").textContent = pw.length < MIN_PW ? `Mínimo ${MIN_PW} caracteres` : STRENGTH[lvl];
  }

  // =====================================================================
  //  OCULTAR
  // =====================================================================

  const hide = { cover: null, coverURL: null, mode: "file", file: null, depth: 1, outURLs: new Set() };

  setupDrop($("coverDrop"), $("coverInput"), async (file) => {
    const kind = K.kindOf(file);
    if (!kind) return toast("Formato no soportado. Usa PNG, BMP, JPG, WEBP o WAV.", "error");
    overlay.show("Analizando portador…"); overlay.set(0.3); await paint();
    try {
      const cover = await K.loadCover(file);
      hide.cover = cover;
      if (hide.coverURL) URL.revokeObjectURL(hide.coverURL);
      hide.coverURL = URL.createObjectURL(file);
      previewInto($("coverPreview"), cover.kind, hide.coverURL);
      $("coverName").textContent = file.name;
      const hint = $("coverHint");
      if (cover.kind === "image") {
        $("coverInfo").textContent = `${cover.width} × ${cover.height} px · ${formatBytes(file.size)}`;
        hint.hidden = !cover.lossyInput;
        hint.textContent = "El resultado se guardará como PNG sin pérdida (será más pesado que el original).";
      } else {
        const w = cover.wav;
        $("coverInfo").textContent = `${w.channels === 1 ? "Mono" : w.channels === 2 ? "Estéreo" : w.channels + " canales"} · ${w.bits} bits · ${(w.sampleRate / 1000).toFixed(1)} kHz · ${formatDuration(w.duration)}`;
        hint.hidden = w.bits !== 8;
        hint.textContent = "Audio de 8 bits: los cambios pueden ser audibles. Mejor usa WAV de 16 o 24 bits.";
      }
      showFilled($("coverDrop"), true);
      $("hideResult").hidden = true;
    } catch (e) {
      toast(e.message || "No se pudo leer el archivo.", "error");
    } finally {
      overlay.hide(); updateHideState();
    }
  });

  setupDrop($("payloadDrop"), $("payloadInput"), (file) => {
    hide.file = file;
    $("payloadName").textContent = file.name;
    $("payloadInfo").textContent = formatBytes(file.size);
    showFilled($("payloadDrop"), true);
    updateHideState();
  });

  $("payloadMode").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    hide.mode = b.dataset.mode;
    $("payloadMode").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    $("payloadFileBox").hidden = hide.mode !== "file";
    $("payloadTextBox").hidden = hide.mode !== "text";
    updateHideState();
  });

  $("payloadText").addEventListener("input", () => {
    const n = $("payloadText").value.length;
    $("payloadTextCount").textContent = `${n.toLocaleString("es")} caracteres`;
    updateHideState();
  });

  $("depthMode").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    hide.depth = Number(b.dataset.depth);
    $("depthMode").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    updateHideState();
  });

  ["hidePw", "hidePw2"].forEach((id) => $(id).addEventListener("input", () => { updateStrength(); updateHideState(); }));

  function carrierOf(item) { return item.kind === "audio" ? item.wav.carrier : item.carrier; }

  function payloadEstimate() {
    if (hide.mode === "file") return hide.file ? hide.file.size + te.encode(hide.file.name).length + hide.file.type.length + 40 : 0;
    const t = $("payloadText").value;
    return t ? te.encode(t).length + 40 : 0;
  }

  function updateHideState() {
    const pw = $("hidePw").value, pw2 = $("hidePw2").value;
    const match = $("pwMatch");
    if (!pw2) { match.textContent = ""; match.className = "hint"; }
    else if (pw === pw2) { match.textContent = "Las contraseñas coinciden"; match.className = "hint good"; }
    else { match.textContent = "Las contraseñas no coinciden"; match.className = "hint bad"; }

    const cap = hide.cover ? S.capacity(carrierOf(hide.cover), hide.depth) : 0;
    const need = payloadEstimate();
    const bar = $("capBar");
    if (!hide.cover) { $("capText").textContent = "Carga un portador"; bar.style.width = "0"; }
    else {
      const ratio = cap ? need / cap : 1;
      bar.style.width = `${Math.min(100, ratio * 100)}%`;
      bar.classList.toggle("over", ratio > 1);
      $("capText").textContent = need
        ? `${formatBytes(need)} de ${formatBytes(cap)}${ratio > 1 ? " · no cabe (se intentará comprimir)" : ""}`
        : `Hasta ${formatBytes(cap)}`;
    }
    const hasPayload = hide.mode === "file" ? !!hide.file : $("payloadText").value.length > 0;
    $("hideBtn").disabled = !(hide.cover && hasPayload && pw.length >= MIN_PW && pw === pw2);
  }

  $("hideBtn").addEventListener("click", async () => {
    const cover = hide.cover;
    const password = $("hidePw").value;
    overlay.show("Cifrando contenido…"); await paint();
    try {
      let item;
      if (hide.mode === "file") {
        item = { kind: C.KIND.FILE, name: hide.file.name, mime: hide.file.type || "", data: new Uint8Array(await hide.file.arrayBuffer()) };
      } else {
        item = { kind: C.KIND.TEXT, data: te.encode($("payloadText").value) };
      }
      overlay.set(0.05);
      const inner = await C.pack(item);

      // Trabajar sobre una copia para poder repetir la operación con el mismo portador.
      let carrier, work;
      if (cover.kind === "image") { work = cover.rgba.slice(); carrier = K.imageCarrier(work); }
      else { work = cover.bytes.slice(); carrier = K.parseWAV(work).carrier; }

      const stats = await S.hide(carrier, inner, password, hide.depth, (f) => {
        overlay.set(0.05 + f * 0.85);
        if (f > 0.25) overlay.msg("Dispersando bits en el portador…");
      });

      overlay.msg("Generando archivo…"); overlay.set(0.92); await paint();
      let blob, outName;
      if (cover.kind === "image") {
        blob = new Blob([K.encodePNG(work, cover.width, cover.height)], { type: "image/png" });
        outName = `${baseName(cover.name)}.png`;
      } else {
        blob = new Blob([work], { type: "audio/wav" });
        outName = `${baseName(cover.name)}.wav`;
      }
      overlay.set(1);

      revokeAll(hide.outURLs);
      const url = URL.createObjectURL(blob); hide.outURLs.add(url);
      const prev = document.createElement("div"); prev.className = "preview";
      previewInto(prev, cover.kind, url);
      $("hideResultPreview").replaceChildren(prev);
      if (cover.kind === "audio") {
        const audio = document.createElement("audio"); audio.controls = true; audio.src = url; audio.style.width = "180px"; audio.style.marginTop = "10px";
        $("hideResultPreview").appendChild(audio);
      }
      const dl = $("hideDownload"); dl.href = url; dl.download = outName;
      const used = Math.round((stats.bytesHidden / stats.capacity) * 100);
      $("hideResultMeta").innerHTML = "";
      [["Archivo", outName], ["Tamaño", formatBytes(blob.size)], ["Contenido", item.kind === C.KIND.FILE ? item.name : "Mensaje de texto"],
       ["Ocupado", `${formatBytes(stats.bytesHidden)} (${used}% de la capacidad)`], ["Modo", hide.depth === 1 ? "Sigiloso · 1 bit" : "Capacidad · 2 bits"]]
        .forEach(([k, v]) => { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; $("hideResultMeta").append(dt, dd); });
      $("hideResult").hidden = false;
      $("hideResult").scrollIntoView({ behavior: "smooth", block: "nearest" });
      addHistory({ op: "hide", carrier: cover.name, content: item.kind === C.KIND.FILE ? item.name : "Mensaje", result: `${outName} · ${formatBytes(blob.size)}` });
    } catch (e) {
      console.error(e);
      toast(e.code === "CAPACITY" ? `${e.message} Usa un portador más grande o el modo Capacidad.` : (e.message || "Error al ocultar."), "error");
    } finally {
      overlay.hide();
    }
  });

  // =====================================================================
  //  EXTRAER
  // =====================================================================

  const ext = { item: null, url: null, outURLs: new Set() };

  setupDrop($("stegoDrop"), $("stegoInput"), async (file) => {
    overlay.show("Leyendo archivo…"); overlay.set(0.3); await paint();
    try {
      const item = await K.loadStego(file);
      ext.item = item;
      if (ext.url) URL.revokeObjectURL(ext.url);
      ext.url = URL.createObjectURL(file);
      previewInto($("stegoPreview"), item.kind, ext.url);
      $("stegoName").textContent = file.name;
      $("stegoInfo").textContent = item.kind === "image" ? `${item.width} × ${item.height} px · ${formatBytes(file.size)}` : `WAV · ${formatDuration(item.wav.duration)} · ${formatBytes(file.size)}`;
      showFilled($("stegoDrop"), true);
      $("extractResult").hidden = true;
    } catch (e) {
      toast(e.message || "No se pudo leer el archivo.", "error");
    } finally {
      overlay.hide(); updateExtractState();
    }
  });

  function updateExtractState() { $("extractBtn").disabled = !(ext.item && $("extractPw").value.length > 0); }
  $("extractPw").addEventListener("input", updateExtractState);
  $("extractPw").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("extractBtn").disabled) $("extractBtn").click(); });

  $("extractBtn").addEventListener("click", async () => {
    const item = ext.item;
    overlay.show("Buscando contenido oculto…"); overlay.set(0.1); await paint();
    try {
      const carrier = carrierOf(item);
      const { inner } = await S.reveal(carrier, $("extractPw").value, [1, 2], (f) => overlay.set(0.2 + f * 0.7));
      overlay.msg("Descifrando…"); overlay.set(0.95);
      const payload = await C.unpack(inner);
      overlay.set(1);
      revokeAll(ext.outURLs);
      if (payload.kind === C.KIND.TEXT) {
        $("extractTextOut").value = new TextDecoder().decode(payload.data);
        $("extractText").hidden = false; $("extractFile").hidden = true;
      } else {
        const name = safeName(payload.name, "recuperado.bin");
        const blob = new Blob([payload.data], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob); ext.outURLs.add(url);
        $("extractFileName").textContent = name;
        $("extractFileInfo").textContent = `${formatBytes(payload.data.length)}${payload.mime ? " · " + payload.mime : ""}`;
        const dl = $("extractDownload"); dl.href = url; dl.download = name;
        $("extractFile").hidden = false; $("extractText").hidden = true;
      }
      $("extractResult").hidden = false;
      $("extractResult").scrollIntoView({ behavior: "smooth", block: "nearest" });
      addHistory({ op: "extract", carrier: item.name, content: payload.kind === C.KIND.TEXT ? "Mensaje" : safeName(payload.name, "archivo"), result: formatBytes(payload.data.length) });
    } catch (e) {
      if (!(e instanceof C.WrongPasswordError)) console.error(e);
      $("extractResult").hidden = true;
      toast(e instanceof C.WrongPasswordError ? "Contraseña incorrecta, o este archivo no contiene nada oculto (o fue modificado)." : (e.message || "Error al extraer."), "error");
    } finally {
      overlay.hide();
    }
  });

  $("extractCopy").addEventListener("click", () => copy($("extractTextOut").value, "Mensaje copiado"));

  // =====================================================================
  //  CIFRAR TEXTO
  // =====================================================================

  async function runText(encrypt) {
    const input = $("txtIn").value, pw = $("txtPw").value;
    if (!input.trim()) return toast(encrypt ? "Escribe un mensaje para cifrar." : "Pega un texto cifrado AS1.…", "error");
    if (encrypt && pw.length < MIN_PW) return toast(`La contraseña debe tener al menos ${MIN_PW} caracteres.`, "error");
    if (!pw) return toast("Introduce la contraseña.", "error");
    overlay.show(encrypt ? "Cifrando…" : "Descifrando…"); overlay.set(0.4); await paint();
    try {
      const out = encrypt ? await C.encryptText(input, pw) : await C.decryptText(input, pw);
      $("txtOut").value = out;
      $("txtOutLabel").textContent = encrypt ? "Texto cifrado" : "Mensaje descifrado";
      $("txtOut").classList.toggle("mono", encrypt);
      $("txtOutBox").hidden = false;
      addHistory({ op: "text", carrier: "—", content: encrypt ? "Cifrado de texto" : "Descifrado de texto", result: `${out.length.toLocaleString("es")} caracteres` });
    } catch (e) {
      toast(e instanceof C.WrongPasswordError ? "Contraseña incorrecta o texto alterado." : e.message, "error");
    } finally {
      overlay.hide();
    }
  }
  $("txtEncrypt").addEventListener("click", () => runText(true));
  $("txtDecrypt").addEventListener("click", () => runText(false));
  $("txtCopy").addEventListener("click", () => copy($("txtOut").value, "Resultado copiado"));

  // =====================================================================
  //  HISTORIAL (solo local, sin secretos)
  // =====================================================================

  const HKEY = "atlas-signal:history", HON = "atlas-signal:history-on";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* almacenamiento no disponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* nada */ } },
  };

  function addHistory(entry) {
    if (!store.get(HON, false)) return;
    const list = store.get(HKEY, []);
    list.unshift({ ...entry, date: new Date().toISOString() });
    store.set(HKEY, list.slice(0, 200));
  }

  const OPS = { hide: ["Ocultar", "hide"], extract: ["Extraer", "extract"], text: ["Texto", "text"] };
  function renderHistory() {
    $("histToggle").checked = store.get(HON, false);
    const list = store.get(HKEY, []);
    const body = $("histBody");
    body.replaceChildren();
    for (const h of list) {
      const tr = document.createElement("tr");
      const d = new Date(h.date);
      const cells = [d.toLocaleString("es", { dateStyle: "short", timeStyle: "short" }), null, h.carrier, h.content, h.result];
      cells.forEach((v, i) => {
        const td = document.createElement("td");
        if (i === 1) { const [label, cls] = OPS[h.op] || [h.op, "text"]; const s = document.createElement("span"); s.className = `tag ${cls}`; s.textContent = label; td.appendChild(s); }
        else td.textContent = v;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
    $("histEmpty").hidden = list.length > 0;
    $("histEmpty").textContent = store.get(HON, false) ? "Todavía no hay operaciones registradas." : "El registro está desactivado. Actívalo si quieres llevar un historial en este navegador.";
  }
  $("histToggle").addEventListener("change", (e) => { store.set(HON, e.target.checked); renderHistory(); });
  $("histClear").addEventListener("click", () => { store.del(HKEY); renderHistory(); toast("Historial borrado", "ok"); });

  // ---------- inicio ----------
  if (!window.crypto || !window.crypto.subtle) {
    toast("Este navegador no permite cifrado seguro. Abre Atlas Signal con un navegador moderno (Chrome, Edge, Firefox).", "error");
  }
  go(location.hash.slice(1));
  updateHideState();
})();
