/* ============================================================
 * GRGC Phone Tracker — app.js
 * Two modes in one app:
 *   • PROTECT  — runs on the phone: reports GPS, battery, obeys
 *                remote commands (alarm / lock / message / …)
 *   • FIND     — the admin dashboard: live map, history, controls
 * Backend: Supabase (Postgres + Auth + Realtime) with RLS.
 * ============================================================ */
(() => {
  "use strict";

  const CFG = window.TRACKER_CONFIG;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  /* ---------------- state ---------------- */
  const S = {
    session: null,
    devices: [],
    device: null,          // active device row
    deviceId: localStorage.getItem("pt:deviceId") || null,
    tracking: false,
    stolenLocal: false,
    watchId: null,
    tickTimer: null,
    pollTimer: null,
    wakeLock: null,
    audioCtx: null,
    battery: null,
    lastFix: null,
    cmdChannel: null,
    locChannel: null,
    devChannel: null,
    inFlightCmds: new Set(),
    pinAttempts: 0,
    fullscreenTaken: false,
    // dashboard
    map: null,
    marker: null,
    trail: null,
    history: [],
    geocodeCache: new Map(),
  };

  /* ---------------- tiny helpers ---------------- */
  const nowIso = () => new Date().toISOString();

  function toast(msg, kind = "info", ms = 3400) {
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.textContent = msg;
    $("#toast-host").appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function fmtRelTime(ts) {
    if (!ts) return "never";
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 45_000) return "just now";
    if (diff < 90_000) return "1 min ago";
    const m = Math.floor(diff / 60_000);
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h} h ago`;
    return new Date(ts).toLocaleString();
  }

  function fmtClock(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371e3, p = Math.PI / 180;
    const a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 +
      Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p)) / 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  async function sha256hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const pinHashFor = (deviceId, pin) => sha256hex(`${deviceId}:${pin}`);

  /* ---------------- modal ---------------- */
  function showModal({ title, body = "", input = undefined, inputType = "text", placeholder = "", okText = "OK", cancelText = "Cancel", danger = false }) {
    return new Promise((resolve) => {
      const host = $("#modal-host");
      $("#modal-title").textContent = title;
      const bodyEl = $("#modal-body");
      bodyEl.textContent = body || "";
      bodyEl.hidden = !body;
      const inp = $("#modal-input");
      const hasInput = input !== undefined;
      if (hasInput) {
        inp.hidden = false;
        inp.type = inputType;
        inp.value = input ?? "";
        inp.placeholder = placeholder;
      } else inp.hidden = true;
      $("#modal-error").hidden = true;
      const okBtn = $("#modal-ok"), cancelBtn = $("#modal-cancel");
      okBtn.textContent = okText;
      okBtn.className = "btn " + (danger ? "btn-danger" : "btn-primary");
      cancelBtn.textContent = cancelText;
      const close = (val) => {
        host.hidden = true;
        okBtn.onclick = cancelBtn.onclick = null;
        inp.onkeydown = null;
        resolve(val);
      };
      okBtn.onclick = () => close(hasInput ? inp.value : true);
      cancelBtn.onclick = () => close(null);
      inp.onkeydown = (e) => { if (e.key === "Enter") close(inp.value); };
      host.hidden = false;
      if (hasInput) setTimeout(() => { inp.focus(); inp.select(); }, 60);
    });
  }

  /* ---------------- view routing ---------------- */
  const VIEWS = ["login", "tracker", "dashboard", "help"];
  let currentView = "login";

  function showView(name) {
    if (!VIEWS.includes(name)) name = "tracker";
    // "help" is public; everything else needs a session
    if (name !== "login" && name !== "help" && !S.session) name = "login";
    currentView = name;
    VIEWS.forEach((v) => { $("#view-" + v).hidden = v !== name; });
    $("#app-header").hidden = !S.session || name === "login";
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    if ((location.hash || "").slice(1) !== name) location.hash = name;
    if (name === "dashboard") onDashboardShown();
    if (name === "help") $("#help-back").hidden = !!S.session;
    window.scrollTo(0, 0);
  }

  /* ================================================================
   * AUTH
   * ================================================================ */
  let authMode = "signin";

  function setAuthMode(mode) {
    authMode = mode;
    $("#seg-signin").classList.toggle("active", mode === "signin");
    $("#seg-signup").classList.toggle("active", mode === "signup");
    $("#auth-submit").textContent = mode === "signin" ? "Sign in" : "Create account";
    $("#auth-password").autocomplete = mode === "signin" ? "current-password" : "new-password";
    $("#auth-error").hidden = true;
  }

  $("#seg-signin").onclick = () => setAuthMode("signin");
  $("#seg-signup").onclick = () => setAuthMode("signup");

  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const errEl = $("#auth-error");
    errEl.hidden = true;
    $("#auth-submit").disabled = true;
    try {
      if (authMode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          errEl.textContent = "Account created — check your email to confirm, then sign in.";
          errEl.hidden = false;
          setAuthMode("signin");
          return;
        }
        toast("Account created — welcome!", "ok");
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast("Signed in", "ok");
      }
    } catch (err) {
      errEl.textContent = err.message || String(err);
      errEl.hidden = false;
    } finally {
      $("#auth-submit").disabled = false;
    }
  };

  $("#btn-signout").onclick = async () => {
    const ok = await showModal({
      title: "Sign out?",
      body: S.tracking ? "Protection is running on this device — signing out will stop it." : "",
      okText: "Sign out", danger: true,
    });
    if (!ok) return;
    stopTracking(true);
    await sb.auth.signOut();
  };

  /* ================================================================
   * DEVICES
   * ================================================================ */
  async function loadDevices() {
    const { data, error } = await sb.from("devices").select("*").order("created_at", { ascending: true });
    if (error) { toast("Could not load devices: " + error.message, "error"); return; }
    S.devices = data || [];
    if (S.deviceId && !S.devices.find((d) => d.id === S.deviceId)) {
      S.deviceId = null;
      localStorage.removeItem("pt:deviceId");
      S.device = null;
    }
    if (!S.deviceId && S.devices.length === 1) {
      await bindDevice(S.devices[0].id, { silent: true });
    } else if (S.deviceId) {
      S.device = S.devices.find((d) => d.id === S.deviceId) || null;
      if (S.device) S.stolenLocal = !!S.device.stolen_mode;
    }
    renderTrackerView();
    renderDeviceCards();
    renderTrackerStatus();
    $("#stolen-banner").hidden = !(S.tracking && S.stolenLocal);
    if (S.device && currentView === "dashboard") fillSettingsForm();
  }

  async function bindDevice(id, { silent = false } = {}) {
    S.deviceId = id;
    localStorage.setItem("pt:deviceId", id);
    S.device = S.devices.find((d) => d.id === id) || null;
    S.stolenLocal = !!S.device?.stolen_mode;
    if (!silent) toast(`This browser is now bound to “${S.device?.name || "device"}”`, "ok");
    renderTrackerView();
    renderTrackerStatus();
  }

  function renderTrackerView() {
    const hasSession = !!S.session;
    if (!hasSession) return;
    const bound = !!(S.deviceId && S.device);
    $("#tracker-setup").hidden = bound || S.devices.length > 0;
    $("#tracker-bind").hidden = bound || S.devices.length === 0;
    $("#tracker-active").hidden = !bound;
    if (!bound && S.devices.length > 0) {
      const list = $("#bind-list");
      list.innerHTML = "";
      S.devices.forEach((d) => {
        const b = document.createElement("button");
        b.className = "bind-item";
        const last = d.last_seen_at ? ` · last seen ${fmtRelTime(d.last_seen_at)}` : "";
        b.innerHTML = `<span>📱 ${escapeHtml(d.name)}</span><span class="muted tiny">${escapeHtml(last)}</span>`;
        b.onclick = () => bindDevice(d.id);
        list.appendChild(b);
      });
    }
    if (bound) {
      $("#dev-name") && ($("#dev-name").value = S.device.name);
      $("#st-queued").textContent = String(queue().length);
    }
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  $("#device-form").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("#dev-name").value.trim() || "My Phone";
    const pin = $("#dev-pin").value.trim();
    const message = $("#dev-message").value.trim();
    const normal = parseInt($("#dev-interval").value, 10) || 60;
    const stolenI = parseInt($("#dev-stolen-interval").value, 10) || 15;
    if (pin && !/^\d{4,6}$/.test(pin)) { toast("PIN must be 4–6 digits", "error"); return; }
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const { data, error } = await sb.from("devices").insert({
        name, owner_message: message, normal_interval_s: normal, stolen_interval_s: stolenI,
      }).select().single();
      if (error) throw error;
      if (pin) {
        const hash = await pinHashFor(data.id, pin);
        const { error: e2 } = await sb.from("devices").update({ pin_hash: hash }).eq("id", data.id);
        if (e2) throw e2;
        data.pin_hash = hash;
      }
      S.devices.push(data);
      await bindDevice(data.id, { silent: true });
      toast(`“${name}” registered`, "ok");
      $("#dev-pin").value = "";
      await startTracking();
    } catch (err) {
      toast("Registration failed: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  };

  $("#btn-register-new").onclick = () => {
    $("#tracker-bind").hidden = true;
    $("#tracker-setup").hidden = false;
  };

  $("#btn-forget").onclick = async () => {
    const ok = await showModal({
      title: "Unbind this browser?",
      body: "The device stays in your account — you can bind it again later. Protection on this browser stops.",
      okText: "Unbind",
    });
    if (!ok) return;
    stopTracking(true);
    localStorage.removeItem("pt:deviceId");
    S.deviceId = null; S.device = null;
    renderTrackerView();
  };

  /* ================================================================
   * TRACKER ENGINE (the "Protect" mode)
   * ================================================================ */
  function currentIntervalMs() {
    const d = S.device;
    const secs = S.stolenLocal ? (d?.stolen_interval_s || 15) : (d?.normal_interval_s || 60);
    return Math.max(10, secs) * 1000;
  }

  function ensureAudio() {
    try {
      if (!S.audioCtx) S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (S.audioCtx.state === "suspended") S.audioCtx.resume();
      return S.audioCtx;
    } catch { return null; }
  }

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        S.wakeLock = await navigator.wakeLock.request("screen");
        S.wakeLock.addEventListener("release", () => {});
      }
    } catch { /* unsupported or denied */ }
  }

  function tryEnterFullscreen() {
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fn) {
      Promise.resolve(fn.call(el)).then(() => { S.fullscreenTaken = true; }).catch(() => {});
    }
  }
  function exitFullscreenIfTaken() {
    if (!S.fullscreenTaken) return;
    S.fullscreenTaken = false;
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (fn) Promise.resolve(fn.call(document)).catch(() => {});
  }

  async function readBattery() {
    try {
      if (!navigator.getBattery) return;
      const b = await navigator.getBattery();
      const sync = () => { S.battery = { level: Math.round(b.level * 100), charging: b.charging }; renderTrackerStatus(); };
      b.addEventListener("levelchange", sync);
      b.addEventListener("chargingchange", sync);
      sync();
    } catch { /* unsupported */ }
  }

  function deviceInfoPayload() {
    const c = navigator.connection || {};
    return {
      ua: navigator.userAgent,
      lang: navigator.language,
      screen: `${screen.width}x${screen.height}`,
      dpr: window.devicePixelRatio,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      net: c.effectiveType || null,
      vendor: navigator.vendor || "",
      app: CFG.appVersion,
    };
  }

  /* ---- offline queue ---- */
  const QKEY = "pt:queue";
  const queue = () => { try { return JSON.parse(localStorage.getItem(QKEY) || "[]"); } catch { return []; } };
  const saveQueue = (q) => { localStorage.setItem(QKEY, JSON.stringify(q.slice(-500))); $("#st-queued") && ($("#st-queued").textContent = String(q.length)); };
  function enqueue(row) { const q = queue(); q.push(row); saveQueue(q); }
  async function flushQueue() {
    const q = queue();
    if (!q.length || !S.session) return;
    const pending = [...q];
    saveQueue([]);
    for (const row of pending) {
      const { error } = await sb.from("locations").insert(row);
      if (error) { enqueue(row); break; }
    }
    $("#st-queued") && ($("#st-queued").textContent = String(queue().length));
  }
  window.addEventListener("online", () => { toast("Back online — syncing…", "ok"); flushQueue(); });

  /* ---- position reporting ---- */
  async function reportFix(pos, reason = "tick") {
    const c = pos.coords;
    const lat = c.latitude, lon = c.longitude;
    const recordedAt = new Date(pos.timestamp || Date.now()).toISOString();
    if (S.lastFix && Date.now() - S.lastFix.at < 8000 && haversine(S.lastFix.lat, S.lastFix.lon, lat, lon) < 25) {
      heartbeat();
      return null;
    }
    const row = {
      device_id: S.deviceId, lat, lon,
      accuracy_m: c.accuracy ?? null, altitude_m: c.altitude ?? null,
      speed_mps: c.speed ?? null, heading_deg: c.heading ?? null,
      battery_level: S.battery?.level ?? null, battery_charging: S.battery?.charging ?? null,
      recorded_at: recordedAt,
    };
    const { error } = await sb.from("locations").insert(row);
    if (error) {
      if ((error.message || "").toLowerCase().includes("row-level") || error.code === "42501") {
        toast("Not authorized — please sign in again", "error");
      } else {
        enqueue(row);
      }
      return null;
    }
    S.lastFix = { lat, lon, at: Date.now(), acc: c.accuracy, recordedAt, reason };
    await sb.from("devices").update({
      last_seen_at: recordedAt, last_lat: lat, last_lon: lon, accuracy_m: c.accuracy ?? null,
      battery_level: row.battery_level, battery_charging: row.battery_charging,
    }).eq("id", S.deviceId);
    renderTrackerStatus();
    return row;
  }

  function forceFix(reason = "manual") {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => reportFix(pos, reason).then(resolve).catch(() => resolve(null)),
        () => { heartbeat(); resolve(null); },
        { enableHighAccuracy: true, timeout: 25000, maximumAge: 5000 }
      );
    });
  }

  let lastHeartbeat = 0;
  async function heartbeat() {
    if (!S.deviceId || !S.session) return;
    if (Date.now() - lastHeartbeat < 20_000) return;
    lastHeartbeat = Date.now();
    const patch = {
      last_seen_at: nowIso(),
      battery_level: S.battery?.level ?? null,
      battery_charging: S.battery?.charging ?? null,
    };
    const { data } = await sb.from("devices").update(patch).eq("id", S.deviceId).select().single();
    if (data) {
      const stolenChanged = !!data.stolen_mode !== S.stolenLocal;
      S.device = { ...S.device, ...data };
      if (stolenChanged) applyStolen(!!data.stolen_mode);
      renderTrackerStatus();
    }
  }

  function resetTick() {
    if (S.tickTimer) clearInterval(S.tickTimer);
    S.tickTimer = setInterval(() => {
      if (!navigator.onLine) { heartbeat(); return; }
      forceFix("tick");
    }, currentIntervalMs());
  }

  async function startTracking() {
    if (!S.deviceId || !S.device) return;
    if (S.tracking) return;
    ensureAudio();
    // Ask for geolocation right away (user gesture context).
    const ok = await new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(false); return; }
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        (err) => { resolve(false); },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
      );
    });
    if (!ok) {
      toast("Location permission denied — allow it in your browser settings, then try again.", "error", 6000);
      return;
    }
    S.tracking = true;
    localStorage.setItem("pt:tracking", "1");
    await requestWakeLock();
    await readBattery();
    // device info once per session
    sb.from("devices").update({ device_info: deviceInfoPayload() }).eq("id", S.deviceId).then(() => {}, () => {});
    // prune data older than 30 days
    sb.from("locations").delete()
      .eq("device_id", S.deviceId)
      .lt("recorded_at", new Date(Date.now() - 30 * 864e5).toISOString())
      .then(() => {}, () => {});
    // live watch + interval tick
    S.watchId = navigator.geolocation.watchPosition(
      (pos) => reportFix(pos, "watch").catch(() => {}),
      () => {},
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 10000 }
    );
    resetTick();
    forceFix("start");
    flushQueue();
    subscribeCommands();
    subscribeDeviceRow();
    if (S.pollTimer) clearInterval(S.pollTimer);
    S.pollTimer = setInterval(pollFallback, 15_000);
    applyStolen(!!S.device.stolen_mode, { silent: true });
    renderTrackerStatus();
    toast("Protection started 🛡️", "ok");
  }

  function stopTracking(silent = false) {
    S.tracking = false;
    localStorage.removeItem("pt:tracking");
    if (S.watchId !== null) { navigator.geolocation.clearWatch(S.watchId); S.watchId = null; }
    if (S.tickTimer) { clearInterval(S.tickTimer); S.tickTimer = null; }
    if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
    if (S.wakeLock) { try { S.wakeLock.release(); } catch {} S.wakeLock = null; }
    closeChannels();
    deactivateLock();
    $("#stolen-banner").hidden = true;
    renderTrackerStatus();
    if (!silent) toast("Protection stopped", "info");
  }

  $("#btn-start").onclick = () => startTracking().catch((e) => toast(String(e.message || e), "error"));
  $("#btn-stop").onclick = async () => {
    if (S.device?.pin_hash) {
      const pin = await showModal({ title: "Enter PIN to stop", input: "", inputType: "password", placeholder: "PIN", okText: "Stop" });
      if (pin === null) return;
      const hash = await pinHashFor(S.deviceId, pin.trim());
      if (hash !== S.device.pin_hash) { toast("Wrong PIN", "error"); return; }
    } else {
      const ok = await showModal({ title: "Stop protection?", body: "Your phone will stop reporting its location.", okText: "Stop", danger: true });
      if (!ok) return;
    }
    stopTracking();
  };

  $("#btn-test-alarm").onclick = () => { ensureAudio(); siren(3); toast("If you heard that, the alarm works 🔊", "ok"); };
  $("#btn-settings").onclick = () => { showView("dashboard"); setTimeout(() => $("#dash-settings-form")?.scrollIntoView({ behavior: "smooth" }), 150); };

  function renderTrackerStatus() {
    const hero = $("#status-hero"), icon = $("#status-icon"), title = $("#status-title"), sub = $("#status-sub");
    if (!hero) return;
    if (S.tracking && S.stolenLocal) {
      hero.className = "status-hero live stolen"; icon.textContent = "🚨";
      title.textContent = "Stolen mode active";
      sub.textContent = `Fast tracking every ${S.device?.stolen_interval_s || 15}s`;
    } else if (S.tracking) {
      hero.className = "status-hero live"; icon.textContent = "🛡️";
      title.textContent = "Protected";
      sub.textContent = `Updating every ${S.device?.normal_interval_s || 60}s · ${S.device?.name || ""}`;
    } else {
      hero.className = "status-hero"; icon.textContent = "🛡️";
      title.textContent = "Not tracking";
      sub.textContent = S.device ? `Device: ${S.device.name}` : "";
    }
    $("#btn-start").hidden = S.tracking;
    $("#btn-stop").hidden = !S.tracking;
    $("#st-lastfix").textContent = S.lastFix ? fmtClock(S.lastFix.recordedAt) : "—";
    $("#st-battery").textContent = S.battery ? `${S.battery.level}%${S.battery.charging ? " ⚡" : ""}` : "—";
    $("#st-accuracy").textContent = S.lastFix?.acc != null ? `±${Math.round(S.lastFix.acc)} m` : "—";
    $("#st-queued").textContent = String(queue().length);
  }

  /* ================================================================
   * REMOTE COMMANDS (phone side)
   * ================================================================ */
  function closeChannels() {
    [S.cmdChannel, S.devChannel].forEach((ch) => { if (ch) sb.removeChannel(ch).catch(() => {}); });
    S.cmdChannel = S.devChannel = null;
  }

  function subscribeCommands() {
    if (S.cmdChannel) return;
    const ch = sb.channel(`cmds:${S.deviceId}`);
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "commands", filter: `device_id=eq.${S.deviceId}` },
      (payload) => handleCommand(payload.new))
      .subscribe((status) => {});
    S.cmdChannel = ch;
  }

  function subscribeDeviceRow() {
    if (S.devChannel) return;
    const ch = sb.channel(`devrow:${S.deviceId}`);
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "devices", filter: `id=eq.${S.deviceId}` },
      (payload) => {
        const row = payload.new;
        if (!row) return;
        const prev = S.device || {};
        const intervalChanged =
          row.normal_interval_s !== prev.normal_interval_s ||
          row.stolen_interval_s !== prev.stolen_interval_s;
        S.device = { ...prev, ...row };
        if (!!row.stolen_mode !== S.stolenLocal) applyStolen(!!row.stolen_mode);
        else if (intervalChanged && S.tracking) resetTick();
        renderTrackerStatus();
      })
      .subscribe();
    S.devChannel = ch;
  }

  async function pollFallback() {
    if (!S.tracking || !S.deviceId) return;
    try {
      const { data: cmds } = await sb.from("commands").select("*")
        .eq("device_id", S.deviceId).eq("status", "pending")
        .order("created_at", { ascending: true }).limit(5);
      for (const c of cmds || []) handleCommand(c);
    } catch { /* offline */ }
  }

  async function handleCommand(cmd) {
    if (!cmd || cmd.status !== "pending") return;
    if (S.inFlightCmds.has(cmd.id)) return;
    S.inFlightCmds.add(cmd.id);
    try {
      await sb.from("commands").update({ status: "delivered", delivered_at: nowIso() }).eq("id", cmd.id);
      await runCommand(cmd);
      await sb.from("commands").update({ status: "done", completed_at: nowIso() }).eq("id", cmd.id);
    } catch (err) {
      try { await sb.from("commands").update({ status: "failed", completed_at: nowIso() }).eq("id", cmd.id); } catch {}
    } finally {
      S.inFlightCmds.delete(cmd.id);
    }
  }

  async function runCommand(cmd) {
    const p = cmd.payload || {};
    ensureAudio();
    switch (cmd.type) {
      case "ping":
        navigator.vibrate?.(120);
        beep();
        break;
      case "alarm":
        siren(Math.min(120, parseInt(p.duration_s, 10) || 30));
        break;
      case "vibrate":
        navigator.vibrate?.([500, 150, 500, 150, 500, 150, 1000]);
        break;
      case "message":
        showMsgOverlay(p.text || S.device?.owner_message || "Please return this phone to its owner.");
        break;
      case "lock":
        activateLock();
        break;
      case "unlock":
        deactivateLock();
        toast("Lock released remotely", "ok");
        break;
      case "locate":
        await forceFix("remote");
        break;
      case "reset_pin": {
        await sb.from("devices").update({ pin_hash: null }).eq("id", S.deviceId);
        if (S.device) S.device.pin_hash = null;
        deactivateLock();
        toast("PIN was reset by your admin account", "info", 6000);
        break;
      }
      case "set_stolen":
        // handled through the devices row; keep for completeness
        if (p.stolen !== undefined) applyStolen(!!p.stolen);
        break;
      default:
        break;
    }
  }

  /* ---- alarm / beep ---- */
  function siren(seconds = 30) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.connect(gain).connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.45, t0 + 0.06);
    osc.frequency.setValueAtTime(660, t0);
    for (let t = 0; t < seconds; t += 0.5) {
      osc.frequency.linearRampToValueAtTime(1180, t0 + t + 0.25);
      osc.frequency.linearRampToValueAtTime(660, t0 + t + 0.5);
    }
    gain.gain.setValueAtTime(0.45, t0 + seconds - 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.05);
    let vib = null;
    if (navigator.vibrate) {
      vib = setInterval(() => navigator.vibrate([350, 120, 350, 120, 700]), 950);
      navigator.vibrate([350, 120, 350, 120, 700]);
    }
    osc.onended = () => { if (vib) clearInterval(vib); try { gain.disconnect(); } catch {} };
  }

  function beep() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 950;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + 0.4);
  }

  /* ---- message overlay ---- */
  function showMsgOverlay(text) {
    $("#msg-overlay-body").textContent = text;
    $("#msg-overlay").hidden = false;
  }
  $("#msg-overlay-close").onclick = () => { $("#msg-overlay").hidden = true; };

  /* ---- lock overlay (PIN pad) ---- */
  let pinBuf = "";
  function renderPinDots() {
    $$("#pin-dots i").forEach((dot, i) => dot.classList.toggle("on", i < pinBuf.length));
  }

  async function activateLock() {
    pinBuf = "";
    S.pinAttempts = 0;
    $("#pin-error").hidden = true;
    $("#lock-overlay-msg").textContent = S.device?.owner_message || "";
    $("#lock-overlay").hidden = false;
    await requestWakeLock();
    tryEnterFullscreen();
    renderPinDots();
  }

  function deactivateLock() {
    $("#lock-overlay").hidden = true;
    exitFullscreenIfTaken();
  }

  $("#pin-pad").addEventListener("click", async (e) => {
    const k = e.target?.dataset?.k;
    if (!k) return;
    if (k === "clear") pinBuf = "";
    else if (k === "del") pinBuf = pinBuf.slice(0, -1);
    else if (pinBuf.length < 6) pinBuf += k;
    renderPinDots();
    $("#pin-error").hidden = true;
    if (!S.device?.pin_hash) return; // no PIN set — remote unlock only
    if (pinBuf.length >= 4) {
      const hash = await pinHashFor(S.deviceId, pinBuf);
      if (hash === S.device.pin_hash) {
        deactivateLock();
        toast("Unlocked", "ok");
        pinBuf = "";
        return;
      }
      if (pinBuf.length >= 6) {
        S.pinAttempts++;
        pinBuf = "";
        renderPinDots();
        const card = $("#lock-overlay .overlay-card");
        card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
        $("#pin-error").hidden = false;
        if (S.pinAttempts >= 5) {
          S.pinAttempts = 0;
          siren(5);
          toast("Too many wrong attempts — alarm sent to owner", "error");
        }
      }
    }
  });

  /* ---- stolen mode (local application) ---- */
  function applyStolen(stolen, { silent = false } = {}) {
    if (S.stolenLocal === stolen) return;
    S.stolenLocal = stolen;
    $("#stolen-banner").hidden = !(S.tracking && stolen);
    if (stolen) {
      if (S.tracking) {
        resetTick();
        requestWakeLock();
        forceFix("stolen-on");
      }
      if (!silent) {
        showMsgOverlay(S.device?.owner_message || "This phone has been marked as stolen. It is being tracked.");
      }
      toast("⚠️ Stolen mode ON — tracking fast", "error", 5000);
    } else {
      if (S.tracking) resetTick();
      $("#msg-overlay").hidden = true;
      toast("Stolen mode cleared", "ok");
    }
    renderTrackerStatus();
  }

  $("#btn-clear-stolen-banner").onclick = async () => {
    const ok = await showModal({ title: "Clear stolen mode?", okText: "Clear" });
    if (!ok) return;
    await sb.from("devices").update({ stolen_mode: false }).eq("id", S.deviceId);
    applyStolen(false);
  };

  /* ================================================================
   * DASHBOARD (the "Find" mode)
   * ================================================================ */
  let deviceCardsSig = "";
  function renderDeviceCards(force = false) {
    const host = $("#device-cards");
    if (!host) return;
    const sig = JSON.stringify(S.devices.map((d) =>
      [d.id, d.name, d.last_seen_at, d.battery_level, d.stolen_mode, d.id === S.deviceId]));
    if (!force && sig === deviceCardsSig) return;
    deviceCardsSig = sig;
    host.innerHTML = "";
    S.devices.forEach((d) => {
      const card = document.createElement("button");
      card.className = "device-card" + (d.id === S.deviceId ? " active" : "");
      const online = d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 120_000;
      const dotCls = d.stolen_mode ? "dot stolen" : online ? "dot online" : "dot";
      card.innerHTML = `
        <div class="dc-name"><span class="${dotCls}"></span>${escapeHtml(d.name)}</div>
        <div class="dc-meta">${online ? "online" : "last seen " + fmtRelTime(d.last_seen_at)}
          ${d.battery_level != null ? " · " + Math.round(d.battery_level) + "%" : ""}${d.stolen_mode ? " · ⚠️ stolen" : ""}</div>`;
      card.onclick = () => openDevice(d.id);
      host.appendChild(card);
    });
  }

  function onDashboardShown() {
    if (!S.session) return;
    if (!S.deviceId && S.devices.length) { renderDeviceCards(); return; }
    if (S.deviceId) openDevice(S.deviceId);
    else { $("#dash-empty").hidden = false; $("#dash-main").hidden = true; renderDeviceCards(); }
  }

  async function openDevice(deviceId) {
    await bindDevice(deviceId, { silent: true });
    $("#dash-empty").hidden = true;
    $("#dash-main").hidden = false;
    ensureMap();
    fillSettingsForm();
    await loadHistory();
    updateDashStatus();
    subscribeLocChannel(deviceId);
    recenter(true);
  }

  function ensureMap() {
    if (S.map) { setTimeout(() => S.map?.invalidateSize(), 120); return; }
    if (typeof L === "undefined") {
      toast("Map library failed to load (offline?). History list still works.", "error", 5000);
      return;
    }
    const cfg = CFG.map;
    S.map = L.map("map", { zoomControl: true, attributionControl: true }).setView([cfg.lat, cfg.lon], cfg.zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(S.map);
    S.trail = L.polyline([], { color: "#f5b942", weight: 3, opacity: 0.85 }).addTo(S.map);
    S.marker = L.marker([cfg.lat, cfg.lon], { icon: makeIcon(false) }).addTo(S.map);
    S.marker.bindPopup("");
    S.marker.on("popupopen", () => enrichPopup(undefined, { force: true }));
    setTimeout(() => S.map?.invalidateSize(), 200);
  }

  function makeIcon(stolen) {
    return L.divIcon({
      className: "",
      html: `<div class="tracker-marker${stolen ? " stolen" : ""}"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }

  function lastFixInfo() {
    const d = S.device;
    if (d?.last_lat != null && d?.last_lon != null) {
      return { lat: d.last_lat, lon: d.last_lon, ts: d.last_seen_at, acc: d.accuracy_m };
    }
    const h = S.history[S.history.length - 1];
    if (h) return { lat: h.lat, lon: h.lon, ts: h.recorded_at, acc: h.accuracy_m };
    return null;
  }

  function updateMarker(fit = false) {
    if (!S.map || !S.marker) return;
    const f = lastFixInfo();
    if (!f) return;
    S.marker.setIcon(makeIcon(!!S.device?.stolen_mode));
    S.marker.setLatLng([f.lat, f.lon]);
    if (fit) {
      const pts = S.history.length ? S.history.map((p) => [p.lat, p.lon]) : [[f.lat, f.lon]];
      try { S.map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 16 }); } catch {}
    }
  }

  function recenter(fit = false) {
    if (!S.map) return;
    const f = lastFixInfo();
    if (!f) { toast("No location data yet", "info"); return; }
    if (fit) updateMarker(true);
    else S.map.setView([f.lat, f.lon], Math.max(S.map.getZoom(), 15));
  }
  $("#btn-recenter").onclick = () => recenter(false);
  $("#btn-refresh-history").onclick = () => loadHistory().then(() => updateMarker(true));

  function subscribeLocChannel(deviceId) {
    if (S.locChannel) { sb.removeChannel(S.locChannel).catch(() => {}); S.locChannel = null; }
    const ch = sb.channel(`locs:${deviceId}`);
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "locations", filter: `device_id=eq.${deviceId}` },
      (payload) => {
        const row = payload.new;
        if (!row) return;
        S.history.push(row);
        if (S.history.length > 2000) S.history.shift();
        if (S.trail && S.map) S.trail.addLatLng([row.lat, row.lon]);
        updateMarker(false);
        prependHistItem(row);
        // refresh device row (battery/seen)
        sb.from("devices").select("*").eq("id", deviceId).maybeSingle().then(({ data }) => {
          if (data) { S.device = data; updateDashStatus(); renderDeviceCards(); }
        });
      })
      .subscribe();
    S.locChannel = ch;
  }

  async function loadHistory() {
    if (!S.deviceId) return;
    const hours = parseInt($("#hist-range").value, 10) || 24;
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const { data, error } = await sb.from("locations").select("*")
      .eq("device_id", S.deviceId)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true })
      .limit(2000);
    if (error) { toast("History error: " + error.message, "error"); return; }
    S.history = data || [];
    const list = $("#hist-list");
    list.innerHTML = "";
    if (!S.history.length) {
      list.innerHTML = '<div class="hist-empty">No fixes in this period yet.</div>';
    } else {
      [...S.history].reverse().forEach((row) => list.appendChild(histItem(row)));
    }
    if (S.trail) S.trail.setLatLngs(S.history.map((p) => [p.lat, p.lon]));
    updateMarker(true);
    updateDashStatus();
  }
  $("#hist-range").onchange = () => loadHistory();

  function histItem(row) {
    const el = document.createElement("div");
    el.className = "hist-item";
    const acc = row.accuracy_m != null ? ` ±${Math.round(row.accuracy_m)}m` : "";
    const bat = row.battery_level != null ? ` · ${Math.round(row.battery_level)}%` : "";
    el.innerHTML = `<span>${row.lat.toFixed(5)}, ${row.lon.toFixed(5)}${escapeHtml(acc + bat)}</span>
                    <span class="hi-when">${fmtRelTime(row.recorded_at)}</span>`;
    el.onclick = () => { if (S.map) S.map.setView([row.lat, row.lon], 17); };
    return el;
  }
  function prependHistItem(row) {
    const list = $("#hist-list");
    if (list.querySelector(".hist-empty")) list.innerHTML = "";
    list.prepend(histItem(row));
    while (list.children.length > 300) list.lastChild.remove();
  }

  function updateDashStatus() {
    const d = S.device;
    if (!d) return;
    const online = d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 120_000;
    const dot = $("#dash-status-dot");
    dot.className = "dot " + (d.stolen_mode ? "stolen" : online ? "online" : "");
    $("#dash-status-text").textContent = d.stolen_mode
      ? "⚠️ STOLEN MODE — fast tracking"
      : online ? "🟢 Online — tracker running" : "⚪ Offline (tracker not running)";
    $("#d-lastseen").textContent = fmtRelTime(d.last_seen_at);
    $("#d-battery").textContent = d.battery_level != null
      ? `${Math.round(d.battery_level)}%${d.battery_charging ? " ⚡" : ""}` : "—";
    const f = lastFixInfo();
    const lastPt = S.history[S.history.length - 1];
    $("#d-speed").textContent = lastPt?.speed_mps != null
      ? `${(lastPt.speed_mps * 3.6).toFixed(1)} km/h` : "—";
    $("#d-accuracy").textContent = d.accuracy_m != null ? `±${Math.round(d.accuracy_m)} m` : "—";
    $("#cmd-stolen-label").textContent = d.stolen_mode ? "Clear stolen" : "Stolen mode";
    $("#cmd-stolen").className = "btn cmd " + (d.stolen_mode ? "btn-primary" : "btn-warning");
    if (f) {
      const q = `${f.lat},${f.lon}`;
      $("#lnk-gmaps").href = `https://www.google.com/maps?q=${q}`;
      $("#lnk-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(`My phone's last known location: https://www.google.com/maps?q=${q} (${f.ts ? new Date(f.ts).toLocaleString() : ""})`)}`;
      $("#d-address").textContent = f.ts ? `Last fix: ${new Date(f.ts).toLocaleString()}` : "";
      enrichPopup(f);
    } else {
      $("#d-address").textContent = "No location data yet — start protection on the phone.";
    }
    renderDeviceCards();
  }

  async function enrichPopup(f = lastFixInfo(), { force = false } = {}) {
    if (!f || !S.marker) return;
    const key = `${f.lat.toFixed(4)},${f.lon.toFixed(4)}`;
    if (!force && Date.now() - (S.lastGeocodeAt || 0) < 90_000 && !S.geocodeCache.has(key)) return;
    S.lastGeocodeAt = Date.now();
    const base = `📍 ${new Date(f.ts || Date.now()).toLocaleString()}${f.acc != null ? ` · ±${Math.round(f.acc)} m` : ""}`;
    const addr = S.geocodeCache.get(`${f.lat.toFixed(4)},${f.lon.toFixed(4)}`);
    if (addr) { S.marker.setPopupContent(`<b>${escapeHtml(addr)}</b><br/><span class="muted">${escapeHtml(base)}</span>`); return; }
    S.marker.setPopupContent(base + "<br/><span class='muted'>looking up address…</span>");
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${f.lat}&lon=${f.lon}&zoom=16`, { headers: { Accept: "application/json" } });
      const j = await r.json();
      const name = j.display_name || "";
      if (name) {
        S.geocodeCache.set(`${f.lat.toFixed(4)},${f.lon.toFixed(4)}`, name);
        $("#d-address").textContent = "📍 " + name;
        S.marker.setPopupContent(`<b>${escapeHtml(name)}</b><br/><span class="muted">${escapeHtml(base)}</span>`);
      }
    } catch { /* ignore */ }
  }

  $("#btn-copy-coords").onclick = async () => {
    const f = lastFixInfo();
    if (!f) { toast("No location yet", "error"); return; }
    const text = `${f.lat}, ${f.lon}`;
    try { await navigator.clipboard.writeText(text); toast("Coordinates copied", "ok"); }
    catch { toast(text, "info", 6000); }
  };

  /* ---- commands (dashboard side) ---- */
  async function sendCommand(type, payload = null) {
    const { error } = await sb.from("commands").insert({ device_id: S.deviceId, type, payload });
    if (error) { toast("Command failed: " + error.message, "error"); return false; }
    toast(`Sent: ${type}`, "ok");
    return true;
  }

  $("#cmd-alarm").onclick = async () => {
    const ok = await showModal({
      title: "Ring the alarm?",
      body: "A loud siren will sound on the phone for 30 seconds (with vibration).",
      okText: "Ring now", danger: true,
    });
    if (ok) sendCommand("alarm", { duration_s: 30 });
  };
  $("#cmd-vibrate").onclick = () => sendCommand("vibrate");
  $("#cmd-message").onclick = async () => {
    const text = await showModal({
      title: "Message to show",
      body: "It appears fullscreen on the phone.",
      input: S.device?.owner_message || "",
      okText: "Send",
    });
    if (text === null) return;
    if (!text.trim()) { toast("Empty message", "error"); return; }
    sendCommand("message", { text: text.trim() });
  };
  $("#cmd-lock").onclick = async () => {
    const ok = await showModal({
      title: "Lock the phone?",
      body: "Shows a fullscreen locked screen. Unlock needs the PIN you set (or Unlock from here).",
      okText: "Lock", danger: true,
    });
    if (ok) sendCommand("lock");
  };
  $("#cmd-unlock").onclick = () => sendCommand("unlock");
  $("#cmd-locate").onclick = () => sendCommand("locate");
  $("#cmd-resetpin").onclick = async () => {
    const ok = await showModal({
      title: "Reset the unlock PIN?",
      body: "Clears the PIN on the phone — set a new one from the Protect tab.",
      okText: "Reset PIN", danger: true,
    });
    if (ok) { await sendCommand("reset_pin"); setTimeout(loadDevices, 1200); }
  };
  $("#cmd-stolen").onclick = async () => {
    if (!S.device) return;
    if (S.device.stolen_mode) {
      const ok = await showModal({ title: "Clear stolen mode?", okText: "Clear" });
      if (!ok) return;
      const { error } = await sb.from("devices").update({ stolen_mode: false }).eq("id", S.deviceId);
      if (error) { toast(error.message, "error"); return; }
      S.device.stolen_mode = false;
      toast("Stolen mode cleared", "ok");
    } else {
      const ok = await showModal({
        title: "⚠️ Activate stolen mode?",
        body: "The phone starts tracking every few seconds, keeps its screen awake and shows your message.",
        okText: "Activate", danger: true,
      });
      if (!ok) return;
      const { error } = await sb.from("devices").update({ stolen_mode: true }).eq("id", S.deviceId);
      if (error) { toast(error.message, "error"); return; }
      S.device.stolen_mode = true;
      toast("Stolen mode activated", "error");
    }
    updateDashStatus();
  };

  /* ---- exports ---- */
  function download(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  $("#btn-export-csv").onclick = () => {
    if (!S.history.length) { toast("No history to export", "error"); return; }
    const cols = ["recorded_at", "lat", "lon", "accuracy_m", "altitude_m", "speed_mps", "heading_deg", "battery_level", "battery_charging"];
    const lines = [cols.join(",")].concat(
      S.history.map((r) => cols.map((c) => (r[c] ?? "")).join(","))
    );
    download(`tracker-${S.device?.name || "device"}-${Date.now()}.csv`, "text/csv", lines.join("\n"));
  };

  $("#btn-export-gpx").onclick = () => {
    if (!S.history.length) { toast("No history to export", "error"); return; }
    const pts = S.history.map((r) =>
      `    <trkpt lat="${r.lat}" lon="${r.lon}">${r.altitude_m != null ? `<ele>${r.altitude_m}</ele>` : ""}<time>${r.recorded_at}</time></trkpt>`
    ).join("\n");
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GRGC Phone Tracker" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${escapeHtml(S.device?.name || "phone")}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>`;
    download(`tracker-${S.device?.name || "device"}-${Date.now()}.gpx`, "application/gpx+xml", gpx);
  };

  $("#btn-clear-hist").onclick = async () => {
    const ok = await showModal({
      title: "Delete all location history?",
      body: "This cannot be undone. Live tracking keeps working.",
      okText: "Delete", danger: true,
    });
    if (!ok) return;
    const { error } = await sb.from("locations").delete().eq("device_id", S.deviceId);
    if (error) { toast(error.message, "error"); return; }
    toast("History cleared", "ok");
    loadHistory();
  };

  /* ---- device settings ---- */
  function fillSettingsForm() {
    const d = S.device;
    if (!d) return;
    $("#set-name").value = d.name || "";
    $("#set-message").value = d.owner_message || "";
    $("#set-interval").value = d.normal_interval_s || 60;
    $("#set-stolen-interval").value = d.stolen_interval_s || 15;
  }

  $("#dash-settings-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!S.deviceId) return;
    const patch = {
      name: $("#set-name").value.trim() || "My Phone",
      owner_message: $("#set-message").value.trim(),
      normal_interval_s: Math.max(15, Math.min(3600, parseInt($("#set-interval").value, 10) || 60)),
      stolen_interval_s: Math.max(10, Math.min(600, parseInt($("#set-stolen-interval").value, 10) || 15)),
    };
    const { data, error } = await sb.from("devices").update(patch).eq("id", S.deviceId).select().single();
    if (error) { toast(error.message, "error"); return; }
    S.device = { ...S.device, ...data };
    const idx = S.devices.findIndex((d) => d.id === S.deviceId);
    if (idx >= 0) S.devices[idx] = S.device;
    if (S.tracking) resetTick();
    renderDeviceCards();
    renderTrackerStatus();
    toast("Settings saved", "ok");
  };

  $("#btn-delete-device").onclick = async () => {
    if (!S.device) return;
    const confirm = await showModal({
      title: `Delete “${S.device.name}”?`,
      body: "Removes the device, its whole location history and pending commands. Type DELETE to confirm.",
      input: "", placeholder: "DELETE", okText: "Delete forever", danger: true,
    });
    if (confirm === null) return;
    if (String(confirm).trim().toUpperCase() !== "DELETE") { toast("Type DELETE to confirm", "error"); return; }
    if (S.tracking) stopTracking(true);
    const { error } = await sb.from("devices").delete().eq("id", S.deviceId);
    if (error) { toast(error.message, "error"); return; }
    localStorage.removeItem("pt:deviceId");
    S.deviceId = null; S.device = null;
    S.history = [];
    if (S.map) { S.trail?.setLatLngs([]); }
    $("#dash-main").hidden = true;
    $("#dash-empty").hidden = false;
    toast("Device deleted", "ok");
    await loadDevices();
  };

  /* ================================================================
   * SESSION / BOOT
   * ================================================================ */
  sb.auth.onAuthStateChange(async (event, session) => {
    S.session = session;
    if (session) {
      $("#header-email").textContent = session.user?.email || "";
      await loadDevices();
      if (currentView === "login") showView("tracker");
      // auto-resume protection if it was running
      if (localStorage.getItem("pt:tracking") === "1" && S.deviceId && !S.tracking) {
        setTimeout(() => startTracking().catch(() => {}), 800);
      }
    } else {
      stopTracking(true);
      S.devices = []; S.device = null;
      $("#header-email").textContent = "";
      showView("login");
    }
  });

  $$(".tab").forEach((t) => (t.onclick = () => showView(t.dataset.view)));
  window.addEventListener("hashchange", () => {
    const v = (location.hash || "").slice(1);
    if (VIEWS.includes(v) && v !== currentView) showView(v);
  });

  // visibility: refresh wake lock + fix when coming back to foreground
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && S.tracking) {
      requestWakeLock();
      forceFix("visible");
    }
  });

  // keep status fresh
  setInterval(() => {
    if (!S.session) return;
    renderTrackerStatus();
    if (currentView === "dashboard" && S.device) updateDashStatus();
    renderDeviceCards();
  }, 30_000);

  // back link on help when logged out
  const helpBack = document.createElement("p");
  helpBack.id = "help-back";
  helpBack.innerHTML = '<a href="#login" class="linklike">← Back to sign in</a>';
  $("#view-help").prepend(helpBack);

  // service worker
  if ("serviceWorker" in navigator &&
      (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // boot
  (async () => {
    const { data } = await sb.auth.getSession();
    S.session = data.session;
    if (S.session) {
      $("#header-email").textContent = S.session.user?.email || "";
      await loadDevices();
      showView((location.hash || "").slice(1) === "dashboard" ? "dashboard" : "tracker");
      if (localStorage.getItem("pt:tracking") === "1" && S.deviceId) {
        setTimeout(() => startTracking().catch(() => {}), 800);
      }
    } else {
      const v = (location.hash || "").slice(1);
      showView(v === "help" ? "help" : "login");
      if (v === "help") $("#help-back").hidden = false;
    }
  })();
})();
