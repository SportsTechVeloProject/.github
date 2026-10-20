/* sensors.js — Movesense over Web Bluetooth, the matching simulator, and the sensor panel.
   Part of V-Lo. Loaded as a plain script; see vlo.html for the order. */
"use strict";

/* ---------------- Movesense sensors over Web Bluetooth ---------------- */
// Ported from SportsTechVeloProject/MoveSenseCode (Website/JS/ble.js and
// simulate.js). Both transports expose the same four methods so the UI below
// never branches on real-vs-simulated. Two kinds of sample come out, whichever
// transport produced them:
//   { kind: "acc",  sensor, device, t, recvAt, x, y, z }      accelerometer, m/s²
//   { kind: "gyro", sensor, device, t, recvAt, gx, gy, gz }   gyroscope, deg/s
// The gyro is its own subscription (the route MoveSenseCode recorded the test
// sets with); recorder.js matches the two up by timestamp when a set is saved.
//
// Web Bluetooth needs a secure context (https:// or localhost) and only
// exists in Chromium browsers — no Safari, so no iPhone. Opening this file
// straight off disk (file://) will not work either.

var MSBle = (function () {
  var SENSORDATA_SERVICE_UUID = "34802252-7185-4d5d-b431-630e7050e8f0";
  var COMMAND_CHAR_SUFFIX = "0001";
  var DATA_CHAR_SUFFIX = "0002";
  var CMD_SUBSCRIBE = 1;
  var RESP_COMMAND_RESULT = 1;
  var RESP_DATA = 2;
  var REF_ACC = 99;
  var REF_GYRO = 100;
  var RESOURCE_PATH = "/Meas/Acc";
  var GYRO_RESOURCE_PATH = "/Meas/Gyro";
  var SAMPLE_RATE_HZ = 104;
  var GYRO_SANITY_LIMIT_DPS = 2000; // catches a misparsed packet, nothing a barbell does

  var devices = {};
  // Labels mid-connect. Guards against overlapping gatt.connect() calls on
  // one device (a manual click racing auto-reconnect), which Chrome rejects
  // with "GATT operation already in progress".
  var connecting = {};
  var sampleHandler = function () {};
  var statusHandler = function () {};

  function isGattBusyError(err) {
    return err && err.name === "NotSupportedError" && /already in progress/i.test(err.message || "");
  }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function handleNotification(label, deviceName, event) {
    var value = event.target.value;
    if (value.byteLength < 2) return;
    var response = value.getUint8(0);
    var reference = value.getUint8(1);
    if (response === RESP_COMMAND_RESULT) return;
    if (response !== RESP_DATA || (reference !== REF_ACC && reference !== REF_GYRO)) return;

    // Both streams: uint32 timestamp, then N samples of three float32s.
    var timestampMs = value.getUint32(2, true);
    var numSamples = (value.byteLength - 6) / 12;
    var recvAt = Date.now();
    for (var i = 0; i < numSamples; i++) {
      var t = timestampMs / 1000.0 + i / SAMPLE_RATE_HZ;
      if (reference === REF_GYRO) {
        var gx = value.getFloat32(6 + i * 12, true);
        var gy = value.getFloat32(6 + i * 12 + 4, true);
        var gz = value.getFloat32(6 + i * 12 + 8, true);
        if (![gx, gy, gz].every(function (v) { return isFinite(v) && Math.abs(v) <= GYRO_SANITY_LIMIT_DPS; })) continue;
        sampleHandler({ kind: "gyro", sensor: label, device: deviceName, t: t, recvAt: recvAt, gx: gx, gy: gy, gz: gz });
        continue;
      }
      sampleHandler({
        kind: "acc",
        sensor: label,
        device: deviceName,
        t: t,
        recvAt: recvAt,
        x: value.getFloat32(6 + i * 12, true),
        y: value.getFloat32(6 + i * 12 + 4, true),
        z: value.getFloat32(6 + i * 12 + 8, true)
      });
    }
  }

  function connectOnce(label) {
    var entry = devices[label];
    var device = entry.device;
    return device.gatt.connect()
      .then(function (server) {
        entry.server = server;
        return server.getPrimaryService(SENSORDATA_SERVICE_UUID);
      })
      .then(function (service) { return service.getCharacteristics(); })
      .then(function (characteristics) {
        var commandChar = null, dataChar = null;
        characteristics.forEach(function (char) {
          var suffix = char.uuid.slice(4, 8);
          if (suffix === COMMAND_CHAR_SUFFIX) commandChar = char;
          else if (suffix === DATA_CHAR_SUFFIX) dataChar = char;
        });
        if (!commandChar || !dataChar) {
          throw new Error("[" + label + "] sensordata-service characteristics not found");
        }
        entry.commandChar = commandChar;
        entry.dataChar = dataChar;
        return dataChar.startNotifications();
      })
      .then(function () {
        entry.dataChar.addEventListener("characteristicvaluechanged", function (event) {
          handleNotification(label, device.name, event);
        });
        return subscribe(entry, REF_ACC, RESOURCE_PATH);
      })
      .then(function () { return subscribe(entry, REF_GYRO, GYRO_RESOURCE_PATH); });
  }

  function subscribe(entry, reference, path) {
    var header = [CMD_SUBSCRIBE, reference];
    var body = Array.from(new TextEncoder().encode(path + "/" + SAMPLE_RATE_HZ));
    return entry.commandChar.writeValue(new Uint8Array(header.concat(body)));
  }

  // One automatic retry: the "GATT operation already in progress" error the
  // Windows Bluetooth stack throws is usually transient and clears in ~1s.
  function connect(label) {
    if (connecting[label]) {
      return Promise.reject(new Error("[" + label + "] a connection attempt is already in progress"));
    }
    connecting[label] = true;
    return connectOnce(label)
      .catch(function (err) {
        if (!isGattBusyError(err)) throw err;
        return delay(800).then(function () { return connectOnce(label); });
      })
      .then(
        function (v) { delete connecting[label]; return v; },
        function (e) { delete connecting[label]; throw e; }
      );
  }

  function onDisconnected(label) {
    return function () {
      var entry = devices[label];
      if (!entry) return;
      if (entry.intentional) { statusHandler({ label: label, status: "disconnected" }); return; }
      statusHandler({ label: label, status: "reconnecting" });
      connect(label).then(
        function () { statusHandler({ label: label, status: "connected" }); },
        function (err) { statusHandler({ label: label, status: "error", message: String(err) }); }
      );
    };
  }

  function addSensor(label) {
    statusHandler({ label: label, status: "connecting" });
    // One requestDevice() per sensor: the browser picker can't multi-select,
    // which is why there are separate left and right connect buttons.
    return navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "Movesense" }],
      optionalServices: [SENSORDATA_SERVICE_UUID]
    }).then(function (device) {
      devices[label] = { device: device, intentional: false };
      device.addEventListener("gattserverdisconnected", onDisconnected(label));
      return connect(label).then(
        function () {
          statusHandler({ label: label, status: "connected" });
          return { label: label, deviceName: device.name };
        },
        function (err) {
          delete devices[label];
          statusHandler({ label: label, status: "error", message: String(err) });
          throw err;
        }
      );
    });
  }

  function disconnectSensor(label) {
    var entry = devices[label];
    if (!entry) return;
    entry.intentional = true;
    if (entry.device.gatt.connected) entry.device.gatt.disconnect();
    delete devices[label];
    statusHandler({ label: label, status: "disconnected" });
  }

  return {
    setSampleHandler: function (fn) { sampleHandler = fn; },
    setStatusHandler: function (fn) { statusHandler = fn; },
    addSensor: addSensor,
    disconnectSensor: disconnectSensor
  };
})();

