/* recorder.js — collects the sensor samples of one set between Start and Stop.
   Part of V-Lo. Loaded as a plain script; see vlo.html for the order.

   sensors.js hands every sample to Recorder.add(). Accelerometer and gyro
   arrive as separate streams, so on stop() each accelerometer sample gets the
   gyro reading at its own moment (interpolated between the two nearest gyro
   samples). The result is the raw-session row format python/main.py reads:
   { sensor, t, recvAt, x, y, z, gx, gy, gz }. */
"use strict";

var Recorder = (function () {
  var MAX_SECONDS = 300; // a set never runs this long; stops a forgotten recording growing forever

  var active = null; // { acc: {left, right}, gyro: {left, right}, startedAt, meta }

  function start(meta) {
    active = { acc: { left: [], right: [] }, gyro: { left: [], right: [] }, startedAt: Date.now(), meta: meta || {} };
  }

  function add(s) {
    if (!active) return;
    var list = (s.kind === "gyro" ? active.gyro : active.acc)[s.sensor];
    if (!list) return;
    list.push(s);
    if (Date.now() - active.startedAt > MAX_SECONDS * 1000) stop();
  }

  function seconds() { return active ? (Date.now() - active.startedAt) / 1000 : 0; }
  function sampleCount() { return active ? active.acc.left.length + active.acc.right.length : 0; }
  function meta() { return active ? active.meta : null; }

  // Gyro value at time t, linearly interpolated; walks forward with `cursor`
  // because accelerometer samples come in time order.
  function gyroAt(gyro, t, cursor) {
    if (!gyro.length) return null;
    while (cursor.i < gyro.length - 2 && gyro[cursor.i + 1].t < t) cursor.i++;
    var a = gyro[cursor.i], b = gyro[Math.min(cursor.i + 1, gyro.length - 1)];
    if (t <= a.t || a === b) return a;
    if (t >= b.t) return b;
    var f = (t - a.t) / (b.t - a.t);
    return { gx: a.gx + (b.gx - a.gx) * f, gy: a.gy + (b.gy - a.gy) * f, gz: a.gz + (b.gz - a.gz) * f };
  }

  // Ends the recording and returns the merged rows, or null if nothing was recording.
  function stop() {
    if (!active) return null;
    var rec = active;
    active = null;
    var rows = [];
    // Single-sensor test mode (sensors.js, ?mirror=1): copy the one sensor to the other side.
    if (typeof SENSOR_MIRROR !== "undefined" && SENSOR_MIRROR) {
      ["acc", "gyro"].forEach(function (kind) {
        var l = rec[kind].left, r = rec[kind].right;
        if (!l.length && r.length) rec[kind].left = r.map(function (s) { return Object.assign({}, s, { sensor: "left" }); });
        if (!r.length && l.length) rec[kind].right = l.map(function (s) { return Object.assign({}, s, { sensor: "right" }); });
      });
    }
    ["left", "right"].forEach(function (side) {
      var acc = rec.acc[side].slice().sort(function (a, b) { return a.t - b.t; });
      var gyro = rec.gyro[side].slice().sort(function (a, b) { return a.t - b.t; });
      var cursor = { i: 0 };
      acc.forEach(function (s) {
        var g = gyroAt(gyro, s.t, cursor);
        rows.push({
          sensor: side, t: s.t, recvAt: s.recvAt, x: s.x, y: s.y, z: s.z,
          gx: g ? g.gx : null, gy: g ? g.gy : null, gz: g ? g.gz : null
        });
      });
    });
    return { rows: rows, meta: rec.meta, seconds: (Date.now() - rec.startedAt) / 1000, startedAt: rec.startedAt };
  }

  return {
    start: start, add: add, stop: stop,
    isRecording: function () { return !!active; },
    seconds: seconds, sampleCount: sampleCount, meta: meta
  };
})();