// Simulated sensors replay a real recorded set (DataTesting/11squats011026.json,
// 11 back squats) in real time, looping, so recording and analysis can be
// tried end to end without hardware. If that file can't be loaded it falls
// back to a gentle made-up wobble.
var MSSim = (function () {
  var TICK_MS = 50;
  var SAMPLE_RATE_HZ = 104;
  var REPLAY_URL = "DataTesting/11squats011026.json";
  var sensors = {};
  var replay = null; // { left: [rows], right: [rows] } once loaded
  var sampleHandler = function () {};
  var statusHandler = function () {};

  function loadReplay() {
    if (replay) return Promise.resolve(replay);
    return fetch(REPLAY_URL).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (rows) {
        var bySide = { left: [], right: [] };
        rows.forEach(function (row) { if (bySide[row.sensor]) bySide[row.sensor].push(row); });
        Object.keys(bySide).forEach(function (k) { bySide[k].sort(function (a, b) { return a.t - b.t; }); });
        replay = bySide;
        return replay;
      })
      .catch(function () { return null; });
  }

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function tick(label) {
    var entry = sensors[label];
    if (!entry) return;
    var samplesPerTick = Math.round((SAMPLE_RATE_HZ * TICK_MS) / 1000);
    var recvAt = Date.now();
    var device = "Simulated " + label;
    function noise() { return (Math.random() - 0.5) * 0.3; }
    for (var i = 0; i < samplesPerTick; i++) {
      entry.sampleIndex += 1;
      var t = entry.sampleIndex / SAMPLE_RATE_HZ;
      var rows = replay && replay[label];
      if (rows && rows.length) {
        var row = rows[entry.sampleIndex % rows.length];
        sampleHandler({ kind: "acc", sensor: label, device: device, t: t, recvAt: recvAt, x: num(row.x), y: num(row.y), z: num(row.z) });
        sampleHandler({ kind: "gyro", sensor: label, device: device, t: t, recvAt: recvAt, gx: num(row.gx), gy: num(row.gy), gz: num(row.gz) });
      } else {
        sampleHandler({ kind: "acc", sensor: label, device: device, t: t, recvAt: recvAt,
          x: Math.sin(t * 1.3 + entry.phase) * 1.5 + noise(), y: noise(), z: 9.8 + noise() });
        sampleHandler({ kind: "gyro", sensor: label, device: device, t: t, recvAt: recvAt, gx: noise(), gy: noise(), gz: noise() });
      }
    }
  }

  function addSensor(label) {
    statusHandler({ label: label, status: "connecting" });
    return loadReplay().then(function () {
      sensors[label] = {
        sampleIndex: 0,
        phase: Math.random() * Math.PI * 2,
        timer: setInterval(function () { tick(label); }, TICK_MS)
      };
      statusHandler({ label: label, status: "connected" });
      return { label: label, deviceName: "Simulated " + label };
    });
  }

  function disconnectSensor(label) {
    var entry = sensors[label];
    if (!entry) return;
    clearInterval(entry.timer);
    delete sensors[label];
    statusHandler({ label: label, status: "disconnected" });
  }

  return {
    setSampleHandler: function (fn) { sampleHandler = fn; },
    setStatusHandler: function (fn) { statusHandler = fn; },
    addSensor: addSensor,
    disconnectSensor: disconnectSensor
  };
})();

// True when both sleeves are connected, which a recording needs (the analysis
// compares left and right). Kept up to date by the sensor panel below.
var sensorStatus = { left: "disconnected", right: "disconnected" };
// Testing with a single sensor: open the page with ?mirror=1. One connected
// sensor then counts as ready, and the recorder copies its samples to the
// other side (recorder.js). Never for real training data.
var SENSOR_MIRROR = /[?&]mirror=1(&|$)/.test(location.search);
function sensorsReady() {
  if (SENSOR_MIRROR) return sensorStatus.left === "connected" || sensorStatus.right === "connected";
  return sensorStatus.left === "connected" && sensorStatus.right === "connected";
}
// Simulated sensors are for trying the flow only: their recordings are never
// uploaded or analyzed (training.js).
function sensorsSimulated() { var t = document.getElementById("simToggle"); return !!(t && t.checked); }

/* ---------------- sensor panel ---------------- */
(function initSensors() {
  var STATUS_TEXT = {
    connecting: "connecting…",
    reconnecting: "sensor dropped, reconnecting…",
    connected: "connected",
    disconnected: "not connected",
    error: "connection failed"
  };

  var live = { left: null, right: null };   // latest sample per sensor
  var counts = { left: 0, right: 0 };       // samples since the last UI tick
  var status = sensorStatus;
  var note = document.getElementById("sensorNote");
  var summary = document.getElementById("sensorSummary");

  function card(label) { return document.querySelector('.sensor-card[data-sensor="' + label + '"]'); }

  function transport() { return document.getElementById("simToggle").checked ? MSSim : MSBle; }

  function onSample(s) {
    if (typeof Recorder !== "undefined") Recorder.add(s);
    if (s.kind !== "acc") return; // the readout shows the accelerometer
    live[s.sensor] = s;
    counts[s.sensor] += 1;
  }
  MSBle.setSampleHandler(onSample);
  MSSim.setSampleHandler(onSample);

  function applyStatus(evt) {
    status[evt.label] = evt.status;
    var c = card(evt.label);
    if (!c) return;
    c.dataset.status = evt.status;
    c.querySelector(".sensor-drop").hidden = evt.status !== "connected" && evt.status !== "reconnecting";
    if (evt.status === "disconnected" || evt.status === "error") {
      live[evt.label] = null;
      c.querySelector(".sensor-device").textContent = "—";
      c.querySelector(".sensor-readout").textContent = STATUS_TEXT[evt.status];
    }
    if (evt.status === "error" && evt.message) note.textContent = evt.label + ": " + evt.message;
    renderSummary();
    // Lets the training view show or hide its Record buttons.
    document.dispatchEvent(new CustomEvent("vlo:sensors"));
  }
  MSBle.setStatusHandler(applyStatus);
  MSSim.setStatusHandler(applyStatus);

  function renderSummary() {
    var on = ["left", "right"].filter(function (l) { return status[l] === "connected"; });
    if (!on.length) summary.textContent = "No sensors connected";
    else if (on.length === 2) summary.textContent = "Both sleeves connected";
    else summary.textContent = on[0] === "left" ? "Left sleeve connected" : "Right sleeve connected";
  }

  // One repaint per second rather than per notification: the sensors push
  // ~104 samples/s each, which would otherwise thrash layout for no gain.
  setInterval(function () {
    ["left", "right"].forEach(function (label) {
      var c = card(label);
      if (!c) return;
      var s = live[label];
      var hz = counts[label];
      counts[label] = 0;
      if (!s) return;
      c.querySelector(".sensor-device").textContent = s.device || "—";
      c.querySelector(".sensor-readout").textContent =
        "x " + s.x.toFixed(2) + "   y " + s.y.toFixed(2) + "   z " + s.z.toFixed(2) + "   ·  " + hz + " Hz";
    });
  }, 1000);

  document.querySelectorAll("[data-connect]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var label = btn.dataset.connect;
      note.textContent = "";
      transport().addSensor(label).catch(function (err) {
        // A cancelled browser picker is a normal outcome, not a failure.
        if (err && err.name === "NotFoundError") { applyStatus({ label: label, status: "disconnected" }); return; }
        applyStatus({ label: label, status: "error", message: String(err && err.message || err) });
      });
    });
  });

  document.querySelectorAll("[data-disconnect]").forEach(function (btn) {
    btn.addEventListener("click", function () { transport().disconnectSensor(btn.dataset.disconnect); });
  });

  document.getElementById("simToggle").addEventListener("change", function () {
    ["left", "right"].forEach(function (l) {
      MSBle.disconnectSensor(l);
      MSSim.disconnectSensor(l);
    });
    var simulating = this.checked;
    // Simulated sensors need no Bluetooth, so the connect buttons come back
    // even on a browser that can't talk to real hardware.
    document.querySelectorAll("[data-connect]").forEach(function (b) {
      b.disabled = !simulating && !navigator.bluetooth;
    });
    note.textContent = simulating
      ? "Simulated sensors: replaying a recorded set of 11 squats, to try connecting and recording. Simulated recordings are never saved or analyzed."
      : unsupportedNote;
    if (SENSOR_MIRROR) note.textContent += (note.textContent ? " " : "") + MIRROR_NOTE;
  });

  var MIRROR_NOTE = "Test mode (?mirror=1): connect one sensor; its samples are copied to the other side when a set is saved. Not for real training data.";
  var unsupportedNote = "";
  if (!navigator.bluetooth) {
    unsupportedNote = "This browser has no Web Bluetooth, so real sensors can't connect. " +
      "It needs Chrome or Edge over https:// or localhost — Safari and Firefox don't support it at all. " +
      "Tick Simulate to try the flow without hardware.";
    document.querySelectorAll("[data-connect]").forEach(function (b) { b.disabled = true; });
  } else if (!window.isSecureContext) {
    unsupportedNote = "Web Bluetooth needs a secure context. Serve this page over https:// or from localhost — " +
      "opening the file directly won't let the sensors connect.";
  }
  note.textContent = unsupportedNote;
  if (SENSOR_MIRROR) note.textContent += (note.textContent ? " " : "") + MIRROR_NOTE;

  renderSummary();
})();
