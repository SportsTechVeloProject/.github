/* plans.js — Training plan import: text/CSV/Word/Excel parsing, the coach template, rendering.
   Part of V-Lo. Loaded as a plain script; see vlo.html for the order. */
"use strict";

/* ---------------- training plans: parse ---------------- */
// The plan text a coach actually writes is loose, so the parser is loose too:
// it pulls recognisable tokens out of a line in any order and treats whatever
// survives as the exercise name. Anything it can't place is surfaced, never dropped.

var PLAN_KEY = "vlo.plan.v1";

// Folds a name down to plain ASCII so Icelandic and Swedish lift names match
// with the same patterns as English ones. Doing this up front also avoids \b
// behaving oddly around þ, ð and æ, which JavaScript treats as non-word
// characters — /\bþungt/ never matches "þungt" at the start of a line.
function fold(s) {
  return String(s || "").toLowerCase()
    .replace(/þ/g, "th").replace(/ð/g, "d").replace(/æ/g, "ae").replace(/ø/g, "o")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Matched against the folded name, so e.g. "hnebeygj" covers Hnébeygja and
// the oblique Hnébeygju that shows up in "3 sett af hnébeygju".
var LIFT_MATCHERS = [
  // The plain forms include Icelandic case endings, so "3 sett af hnébeygju"
  // is still the plain lift rather than looking like a variant of it.
  { key: "bench", re: /\bbench\b|\bbp\b|bekkpress|bankpress/,
    plain: ["bench", "bench press", "bekkpressa", "bekkpressu", "bankpress", "bankpressen"] },
  { key: "deadlift", re: /\bdead ?lifts?\b|\bdls?\b|\brdls?\b|romanian|rettstodulyft|rettstada|marklyft/,
    plain: ["deadlift", "dead lift", "rettstodulyfta", "rettstodulyftu", "rettstodulyftur",
            "marklyft", "marklyftet"] },
  { key: "squat", re: /\bsquats?\b|\bsq\b|hnebeygj|knaboj/,
    plain: ["squat", "squats", "hnebeygja", "hnebeygju", "hnebeygjur", "knaboj", "knabojen"] }
];

var NEUTRAL_QUALIFIERS = /\b(back|barbell|comp|competition|flat|conventional|press|the|klassisk|klassisk[ta]?|keppni|stong|skivstang)\b/g;

// Returns the sensor-tracked lift a written name refers to, and whether the
// name carries qualifiers ("pause squat", "framhnébeygja") making it a variant.
function matchLift(name) {
  var bare = fold(name);
  var core = bare.replace(NEUTRAL_QUALIFIERS, " ").replace(/\s+/g, " ").trim();
  for (var i = 0; i < LIFT_MATCHERS.length; i++) {
    if (LIFT_MATCHERS[i].re.test(bare)) {
      return { key: LIFT_MATCHERS[i].key, variant: LIFT_MATCHERS[i].plain.indexOf(core) < 0 };
    }
  }
  return null;
}

function tempoChars(tok) {
  if (!/^[0-9xX]{4}$/.test(tok)) return null;
  return tok.toUpperCase().split("").map(function (c) { return c === "X" ? "X" : parseInt(c, 10); });
}

// Four-character tempo is written eccentric-first by convention. The deadlift
// starts from the floor, so for the pull the first phase is the concentric.
function describeTempo(t, liftKey) {
  var labels = liftKey === "deadlift"
    ? ["up", "held at lockout", "down", "reset on the floor"]
    : ["down", "held in the bottom", "up", "held at the top"];
  var out = [];
  for (var i = 0; i < 4; i++) {
    var v = t[i], isPause = (i === 1 || i === 3);
    if (isPause) {
      if (v !== 0 && v !== "X") out.push(v + "s " + labels[i]);
    } else if (v === "X") {
      out.push("explosive " + labels[i]);
    } else if (v === 0) {
      out.push("controlled " + labels[i]);
    } else {
      out.push(v + "s " + labels[i]);
    }
  }
  return out.join(" · ");
}

// Time units a coach might write, in English, Icelandic and Swedish.
var DURATION_UNIT = "(s|secs?|seconds?|sek|sekúndur|sekunder|min|mins|minutes?|mín|mínútur|minuter|h|hrs?|hours?|klst|tim(?:mar)?)";

function durationSeconds(value, unit) {
  var v = parseFloat(String(value).replace(",", "."));
  var u = unit.toLowerCase();
  if (/^(h|hrs?|hours?|klst|tim|timmar)$/.test(u)) return Math.round(v * 3600);
  if (/^(min|mins|minutes?|mín|mínútur|minuter)$/.test(u)) return Math.round(v * 60);
  return Math.round(v);
}

// 45 -> "45 s", 1200 -> "20 min", 5400 -> "1 h 30 min"
function formatDuration(sec) {
  if (sec == null) return "";
  if (sec < 120 && sec % 60 !== 0) return sec + " s";
  var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return (h ? h + " h" + (m ? " " : "") : "") + (m ? m + " min" : "");
}

function parseExerciseLine(raw) {
  var item = {
    raw: raw, name: "", lift: null, sets: null, reps: null, repsText: "", duration: null, zone: null,
    load: null, tempo: null, velocity: null, velocityLoss: null, note: "", warnings: []
  };
  var rest = " " + raw.replace(/^\s*[-*•]\s+/, "").trim() + " ";

  function take(re, fn) {
    var m = rest.match(re);
    if (!m) return false;
    rest = rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length);
    fn(m);
    return true;
  }

  // 1. trailing note
  take(/\/\/\s*(.+?)\s*$/, function (m) { item.note = m[1]; });

  // 2. tempo — always marked, so "@3010" can't be mistaken for a load
  take(/\[([0-9xX]{4})\]/, function (m) { item.tempo = tempoChars(m[1]); });
  if (!item.tempo) {
    take(/(?:^|\s)(?:@\s*|tempo\s*:?\s*|t\s*:\s*)([0-9xX]{4})(?=\s|$)/i, function (m) {
      item.tempo = tempoChars(m[1]);
    });
  }

  // 3. velocity prescriptions, before any percentage rule — "VL20%" is a
  // velocity-loss cutoff, not twenty percent of a one-rep max.
  take(/(?:^|\s)(?:vl|velocity\s*loss|hra[dð]atap)\s*:?\s*(\d{1,2})\s*%?/i, function (m) {
    item.velocityLoss = parseInt(m[1], 10);
  });
  if (item.velocityLoss == null) {
    take(/(?:^|\s)(\d{1,2})\s*%\s*(?:vl\b|velocity\s*loss|loss)/i, function (m) {
      item.velocityLoss = parseInt(m[1], 10);
    });
  }
  take(/(?:^|\s)@?\s*(\d\.\d{1,2})\s*(?:[-–]\s*(\d\.\d{1,2})\s*)?m\s*\/\s*s/i, function (m) {
    item.velocity = { min: parseFloat(m[1]), max: m[2] ? parseFloat(m[2]) : null };
  });

  // 3b. training zone the coach wants the sets in — velocity-based planning:
  // one of the five zones ("Back squat 5x3 strength-speed", "zone: absolute
  // strength", "@accelerative"), or "medium" for anywhere in 0.50–1.30 m/s.
  // Multi-word names count anywhere on the line. Single words (medium, fast,
  // slow, power, absolute, accelerative, speed…) only count when marked with
  // "zone:"/"@", followed by "zone", or last on the line, so "Power clean
  // 3x3" or "3x5 slow eccentric" aren't read as zones. Saved as the zone key
  // (or "medium"); see zoneKey / zoneGroup in core.js.
  var zoneName = zoneKey;
  var gotZone = take(/(?:^|\s)(?:zone\s*:?\s*|@\s*)?(starting\s+strength(?:\s*\/\s*speed)?|absolute\s+strength|speed[\s\-–]*strength|strength[\s\-–]*speed|accelerative(?:\s+strength)?|max(?:imal)?\s+strength)(?=[\s,;]|$)/i, function (m) {
    item.zone = zoneName(m[1]);
  });
  var ZONE_WORD = "(power|speed|absolute|accelerative|explosiv(?:e|ity)|traditional|fast|medium|slow)";
  if (!gotZone) take(new RegExp("(?:^|\\s)(?:zone\\s*:?\\s*|@\\s*)" + ZONE_WORD + "(?=[\\s,;]|$)|(?:^|\\s)" + ZONE_WORD + "(?:\\s+zone\\b|(?=\\s*[,;]?\\s*$))", "i"), function (m) {
    item.zone = zoneName(m[1] || m[2]);
  });

  // 4. load — percentage and RPE before any bare "@140", which is kilos
  take(/(?:^|\s)@?\s*(\d{1,3}(?:\.\d+)?)\s*%/, function (m) {
    item.load = { kind: "pct", value: parseFloat(m[1]) };
  });
  if (!item.load) {
    take(/(?:^|\s)@?\s*rpe\s*:?\s*(\d{1,2}(?:\.\d+)?)/i, function (m) {
      item.load = { kind: "rpe", value: parseFloat(m[1]) };
    });
  }
  if (!item.load) {
    take(/(?:^|\s)@?\s*(\d{1,4}(?:[.,]\d+)?)\s*(kgs?|kilos?|lbs?|pounds?)\b/i, function (m) {
      var v = parseFloat(m[1].replace(",", "."));
      if (/^(lb|pound)/i.test(m[2])) v = Math.round(v * 0.45359237 * 2) / 2;
      item.load = { kind: "kg", value: v };
    });
  }
  if (!item.load) {
    take(/(?:^|\s)@\s*(\d{1,4}(?:[.,]\d+)?)(?=\s|$)/, function (m) {
      item.load = { kind: "kg", value: parseFloat(m[1].replace(",", ".")) };
    });
  }

  // 5. sets and reps. Time-based work is tried before the plain NxM form,
  // otherwise "3x30sek" reads as thirty reps and loses the unit. item.duration
  // is the time per set in seconds ("3x45s", "Bike 20 min", "Walk 1 h").
  var gotScheme = take(new RegExp("(?:^|\\s)(\\d{1,2})\\s*[x×*]\\s*(\\d{1,3})\\s*" + DURATION_UNIT + "(?=\\s|$)", "i"), function (m) {
    item.sets = parseInt(m[1], 10);
    item.duration = durationSeconds(m[2], m[3]);
    item.repsText = formatDuration(item.duration);
  });
  if (!gotScheme) gotScheme = take(/(?:^|\s)(\d{1,2})\s*[x×*]\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?(?=\s|$)/i, function (m) {
    item.sets = parseInt(m[1], 10);
    item.reps = parseInt(m[2], 10);
    item.repsText = m[3] ? m[2] + "–" + m[3] : m[2];
  });
  if (!gotScheme) {
    // (not when a time unit follows: "3 sets 30 s" is timed, handled below)
    gotScheme = take(/(?:^|\s)(\d{1,2})\s*sets?\s*(?:of|x)?\s*(\d{1,2})(?=\s|$)(?!\s*(?:s|secs?|seconds?|sek|min|mins|minutes?|mín|h)(?:\s|$))/i, function (m) {
      item.sets = parseInt(m[1], 10);
      item.reps = parseInt(m[2], 10);
      item.repsText = m[2];
    });
  }
  if (!gotScheme) {
    gotScheme = take(/(?:^|\s)(\d{1,2})\s*[x×*]\s*(failure|fail|max|amrap)\b/i, function (m) {
      item.sets = parseInt(m[1], 10);
      item.repsText = m[2].toLowerCase();
    });
  }
  // A descending ladder like 12-10-8-6 is one set per number. Three numbers
  // minimum, so a plain rep range such as 8-10 isn't mistaken for one.
  if (!gotScheme) {
    gotScheme = take(/(?:^|\s)(\d{1,2}(?:\s*[-–]\s*\d{1,2}){2,})(?=\s|$)/, function (m) {
      var list = m[1].split(/[-–]/).map(function (n) { return parseInt(n.trim(), 10); });
      item.sets = list.length;
      item.reps = list[0];
      item.repsText = list.join("/");
    });
  }
  if (!gotScheme) {
    gotScheme = take(/(?:^|\s)(\d{1,2}(?:\s*,\s*\d{1,2})+)(?=\s|$)/, function (m) {
      var list = m[1].split(",").map(function (n) { return parseInt(n.trim(), 10); });
      item.sets = list.length;
      item.reps = list[0];
      item.repsText = list.join("/");
    });
  }
  // "10 rep max" and "5RM" are a single top set, not ten sets.
  if (!gotScheme) {
    gotScheme = take(/(?:^|\s)(\d{1,2})\s*reps?\s*max\b/i, function (m) {
      item.sets = 1;
      item.reps = parseInt(m[1], 10);
      item.repsText = m[1] + " rep max";
    });
  }
  if (!gotScheme) {
    gotScheme = take(/(?:^|\s)(\d{1,2})\s*rm\b/i, function (m) {
      item.sets = 1;
      item.reps = parseInt(m[1], 10);
      item.repsText = m[1] + "RM";
    });
  }
  // A duration on its own is one timed bout: "Bike 20 min", "Walk 1 h". Last
  // resort, so "3x2 2s pause" stays three sets of two.
  if (!gotScheme) gotScheme = take(new RegExp("(?:^|\\s)(\\d{1,3}(?:[.,]\\d)?)\\s*" + DURATION_UNIT + "(?=\\s|$)", "i"), function (m) {
    item.sets = 1;
    item.duration = durationSeconds(m[1], m[2]);
    item.repsText = formatDuration(item.duration);
    // "Plank 3 sets 30 s": the count still applies.
    take(/(?:^|\s)(\d{1,2})\s*(sett|sets?|rounds?|hringir)(?:\s+of|\s+af)?\b/i, function (c) { item.sets = parseInt(c[1], 10); });
  });
  // Counts with no partner: "3 sett", "2 hringir", "10 reps".
  if (!gotScheme) {
    gotScheme = take(/(?:^|\s)(\d{1,2})\s*(sett|sets?)\b/i, function (m) {
      item.sets = parseInt(m[1], 10);
    });
  }
  if (!gotScheme) {
    gotScheme = take(/(?:^|\s)(\d{1,2})\s*(hringir|hringi|hringur|umferðir|rounds?)\b/i, function (m) {
      item.sets = parseInt(m[1], 10);
      item.repsText = "rounds";
    });
  }
  if (!gotScheme) {
    take(/(?:^|\s)(\d{1,3})\s*(reps?|endurtekningar)\b/i, function (m) {
      item.sets = 1;
      item.reps = parseInt(m[1], 10);
      item.repsText = m[1];
    });
  }

  // 6. bracketed note, once tempo has had its chance at the brackets
  if (!item.note) take(/\(([^)]*)\)/, function (m) { item.note = m[1]; });

  item.name = rest.replace(/[\s,;:@-]+$/, "").replace(/^[\s,;:-]+/, "").replace(/\s+/g, " ").trim();
  if (!item.name) { item.warnings.push("no exercise name"); return null; }
  // The exercise bank (exercises.js) knows names in several languages and
  // which lifts the sensors analyze. A name it doesn't know gets no analysis
  // (item.lift stays null), even if it looks like a squat: "Zercher squat"
  // isn't analyzed as a back squat.
  var known = findExercise(item.name);
  item.exerciseKey = known ? known.key : null;
  var lift = known ? analyzedLift(known) : null;
  item.lift = lift ? { key: lift, variant: ["back_squat", "bench_press", "deadlift"].indexOf(known.key) === -1 } : null;
  return item;
}

/* ---- tables: Word tables, Excel sheets and CSV all arrive as rows of cells ---- */

// Keys are compared folded, so these are written in plain ASCII: "aefing" is
// æfing, "thyngd" is þyngd, "alag" is álag, "ovning" is övning.
var HEADER_ALIASES = {
  exercise: ["exercise", "exercises", "lift", "lifts", "movement", "aefing", "aefingar", "ovning", "ovningar"],
  sets: ["sets", "set", "sett", "umferdir"],
  reps: ["reps", "rep", "repetitions", "endurtekningar", "endurt", "repetitioner"],
  load: ["load", "weight", "intensity", "kg", "thyngd", "alag", "vikt"],
  rpe: ["rpe", "rir"],
  tempo: ["tempo", "taktur"],
  velocity: ["target velocity", "velocity", "target vel", "vel", "m s", "hradi", "malhradi"],
  velocity_loss: ["velocity loss", "vl", "vel loss", "loss", "hradatap"],
  zone: ["zone", "training zone", "vbt zone", "svaedi", "zon"],
  notes: ["notes", "note", "comment", "comments", "athugasemdir", "athugasemd", "minnispunktar", "kommentar"],
  week: ["week", "wk", "vika", "vecka"],
  day: ["day", "session", "pass", "dag", "dagur", "lota"]
};

function headerMap(cells) {
  var map = {};
  cells.forEach(function (raw, i) {
    var c = fold(raw);
    if (!c) return;
    Object.keys(HEADER_ALIASES).forEach(function (key) {
      if (map[key] === undefined && HEADER_ALIASES[key].indexOf(c) >= 0) map[key] = i;
    });
  });
  return map;
}

// A cell counts as an exercise if the line parser finds a scheme, a load or a
// tempo in it. That one test is what separates a label row or column from data,
// so a grid of days across the top and weeks down the side reads correctly.
function exerciseLike(text) {
  var first = String(text || "").trim().split(/\n/)[0];
  if (!first) return false;
  var item = parseExerciseLine(first);
  return !!(item && (item.sets !== null || item.load !== null || item.tempo !== null || item.zone !== null));
}

function cellText(row, i) { return i === undefined ? "" : String(row[i] === undefined ? "" : row[i]).trim(); }

// Templates use a dash to mean "not performed this week".
function cleanCell(v) {
  var t = String(v || "").trim();
  return (!t || /^[-–—]+$/.test(t)) ? "" : t;
}

// Typing a rep range like 8-10 into a General cell makes Excel store a date
// instead, so those columns come back as serial numbers. The month and day
// are the two numbers that were typed, which gives the range back.
function unmangleRange(value) {
  var n = parseFloat(value);
  if (!isFinite(n) || n % 1 !== 0 || n < 30000 || n > 60000) return null;
  var d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return (d.getUTCMonth() + 1) + "-" + d.getUTCDate();
}

function rangeCell(row, i) {
  var raw = cleanCell(cellText(row, i));
  return unmangleRange(raw) || raw;
}

function prescriptionLine(row, m, name) {
  var parts = [name];
  var sets = cleanCell(cellText(row, m.sets));
  var reps = rangeCell(row, m.reps);
  if (sets && reps) parts.push(sets + "x" + reps);
  else if (reps) parts.push("1x" + reps);
  else if (sets) parts.push(sets + " sets");
  var load = cleanCell(cellText(row, m.load));
  if (load) parts.push(/[%a-z]/i.test(load) ? load : load + "kg");
  var rpe = rangeCell(row, m.rpe);
  if (rpe) parts.push("@RPE" + rpe);
  var tempo = cleanCell(cellText(row, m.tempo));
  if (tempo) parts.push("[" + tempo + "]");
  var vel = cleanCell(cellText(row, m.velocity));
  if (vel) parts.push(/m\s*\/\s*s/i.test(vel) ? vel : vel + " m/s");
  var zone = cleanCell(cellText(row, m.zone));
  if (zone) parts.push("zone: " + zone);
  var vloss = cleanCell(cellText(row, m.velocity_loss));
  if (vloss) parts.push("VL" + vloss.replace(/[^\d]/g, "") + "%");
  var note = cleanCell(cellText(row, m.notes));
  if (note) parts.push("// " + note);
  return parts.length > 1 ? parts.join(" ") : "";
}

// "DAY 1 | SETS | REPS | WEIGHT | RPE | TEMPO | NOTES" — a header row whose
// first column is titled with the day rather than with "Exercise". Returns
// the exercise column index, or -1 when the row isn't one of these.
function dayBlockHeader(row) {
  var first = -1;
  for (var i = 0; i < row.length; i++) { if (cellText(row, i)) { first = i; break; } }
  if (first < 0 || !isDayHeading(cellText(row, first))) return -1;
  var m = headerMap(row), known = 0;
  ["sets", "reps", "load", "rpe", "tempo", "notes"].forEach(function (k) {
    if (m[k] !== undefined) known++;
  });
  return known >= 2 ? first : -1;
}

function weekHeading(label) {
  var t = String(label || "").trim();
  if (!t) return null;
  return "## " + (/^\d+$/.test(t) ? "Week " + t : t);
}
function dayHeading(label) {
  var t = String(label || "").trim();
  if (!t) return null;
  return "### " + (/^\d+$/.test(t) ? "Day " + t : t);
}

// Converts a table to the same plain-text plan the textarea holds, rather than
// straight to a plan object. The extraction stays visible and editable, and
// everything downstream has exactly one input format to understand.
var BLOCK_KEYS = ["block name", "block type", "working on", "end goal", "goal", "weeks",
                  "sessions per week", "session length", "athlete", "notes"];

// A label/value sheet describing the block rather than a week of training.
// Emitted as "::key: value" lines so it survives the trip through the text
// box and stays visible and editable like everything else.
function blockMetaLines(rows) {
  var hits = [], out = [];
  rows.forEach(function (row) {
    var key = fold(cellText(row, 0));
    if (BLOCK_KEYS.indexOf(key) < 0) return;
    hits.push(key);
    var value = cleanCell(cellText(row, 1));
    if (value) out.push(":: " + cellText(row, 0) + ": " + value);
  });
  return hits.length >= 3 ? out : null;
}

function rowsToLines(rows, contextLabel) {
  rows = rows.filter(function (r) {
    return r.some(function (c) { return String(c === undefined ? "" : c).trim(); });
  });
  if (!rows.length) return [];

  var meta = blockMetaLines(rows);
  if (meta) return meta;

  var m = headerMap(rows[0]);
  var lines = [];

  if (m.exercise !== undefined && Object.keys(m).length >= 2) {
    var lastWeek = null, lastDay = null;
    if (contextLabel && m.week === undefined) lines.push(weekHeading(contextLabel));
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var name = cellText(row, m.exercise);
      if (!name) continue;
      var wk = cellText(row, m.week), dy = cellText(row, m.day);
      if (wk && wk !== lastWeek) { lines.push(weekHeading(wk)); lastWeek = wk; lastDay = null; }
      if (dy && dy !== lastDay) { lines.push(dayHeading(dy)); lastDay = dy; }
      lines.push(prescriptionLine(row, m, name) || name);
    }
    return lines;
  }

  // A header row repeated once per day. Bought templates often run several
  // weeks side by side, so one row can carry several of these — each owning
  // the columns up to the next day title on that row.
  var weekMarks = [];
  rows.forEach(function (row, r) {
    for (var i = 0; i < row.length; i++) {
      var v = cellText(row, i);
      if (v && isWeekHeading(v)) weekMarks.push({ row: r, col: i, label: v });
    }
  });

  function weekFor(headerRow, col) {
    var bestRow = -1;
    weekMarks.forEach(function (w) { if (w.row <= headerRow && w.row > bestRow) bestRow = w.row; });
    if (bestRow < 0) return "";
    var pick = null;
    weekMarks.forEach(function (w) {
      if (w.row !== bestRow) return;
      if (!pick || Math.abs(w.col - col) < Math.abs(pick.col - col)) pick = w;
    });
    return pick ? pick.label : "";
  }

  function blocksInRow(row) {
    var starts = [];
    for (var i = 0; i < row.length; i++) {
      var v = cellText(row, i);
      if (v && isDayHeading(v)) starts.push(i);
    }
    var out = [];
    starts.forEach(function (s, k) {
      var end = k + 1 < starts.length ? starts[k + 1] : row.length;
      var m = headerMap(row.slice(s, end)), known = 0;
      ["sets", "reps", "load", "rpe", "tempo", "notes"].forEach(function (key) {
        if (m[key] !== undefined) known++;
      });
      if (known < 2) return;
      Object.keys(m).forEach(function (key) { m[key] += s; });
      out.push({ nameCol: s, map: m, day: cellText(row, s), start: s });
    });
    return out;
  }

  var weekOrder = [], byWeek = {};
  function bucket(weekLabel, dayLabel) {
    if (!byWeek[weekLabel]) { byWeek[weekLabel] = []; weekOrder.push(weekLabel); }
    var d = byWeek[weekLabel].filter(function (x) { return x.label === dayLabel; })[0];
    if (!d) { d = { label: dayLabel, items: [] }; byWeek[weekLabel].push(d); }
    return d;
  }

  var active = null;
  for (var br = 0; br < rows.length; br++) {
    var found = blocksInRow(rows[br]);
    if (found.length) {
      active = found.map(function (b) { b.week = weekFor(br, b.start); return b; });
      continue;
    }
    if (!active) continue;
    active.forEach(function (b) {
      var exName = cleanCell(cellText(rows[br], b.nameCol));
      // Templates close each day with their own volume totals.
      if (!exName || /^total\b/i.test(exName)) return;
      var line = prescriptionLine(rows[br], b.map, exName);
      if (line) bucket(b.week, b.day).items.push(line);
    });
  }

  if (weekOrder.length) {
    weekOrder.forEach(function (w) {
      if (w) lines.push(weekHeading(w));
      byWeek[w].forEach(function (d) {
        if (!d.items.length) return;
        if (d.label) lines.push(dayHeading(d.label));
        d.items.forEach(function (i) { lines.push(i); });
      });
      lines.push("");
    });
    return lines;
  }

  // Weeks across the top with exercise names down a column, each cell holding
  // only that week's prescription for the exercise named at the start of the
  // row. This is how almost every real spreadsheet plan is actually built.
  var weekRow = -1, weekCols = [];
  for (var wr = 0; wr < Math.min(rows.length, 8); wr++) {
    var found = [];
    rows[wr].forEach(function (c, i) { if (isWeekHeading(c)) found.push(i); });
    if (found.length >= 2) { weekRow = wr; weekCols = found; break; }
  }

  if (weekRow >= 0) {
    // A sheet often holds two blocks side by side, each with its own exercise
    // column, so every week resolves its own: the nearest column to its left
    // that isn't itself a week and does carry text.
    function nameColumnFor(col) {
      for (var j = col - 1; j >= 0; j--) {
        if (weekCols.indexOf(j) >= 0) continue;
        for (var r = weekRow + 1; r < rows.length; r++) {
          if (cellText(rows[r], j)) return j;
        }
      }
      return -1;
    }

    var weeks = weekCols.map(function (c) {
      return { label: cellText(rows[weekRow], c), col: c, nameCol: nameColumnFor(c), days: [] };
    });

    var byNameCol = {};
    weeks.forEach(function (w) {
      if (w.nameCol < 0) return;
      (byNameCol[w.nameCol] = byNameCol[w.nameCol] || []).push(w);
    });

    Object.keys(byNameCol).forEach(function (key) {
      var nameCol = parseInt(key, 10);
      var group = byNameCol[key];
      var currentDay = "";
      for (var mr = weekRow + 1; mr < rows.length; mr++) {
        var name = cellText(rows[mr], nameCol);
        if (!name) continue;
        if (isDayHeading(name)) { currentDay = name; continue; }
        group.forEach(function (w) {
          var scheme = cellText(rows[mr], w.col).replace(/\s*\n\s*/g, " ");
          if (!scheme) return;
          var day = w.days.filter(function (d) { return d.label === currentDay; })[0];
          if (!day) { day = { label: currentDay, items: [] }; w.days.push(day); }
          day.items.push(name + " " + scheme);
        });
      }
    });

    weeks.forEach(function (w) {
      if (!w.days.some(function (d) { return d.items.length; })) return;
      lines.push(weekHeading(w.label));
      w.days.forEach(function (d) {
        if (!d.items.length) return;
        if (d.label) lines.push(dayHeading(d.label));
        d.items.forEach(function (i) { lines.push(i); });
      });
      lines.push("");
    });
    return lines;
  }

  // No recognisable header, so treat it as a grid: labels along the top are
  // days, labels down the side are weeks, and every other cell is an exercise.
  var topCells = rows[0].slice(1);
  var hasColLabels = topCells.some(function (c) { return String(c || "").trim(); }) &&
                     !topCells.some(exerciseLike);
  var sideCells = rows.slice(hasColLabels ? 1 : 0).map(function (r) { return r[0]; });
  var hasRowLabels = sideCells.some(function (c) { return String(c || "").trim(); }) &&
                     !sideCells.some(exerciseLike);

  // Grouped rather than emitted inline: with days across the top and no week
  // column, every row would otherwise re-open the same day.
  var groups = [];
  function groupFor(week, day) {
    var found = groups.filter(function (g) { return g.week === week && g.day === day; })[0];
    if (!found) { found = { week: week, day: day, items: [] }; groups.push(found); }
    return found;
  }

  for (var rr = hasColLabels ? 1 : 0; rr < rows.length; rr++) {
    for (var cc = hasRowLabels ? 1 : 0; cc < rows[rr].length; cc++) {
      var text = cellText(rows[rr], cc);
      if (!text) continue;
      var week = hasRowLabels ? cellText(rows[rr], 0) : String(contextLabel || "").trim();
      // Left blank rather than invented when the sheet has no column labels.
      // A made-up "Session 3" would otherwise read back as a real day heading
      // and make an instructions sheet look like a programme.
      var day = hasColLabels ? cellText(rows[0], cc) : "";
      var g = groupFor(week, day);
      text.split(/\n+/).forEach(function (l) { if (l.trim()) g.items.push(l.trim()); });
    }
  }

  var seenWeek = null;
  groups.forEach(function (g) {
    if (!g.items.length) return;
    if (g.week && g.week !== seenWeek) { lines.push(weekHeading(g.week)); seenWeek = g.week; }
    if (g.day) lines.push(dayHeading(g.day));
    g.items.forEach(function (i) { lines.push(i); });
    lines.push("");
  });
  return lines;
}

// English, Icelandic and Swedish headers, tested against the folded line so
// "Vika 3", "Þriðjudagur" and "Lördag" read the same as "Week 3" and "Tuesday".
function isWeekHeading(body) {
  return /^(week|wk|w|vika|vecka|uke|uge)\s*[:#]?\s*\d+/.test(fold(body));
}

function isDayHeading(body) {
  var f = fold(body);
  if (/^(day|dagur|dag|pass|lota|session|aefing)\s*[:#]?\s*\d+/.test(f)) return true;
  if (/^(mon|tue|wed|thu|fri|sat|sun)(day)?\b/.test(f)) return true;
  if (/^(manudag|thridjudag|midvikudag|fimmtudag|fostudag|laugardag|sunnudag)/.test(f)) return true;
  return /^(mandag|tisdag|onsdag|torsdag|fredag|lordag|sondag)/.test(f);
}

function looksLikeCsv(lines) {
  if (!lines.length) return false;
  var head = lines[0].toLowerCase();
  if (head.indexOf(",") < 0 && head.indexOf(";") < 0) return false;
  var known = ["exercise", "lift", "movement", "sets", "reps", "load", "weight", "tempo", "week", "day"];
  var hits = known.filter(function (k) { return head.indexOf(k) >= 0; });
  return hits.length >= 2;
}

function splitCsvRow(line, sep) {
  var out = [], cur = "", inQ = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === sep && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map(function (s) { return s.trim(); });
}

function csvToLines(lines) {
  var sep = lines[0].indexOf(";") > lines[0].indexOf(",") ? ";" : ",";
  return rowsToLines(lines.map(function (l) { return splitCsvRow(l, sep); }), "");
}

function parsePlan(text) {
  var lines = text.replace(/\r\n?/g, "\n").split("\n");
  var nonEmpty = lines.filter(function (l) { return l.trim(); });
  if (looksLikeCsv(nonEmpty)) lines = csvToLines(nonEmpty);

  var plan = { title: "", meta: {}, weeks: [], unparsed: [] };
  var week = null, day = null, sawAny = false;

  function ensureWeek(label) { week = { label: label, days: [] }; plan.weeks.push(week); day = null; }
  function ensureDay(label) {
    if (!week) ensureWeek("Plan");
    day = { label: label, items: [] };
    week.days.push(day);
  }

  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (!t) { day = null; continue; }

    var metaLine = t.match(/^::\s*([^:]+?)\s*:\s*(.+)$/);
    if (metaLine) { plan.meta[fold(metaLine[1])] = metaLine[2].trim(); continue; }

    var heading = t.match(/^(#{1,6})\s*(.+)$/);
    var hashes = heading ? heading[1].length : 0;
    var body = heading ? heading[2].trim() : t;

    // "##" and "###" are explicit week and day markers. Tables extracted from
    // Word and Excel emit them, so an arbitrary label like "Heavy" survives
    // the trip through this text form instead of looking like an exercise.
    if (hashes === 2 || isWeekHeading(body) || (hashes === 1 && /week|vika|vecka/i.test(body))) {
      ensureWeek(body.replace(/[:\s]+$/, ""));
      continue;
    }
    if (hashes === 1 && !sawAny && !plan.title) { plan.title = body; continue; }
    if (isDayHeading(body) || heading || (/:$/.test(body) && !/\d\s*[x×]\s*\d/i.test(body))) {
      ensureDay(body.replace(/[:\s]+$/, ""));
      continue;
    }

    var item = parseExerciseLine(t);
    if (!item) { plan.unparsed.push({ line: t, reason: "no exercise name left after reading the numbers" }); continue; }
    if (item.sets === null && item.load === null && item.tempo === null && item.zone === null) {
      plan.unparsed.push({ line: t, reason: "no sets, load or tempo found — read as prose, not an exercise" });
      continue;
    }
    if (!day) ensureDay(week ? "Session " + (week.days.length + 1) : "Session 1");
    day.items.push(item);
    sawAny = true;
  }

  plan.weeks = plan.weeks.filter(function (w) {
    w.days = w.days.filter(function (d) { return d.items.length; });
    return w.days.length;
  });
  return plan;
}

/* ---------------- .docx and .xlsx ---------------- */
// Both are ZIP archives of XML, so one minimal ZIP reader plus DOMParser
// covers them. DecompressionStream does the inflating, which keeps this page
// a single self-contained file instead of pulling in a spreadsheet library.

function readZip(buffer) {
  var view = new DataView(buffer);
  var bytes = new Uint8Array(buffer);
  var decoder = new TextDecoder();

  var eocd = -1;
  var floor = Math.max(0, bytes.length - 22 - 65535);
  for (var i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("this doesn't look like a .docx or .xlsx file");

  var count = view.getUint16(eocd + 10, true);
  var p = view.getUint32(eocd + 16, true);
  var entries = {};
  for (var n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    var nameLen = view.getUint16(p + 28, true);
    entries[decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))] = {
      method: view.getUint16(p + 10, true),
      compSize: view.getUint32(p + 20, true),
      localOffset: view.getUint32(p + 42, true)
    };
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }

  return {
    names: Object.keys(entries),
    text: function (name) {
      var e = entries[name];
      if (!e) return Promise.resolve("");
      // The central directory's name and extra lengths can disagree with the
      // local header's, so the data offset has to come from the local header.
      var lh = e.localOffset;
      var start = lh + 30 + view.getUint16(lh + 26, true) + view.getUint16(lh + 28, true);
      var data = bytes.subarray(start, start + e.compSize);
      if (e.method === 0) return Promise.resolve(decoder.decode(data));
      if (e.method !== 8) return Promise.reject(new Error("unsupported compression inside the file"));
      var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).text();
    }
  };
}

var W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function xml(text) { return new DOMParser().parseFromString(text, "application/xml"); }

function joinTags(node, ns, tag) {
  var els = ns ? node.getElementsByTagNameNS(ns, tag) : node.getElementsByTagName(tag);
  var out = "";
  for (var i = 0; i < els.length; i++) out += els[i].textContent;
  return out;
}

// A paragraph can hold several lines: a shift+enter inside a table cell is a
// <w:br/>, not a new paragraph, and stacking exercises that way in one cell is
// how most written training plans look. Dropping those breaks would run two
// exercises together into one unreadable line.
function paragraphLines(p) {
  var text = "";
  (function walk(node) {
    for (var i = 0; i < node.childNodes.length; i++) {
      var n = node.childNodes[i];
      if (n.nodeType !== 1) continue;
      if (n.namespaceURI === W_NS) {
        if (n.localName === "t") { text += n.textContent; continue; }
        if (n.localName === "br" || n.localName === "cr") { text += "\n"; continue; }
        if (n.localName === "tab") { text += " "; continue; }
      }
      walk(n);
    }
  })(p);
  return text.replace(/[ \t ]+/g, " ").split("\n")
             .map(function (s) { return s.trim(); })
             .filter(function (s) { return s; });
}

function headingPrefix(p) {
  var style = p.getElementsByTagNameNS(W_NS, "pStyle")[0];
  if (!style) return "";
  var val = style.getAttributeNS(W_NS, "val") || style.getAttribute("w:val") || "";
  if (/^Title$/i.test(val)) return "# ";
  var level = /^Heading\s*(\d)/i.exec(val);
  if (!level) return "";
  return parseInt(level[1], 10) <= 1 ? "## " : "### ";
}

function docxToLines(zip) {
  return zip.text("word/document.xml").then(function (text) {
    if (!text) throw new Error("no document body found in that .docx");
    var body = xml(text).getElementsByTagNameNS(W_NS, "body")[0];
    if (!body) throw new Error("no document body found in that .docx");
    var lines = [];

    for (var i = 0; i < body.childNodes.length; i++) {
      var node = body.childNodes[i];
      if (node.nodeType !== 1) continue;

      if (node.localName === "p") {
        var parts = paragraphLines(node);
        if (!parts.length) continue;
        var prefix = headingPrefix(node);
        parts.forEach(function (line) { lines.push(prefix ? prefix + line : line); });
        continue;
      }

      if (node.localName === "tbl") {
        var rows = [];
        var trs = node.getElementsByTagNameNS(W_NS, "tr");
        for (var r = 0; r < trs.length; r++) {
          var row = [];
          var tcs = trs[r].getElementsByTagNameNS(W_NS, "tc");
          for (var c = 0; c < tcs.length; c++) {
            var ps = tcs[c].getElementsByTagNameNS(W_NS, "p");
            var cell = [];
            for (var q = 0; q < ps.length; q++) cell = cell.concat(paragraphLines(ps[q]));
            row.push(cell.join("\n"));
          }
          rows.push(row);
        }
        lines = lines.concat(rowsToLines(rows, ""));
      }
    }
    return lines;
  });
}

function columnIndex(ref) {
  var m = /^([A-Z]+)/.exec(ref || "");
  if (!m) return 0;
  var n = 0;
  for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
  return n - 1;
}

function sheetRows(text, shared) {
  var rowEls = xml(text).getElementsByTagName("row");
  var rows = [];
  for (var i = 0; i < rowEls.length; i++) {
    var cells = [];
    var cs = rowEls[i].getElementsByTagName("c");
    for (var j = 0; j < cs.length; j++) {
      var c = cs[j];
      var type = c.getAttribute("t");
      var value;
      if (type === "s") {
        var idx = parseInt(joinTags(c, null, "v"), 10);
        value = shared[idx] === undefined ? "" : shared[idx];
      } else if (type === "inlineStr") {
        value = joinTags(c, null, "t");
      } else {
        value = joinTags(c, null, "v");
      }
      var at = columnIndex(c.getAttribute("r"));
      while (cells.length < at) cells.push("");
      cells[at] = value;
    }
    rows.push(cells);
  }
  return rows;
}

function xlsxToLines(zip) {
  var shared = [];
  return zip.text("xl/sharedStrings.xml").then(function (text) {
    if (text) {
      var sis = xml(text).getElementsByTagName("si");
      for (var i = 0; i < sis.length; i++) shared.push(joinTags(sis[i], null, "t"));
    }
    return Promise.all([zip.text("xl/workbook.xml"), zip.text("xl/_rels/workbook.xml.rels")]);
  }).then(function (both) {
    var rels = {};
    if (both[1]) {
      var rs = xml(both[1]).getElementsByTagName("Relationship");
      for (var i = 0; i < rs.length; i++) {
        rels[rs[i].getAttribute("Id")] = rs[i].getAttribute("Target").replace(/^\/?xl\//, "").replace(/^\//, "");
      }
    }
    var sheets = [];
    if (both[0]) {
      var els = xml(both[0]).getElementsByTagName("sheet");
      for (var j = 0; j < els.length; j++) {
        var rid = els[j].getAttribute("r:id") ||
                  els[j].getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
        var target = rels[rid];
        if (target) sheets.push({ name: els[j].getAttribute("name") || "", path: "xl/" + target });
      }
    }
    if (!sheets.length) {
      sheets = zip.names.filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); })
                        .map(function (n) { return { name: "", path: n }; });
    }
    return Promise.all(sheets.map(function (s) {
      return zip.text(s.path).then(function (t) { return { name: s.name, rows: t ? sheetRows(t, shared) : [] }; });
    }));
  }).then(function (loaded) {
    var useName = loaded.length > 1;
    var perSheet = loaded.map(function (s) {
      return { lines: rowsToLines(s.rows, useName ? s.name : "") };
    });
    // A workbook that has real program sheets usually also has a profile or
    // instructions sheet. Those produce no week or day structure, so once any
    // sheet does, the ones that don't are dropped rather than read as prose.
    var structured = perSheet.filter(function (s) {
      return s.lines.some(function (l) {
        var week = /^##\s+(.*)$/.exec(l);
        if (week) return isWeekHeading(week[1]);
        var day = /^###\s+(.*)$/.exec(l);
        return day ? isDayHeading(day[1]) : false;
      });
    });
    // Block metadata describes the whole workbook, so it is kept whichever
    // sheet carried it, even though that sheet holds no training of its own.
    var meta = [];
    perSheet.forEach(function (s) {
      s.lines.forEach(function (l) { if (l.indexOf("::") === 0) meta.push(l); });
    });
    var lines = meta.slice();
    (structured.length ? structured : perSheet).forEach(function (s) {
      s.lines.forEach(function (l) { if (l.indexOf("::") !== 0) lines.push(l); });
    });
    return lines;
  });
}

/* ---------------- coach template (.xlsx) ---------------- */
// Written by hand rather than with a library: an xlsx is a zip of XML, the
// entries are stored uncompressed because a template is a few kilobytes, and
// every string is inline so there's no shared-string table to maintain.

var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStored(entries) {
  var enc = new TextEncoder();
  var parts = [], central = [], offset = 0;

  entries.forEach(function (e) {
    var name = enc.encode(e.name);
    var data = enc.encode(e.text);
    var sum = crc32(data);

    var local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true);           // stored, no compression
    local.setUint32(14, sum, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    var cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, 0, true);
    cd.setUint32(16, sum, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);

    offset += 30 + name.length + data.length;
  });

  var cdSize = central.reduce(function (n, p) { return n + p.length; }, 0);
  var end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);

  return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]),
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function xmlEscape(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function colName(i) {
  var s = "";
  i += 1;
  while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = (i - r - 1) / 26; }
  return s;
}

// Style indices used below, matching the cellXfs order in STYLES_XML.
var S = {
  base: 0, head: 1, title: 2, section: 3, cell: 4, band: 5,
  example: 6, wrap: 7, muted: 8, label: 9, headLeft: 10
};

var STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="6">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="16"/><color rgb="FF1B1D22"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="12"/><color rgb="FF2247D6"/><name val="Calibri"/></font>' +
    '<font><sz val="10"/><color rgb="FF6B7480"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  "</fonts>" +
  // Excel requires fill 0 to be none and fill 1 to be gray125.
  '<fills count="5">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF2247D6"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF4F2EC"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF6DC"/><bgColor indexed="64"/></patternFill></fill>' +
  "</fills>" +
  '<borders count="2">' +
    "<border><left/><right/><top/><bottom/><diagonal/></border>" +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD8D3C6"/></bottom><diagonal/></border>' +
  "</borders>" +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="11">' +
    '<xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
    '<xf xfId="0" numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf xfId="0" numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1"/>' +
    '<xf xfId="0" numFmtId="0" fontId="3" fillId="0" borderId="0" applyFont="1"/>' +
    '<xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf xfId="0" numFmtId="0" fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf xfId="0" numFmtId="0" fontId="0" fillId="4" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
    '<xf xfId="0" numFmtId="0" fontId="4" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
    '<xf xfId="0" numFmtId="0" fontId="5" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf xfId="0" numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

// A cell is a plain string, or { v, s, n } where s is a style index and n
// marks it numeric so Excel treats it as a number rather than flagging it.
function cellXml(ref, cell) {
  var v = cell, style = null, numeric = false;
  if (cell && typeof cell === "object") { v = cell.v; style = cell.s; numeric = !!cell.n; }
  var attrs = ' r="' + ref + '"' + (style ? ' s="' + style + '"' : "");
  if (v === "" || v == null) return style ? "<c" + attrs + "/>" : "";
  if (numeric) return "<c" + attrs + "><v>" + v + "</v></c>";
  return "<c" + attrs + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(v) + "</t></is></c>";
}

function sheetXml(rows, widths, opts) {
  opts = opts || {};
  var cols = widths
    ? "<cols>" + widths.map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join("") + "</cols>"
    : "";
  // Freezing the header keeps it visible while a coach scrolls down a block.
  var views = opts.freeze
    ? '<sheetViews><sheetView workbookViewId="0" showGridLines="' + (opts.gridLines === false ? "0" : "1") + '">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0" showGridLines="' + (opts.gridLines === false ? "0" : "1") + '"/></sheetViews>';
  var body = rows.map(function (cells, r) {
    var tds = cells.map(function (c, i) { return cellXml(colName(i) + (r + 1), c); }).join("");
    var ht = opts.heights && opts.heights[r]
      ? ' ht="' + opts.heights[r] + '" customHeight="1"' : "";
    return '<row r="' + (r + 1) + '"' + ht + ">" + tds + "</row>";
  }).join("");
  var filter = opts.autoFilter ? '<autoFilter ref="' + opts.autoFilter + '"/>' : "";
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    views + cols + "<sheetData>" + body + "</sheetData>" + filter + "</worksheet>";
}

var TEMPLATE_HEADERS = ["Week", "Day", "Exercise", "Sets", "Reps", "Zone", "Load",
                        "Target velocity", "Velocity loss", "Tempo", "Notes"];

// Week, Day, Exercise, Sets, Reps, Zone, Load, Target velocity, Velocity loss, Tempo, Notes
var TEMPLATE_EXAMPLES = [
  [1, "Day 1", "Back Squat",  5, "3",    "Strength-speed",        "",      "",          "",  "31X1", "example — the zone sets the speed; V-Lo suggests the weight"],
  [1, "Day 1", "Bench Press", 4, "5",    "Accelerative strength", "",      "",          20,  "",     "example — stops on velocity loss"],
  [1, "Day 1", "Deadlift",    3, "2",    "",                      "",      "0.45-0.55", "",  "",     "example — an exact speed range instead of a zone"],
  [1, "Day 2", "Pause Squat", 3, "2",    "Accelerative strength", "",      "",          "",  "33X0", "example — three seconds in the hole"],
  [1, "Day 2", "Barbell Row", 4, "8-10", "",                      "70kg",  "",          "",  "",     "example — not a Movesense lift: plain load"],
  [2, "Day 1", "Back Squat",  5, "3",    "Accelerative strength", "",      "",          15,  "31X1", "example"],
  [2, "Day 1", "Bench Press", 4, "4",    "Strength-speed",        "",      "",          "",  "",     "example"],
  [2, "Day 2", "Deadlift",    3, "2",    "Absolute strength",     "",      "",          "",  "",     "example"]
];

var BLANK_ROWS = 60;

function programmeSheet() {
  var rows = [];
  rows.push(TEMPLATE_HEADERS.map(function (h) { return { v: h, s: S.head }; }));

  TEMPLATE_EXAMPLES.forEach(function (r) {
    rows.push(r.map(function (v, i) {
      var numeric = (i === 0 || i === 3 || i === 8) && typeof v === "number";
      return { v: v, s: S.example, n: numeric };
    }));
  });

  // Pre-formatted empty rows so the sheet reads as a form to fill in, with
  // light banding every other row to keep the eye on one line.
  for (var i = 0; i < BLANK_ROWS; i++) {
    var style = i % 2 ? S.band : S.cell;
    rows.push(TEMPLATE_HEADERS.map(function () { return { v: "", s: style }; }));
  }
  return sheetXml(rows, [7, 11, 28, 7, 11, 22, 11, 15, 13, 9, 40], {
    freeze: true,
    autoFilter: "A1:K1",
    heights: [22]
  });
}

function helpSheet() {
  var T = function (v) { return { v: v, s: S.title }; };
  var H = function (v) { return { v: v, s: S.section }; };
  var K = function (v) { return { v: v, s: S.head }; };
  var W = function (v) { return { v: v, s: S.wrap }; };
  var M = function (v) { return { v: v, s: S.muted }; };
  var L = function (v) { return { v: v, s: S.label }; };

  var rows = [
    [T("How to fill in the programme")],
    [M("Only Exercise is required. Leave any other column blank and it simply isn't prescribed.")],
    [],
    [K("Column"), K("What to write"), K("Example")],
    [L("Week"), W("A number, or any label you like."), W("1")],
    [L("Day"), W("A number or a name. Both work."), W("Day 1   ·   Monday   ·   Heavy")],
    [L("Exercise"), W("Free text. Squat, bench and deadlift are matched to the sensors automatically, including variants like Pause Squat."), W("Back Squat")],
    [L("Sets"), W("A number."), W("5")],
    [L("Reps"), W("A number, a range, or a descending ladder."), W("3   ·   8-10   ·   12-10-8-6")],
    [L("Zone"), W("The speed zone for squat, bench and deadlift. V-Lo suggests the weight that moves in this zone for that lifter."), W("Starting strength · Speed-strength · Strength-speed · Accelerative strength · Absolute strength")],
    [L("Load"), W("Kilos, a percentage of the lifter's one-rep max, or an RPE. For Movesense lifts, prefer a Zone."), W("140kg   ·   85%   ·   RPE8")],
    [L("Target velocity"), W("Bar speed in metres per second. A single value or a range."), W("0.45-0.55")],
    [L("Velocity loss"), W("The percentage drop at which the set stops."), W("20")],
    [L("Tempo"), W("Four characters: lowering, pause at the bottom, lifting, pause at the top. X means explosive."), W("31X1 is three seconds down, one second held, explosive up, one second at the top.")],
    [L("Notes"), W("Anything else. It is shown to the lifter as written."), W("belt from set 3")],
    [],
    [H("Programming to velocity")],
    [W("Zone, Target velocity and Velocity loss are the columns that make this a velocity-based programme rather than a schedule. Give every squat, bench and deadlift a Zone.")],
    [W("Set a Target velocity and leave Load empty. V-Lo works the kilos out from that lifter's own load–velocity profile, so the weight follows their form on the day instead of a number written weeks ago.")],
    [W("Fill in both and V-Lo checks them against each other, and warns you when a load will not produce the bar speed you asked for.")],
    [W("Velocity loss ends a set on what the bar actually did rather than on a rep count. Roughly 10–15% for strength and speed work, 20–25% for hypertrophy. The lifter stops when the drop is reached, however many reps that takes.")],
    [],
    [H("What bar speed means")],
    [K("Bar speed"), K("Zone"), K("What it trains")],
    [L("above 1.30 m/s"), W("Starting strength"), W("Bodyweight / very light. Jumps and throws from a dead stop.")],
    [L("1.00 – 1.30 m/s"), W("Speed-strength"), W("About 20–40% of 1RM. Speed first, strength second.")],
    [L("0.75 – 1.00 m/s"), W("Strength-speed"), W("About 40–60% of 1RM. Moderately heavy, as fast as possible.")],
    [L("0.50 – 0.75 m/s"), W("Accelerative strength"), W("About 65–80% of 1RM. Heavy loads driven fast.")],
    [L("below 0.50 m/s"), W("Absolute strength"), W("About 80–100% of 1RM. Heavy triples, doubles and singles.")],
    [M("Write the zone after the exercise, e.g. Back squat 5x3 strength-speed, or medium for anywhere between 0.50 and 1.30 m/s. The same limits apply to every lift.")],
    [],
    [H("You don't have to use this layout")],
    [W("V-Lo also reads weeks across the top with exercises down the side, one sheet per week, a Word table, a CSV, or a plain text list. Anything it can't read is listed back to you rather than dropped silently.")]
  ];

  return sheetXml(rows, [19, 52, 44], {
    gridLines: false,
    heights: { 0: 24, 2: 8, 14: 8, 15: 22, 21: 8, 22: 22, 30: 8, 31: 22 }
  });
}

// Keys here are what the importer looks for. Order is the order a coach
// thinks in: what block, why, how long, how often, how much time per session.
var BLOCK_FIELDS = [
  ["Block name", "Spring strength block", "Anything you'd call it."],
  ["Block type", "Strength", "Hypertrophy · Strength · Peaking · Off-season · In-season · Return to play"],
  ["Working on", "Squat and pull strength", "What this block is actually for."],
  ["End goal", "Open meet on 14 March", "The thing the block is pointing at. A date helps."],
  ["Weeks", 6, "How many weeks the block runs."],
  ["Sessions per week", 4, "How often the athlete trains."],
  ["Session length", "75 min", "How long they can realistically manage."],
  ["Athlete", "", "Who it's for."],
  ["Notes", "", "Injuries, equipment, anything else that shapes it."]
];

function blockSheet() {
  var rows = [
    [{ v: "The block", s: S.title }],
    [{ v: "Context for the whole programme. V-Lo reads this and uses it to sanity-check the work against the goal.", s: S.muted }],
    [],
    [{ v: "Field", s: S.head }, { v: "Value", s: S.head }, { v: "What it's for", s: S.head }]
  ];
  BLOCK_FIELDS.forEach(function (f) {
    rows.push([
      { v: f[0], s: S.label },
      { v: f[1], s: S.example, n: typeof f[1] === "number" },
      { v: f[2], s: S.muted }
    ]);
  });
  rows.push([]);
  rows.push([{ v: "Leave the Value column filled in or clear it — nothing here is required, but the more you give, the more V-Lo can check the programme makes sense for the goal.", s: S.muted }]);
  return sheetXml(rows, [19, 30, 52], { gridLines: false, heights: { 0: 24, 2: 8 } });
}

function buildTemplateXlsx() {
  var REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return zipStored([
    { name: "[Content_Types].xml", text:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      "</Types>" },
    { name: "_rels/.rels", text:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>" },
    { name: "xl/workbook.xml", text:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + REL + '">' +
      '<sheets><sheet name="The block" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Programme" sheetId="2" r:id="rId2"/>' +
      '<sheet name="How to fill it in" sheetId="3" r:id="rId3"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", text:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + REL + '/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="' + REL + '/worksheet" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Type="' + REL + '/worksheet" Target="worksheets/sheet3.xml"/>' +
      '<Relationship Id="rId4" Type="' + REL + '/styles" Target="styles.xml"/>' +
      "</Relationships>" },
    { name: "xl/styles.xml", text: STYLES_XML },
    { name: "xl/worksheets/sheet1.xml", text: blockSheet() },
    { name: "xl/worksheets/sheet2.xml", text: programmeSheet() },
    { name: "xl/worksheets/sheet3.xml", text: helpSheet() }
  ]);
}
/* ---------------- training plans: render ---------------- */

function prescribedKg(item) {
  if (!item.load) return null;
  if (item.load.kind === "kg") return item.load.value;
  if (item.load.kind === "pct" && item.lift) {
    return Math.round(EXERCISES[item.lift.key].oneRM * item.load.value / 100 * 2) / 2;
  }
  return null;
}

// Inverse of the load–velocity profile V(%1RM) = a - b * (%1RM/100).
// Given a target bar speed, what load should be on the bar today.
function loadForVelocity(ex, v) {
  var pct = ((ex.a - v) / ex.b) * 100;
  if (!isFinite(pct) || pct < 30 || pct > 105) return null;
  return { pct: pct, kg: Math.round((ex.oneRM * pct / 100) * 2) / 2 };
}

function loadText(item) {
  if (!item.load) return "";
  if (item.load.kind === "kg") return item.load.value + " kg";
  if (item.load.kind === "rpe") return "RPE " + item.load.value;
  var kg = prescribedKg(item);
  return item.load.value + "%" + (kg ? " (≈" + kg + " kg)" : "");
}

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ---------------- zones in the plan builder ---------------- */
// Every Movesense lift (squat, bench, deadlift and their variants) should carry
// a speed zone, so the athlete knows what to aim for and gets weight
// suggestions. The builder warns when one is missing and offers a picker that
// writes the zone into the plan text.

// Any zone already written on a line (so the picker can replace it): the
// zone names anywhere, single words when marked ("zone: medium", "@power")
// or last on the line. Same rules as the plan reader (parseExerciseLine).
var ZONE_PATTERN = /(?:^|\s)(?:zone\s*:?\s*|@\s*)?(?:starting\s+strength(?:\s*\/\s*speed)?|absolute\s+strength|speed[\s\-–]*strength|strength[\s\-–]*speed|accelerative(?:\s+strength)?|max(?:imal)?\s+strength)(?=[\s,;]|$)|(?:^|\s)(?:zone\s*:?\s*|@\s*)(?:power|speed|absolute|accelerative|explosiv(?:e|ity)|traditional|fast|medium|slow)(?=[\s,;]|$)|\s(?:power|speed|absolute|accelerative|explosiv(?:e|ity)|traditional|fast|medium|slow)(?:\s+zone)?\s*$/i;
// What the picker writes into the plan for a zone key: its name, e.g. "strength-speed".
function zoneWord(key) { return zoneLabel(key).toLowerCase(); }

// A Movesense lift with neither a zone nor an exact speed range.
function missingZone(item) { return !!item.lift && !item.zone && !item.velocity; }

function countMissingZones(plan) {
  var n = 0;
  (plan.weeks || []).forEach(function (w) { w.days.forEach(function (d) { d.items.forEach(function (it) { if (missingZone(it)) n++; }); }); });
  return n;
}

// Writes `zone` into the plan line this item was read from (its _occ-th
// occurrence), replacing any zone already there, then re-reads the plan.
function setItemZone(item, zone) {
  var textEl = document.getElementById("planText");
  var lines = textEl.value.split("\n");
  var seen = -1;
  for (var i = 0; i < lines.length; i++) {
    var body = lines[i].trim().replace(/^\s*[-*•]\s+/, "");
    if (lines[i].trim() !== item.raw.trim() && body !== item.raw.trim()) continue;
    if (++seen !== (item._occ || 0)) continue;
    var line = lines[i].replace(ZONE_PATTERN, "").replace(/\s+$/, "");
    var note = line.indexOf("//");
    lines[i] = note === -1
      ? line + " " + zoneWord(zone)
      : line.slice(0, note).replace(/\s+$/, "") + " " + zoneWord(zone) + " " + line.slice(note);
    break;
  }
  textEl.value = lines.join("\n");
  runPlanParse(true);
  var status = document.getElementById("planStatus");
  if (typeof openPlanId !== "undefined" && openPlanId) {
    status.textContent = "Zone set. Press “Save changes to team plan” to update it for your athletes.";
  }
}

function zonePicker(item) {
  var box = el("div", "zone-picker");
  box.appendChild(el("span", "zone-picker-label", item.zone ? "Zone" : "Pick a zone"));
  // The five zones (SPEED_ZONES in core.js); the plan stores the zone key.
  SPEED_ZONES.forEach(function (z, i) {
    var b = el("button", "zone-choice zone-" + (i + 1), z.label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(item.zone === z.key));
    b.title = (function () {
      var r = zoneRange(EXERCISES[item.lift.key], z.key);
      return r ? "Average set speed " + r.lo.toFixed(2) + "–" + r.hi.toFixed(2) + " m/s" : z.label;
    })();
    b.addEventListener("click", function () { setItemZone(item, z.key); });
    box.appendChild(b);
  });
  return box;
}

function renderPlanItem(item) {
  var wrap = el("div", "plan-item");
  var top = el("div", "plan-item-top");

  if (item.lift) {
    var btn = el("button", "plan-item-name", item.name);
    btn.type = "button";
    btn.title = "Open the " + EXERCISES[item.lift.key].name + " sensor view";
    btn.addEventListener("click", function () { renderExercise(item.lift.key); window.scrollTo(0, 0); });
    top.appendChild(btn);
    var tag = el("span", "plan-tag sensor", item.lift.variant ? EXERCISES[item.lift.key].name : "sensor");
    top.appendChild(tag);
  } else {
    top.appendChild(el("span", "plan-item-name", item.name));
  }

  if (item.tempo) top.appendChild(el("span", "plan-tag tempo", "tempo"));
  if (item.velocity || item.velocityLoss != null) top.appendChild(el("span", "plan-tag vbt", "VBT"));

  var bits = [];
  if (item.sets) {
    var reps = item.repsText || (item.reps == null ? "" : String(item.reps));
    bits.push(item.duration != null && item.sets === 1 ? reps : reps ? item.sets + " × " + reps : item.sets + " sets");
  }
  var lt = loadText(item);
  if (lt) bits.push(lt);
  if (bits.length) top.appendChild(el("span", "plan-item-prescription", bits.join("  ·  ")));
  wrap.appendChild(top);

  if (item.tempo) {
    wrap.appendChild(el("p", "plan-item-tempo",
      describeTempo(item.tempo, item.lift && item.lift.key)));
  }

  // A prescribed load on a sensor-tracked lift has an expected bar speed,
  // straight off the same load–velocity profile the live charts use.
  if (item.velocity) {
    var band = item.velocity.max
      ? item.velocity.min.toFixed(2) + "–" + item.velocity.max.toFixed(2)
      : item.velocity.min.toFixed(2);
    var line = "Prescribed velocity " + band + " m/s";
    if (item.lift) {
      var zex = EXERCISES[item.lift.key];
      line += " · " + zoneLabel(zoneFor(zex, item.velocity.max || item.velocity.min));
    }
    wrap.appendChild(el("p", "plan-item-vbt", line));
  }
  if (item.zone) {
    var zr = item.lift ? zoneRange(EXERCISES[item.lift.key], item.zone) : null;
    wrap.appendChild(el("p", "plan-item-vbt", "Zone: " + zoneLabel(item.zone) +
      (zr ? " · aim " + zr.lo.toFixed(2) + "–" + zr.hi.toFixed(2) + " m/s average; the weight is suggested from the athlete's own sets" : "")));
  }
  if (missingZone(item)) {
    wrap.appendChild(el("p", "plan-item-warn zone-missing", "⚠ No zone: the athlete gets no speed target or weight suggestions for this lift."));
  }
  if (item.lift) wrap.appendChild(zonePicker(item));
  if (item.velocityLoss != null) {
    wrap.appendChild(el("p", "plan-item-vbt",
      "Stop the set at " + item.velocityLoss + "% velocity loss"));
  }

  var kg = prescribedKg(item);
  if (item.lift && kg) {
    var ex = EXERCISES[item.lift.key];
    var sim = simulateSet(kg, ex);
    wrap.appendChild(el("p", "plan-item-tempo",
      "Target first-rep speed ≈ " + sim.v1.toFixed(2) + " m/s · " + zoneLabel(zoneFor(ex, sim.v1)) +
      " · " + Math.round(sim.pct) + "% of est. 1RM"));

    // A coach can prescribe both a load and a velocity. When the load's own
    // predicted speed falls outside the prescribed band they disagree, and
    // the lifter needs to know which one to follow today.
    if (item.velocity) {
      var lo = item.velocity.min;
      var hi = item.velocity.max || item.velocity.min;
      if (sim.v1 < lo - 0.02 || sim.v1 > hi + 0.02) {
        var dir = sim.v1 < lo ? "slower" : "faster";
        wrap.appendChild(el("p", "plan-item-warn",
          "That load is " + dir + " than the prescribed band — expect " +
          sim.v1.toFixed(2) + " m/s, not " + lo.toFixed(2) +
          (item.velocity.max ? "–" + hi.toFixed(2) : "") + " m/s."));
      }
    }
  } else if (item.lift && item.velocity) {
    // Velocity prescribed with no load: read the load back off the lifter's
    // own load–velocity profile. This is the point of velocity-based training.
    var vex = EXERCISES[item.lift.key];
    var suggested = loadForVelocity(vex, item.velocity.max || item.velocity.min);
    if (suggested) {
      wrap.appendChild(el("p", "plan-item-tempo",
        "≈ " + suggested.kg + " kg today (" + Math.round(suggested.pct) +
        "% of est. 1RM) to hit that speed"));
    }
  }

  if (item.note) wrap.appendChild(el("p", "plan-item-note", item.note));
  return wrap;
}

// What a block of each type should mostly consist of, by velocity zone (keys).
var BLOCK_EXPECTATION = {
  hypertrophy: ["strength_speed", "accelerative_strength"],
  strength: ["accelerative_strength", "absolute_strength"],
  peaking: ["absolute_strength", "accelerative_strength"],
  power: ["speed_strength", "strength_speed"],
  speed: ["starting_strength", "speed_strength"],
  "off season": ["strength_speed", "accelerative_strength"],
  "in season": ["speed_strength", "strength_speed"]
};

var BLOCK_ORDER = ["block name", "block type", "working on", "end goal",
                   "weeks", "sessions per week", "session length", "athlete", "notes"];

// The zone a prescribed item lands in — from the coach's own velocity target
// where there is one, otherwise from the load.
function itemZone(item) {
  if (item.zone) return zoneKey(item.zone);
  if (!item.lift) return null;
  var ex = EXERCISES[item.lift.key];
  if (item.velocity) return zoneFor(ex, item.velocity.max || item.velocity.min);
  var kg = prescribedKg(item);
  return kg ? zoneFor(ex, simulateSet(kg, ex).v1) : null;
}

function renderBlock(plan, zoneCounts) {
  var host = document.getElementById("planBlock");
  host.textContent = "";
  var keys = BLOCK_ORDER.filter(function (k) { return plan.meta[k]; });
  if (!keys.length) { host.hidden = true; return; }
  host.hidden = false;

  var grid = el("div", "block-grid");
  keys.forEach(function (k) {
    var cell = el("div", "block-field");
    cell.appendChild(el("p", "block-key", k));
    cell.appendChild(el("p", "block-value", plan.meta[k]));
    grid.appendChild(cell);
  });
  host.appendChild(grid);

  // Does the work actually point at the stated goal?
  var type = fold(plan.meta["block type"] || "");
  var expected = null;
  Object.keys(BLOCK_EXPECTATION).forEach(function (k) {
    if (!expected && type.indexOf(k) >= 0) expected = BLOCK_EXPECTATION[k];
  });
  var zones = Object.keys(zoneCounts);
  if (!expected || !zones.length) return;

  var total = zones.reduce(function (n, z) { return n + zoneCounts[z]; }, 0);
  // A broad "medium" target counts when the block expects one of its zones.
  var onTarget = zones.reduce(function (n, z) {
    var hit = expected.indexOf(z) >= 0 || (z === "medium" && expected.some(function (k) { return zoneGroup(k) === "medium"; }));
    return n + (hit ? zoneCounts[z] : 0);
  }, 0);
  var share = Math.round((onTarget / total) * 100);
  var dominant = zones.sort(function (a, b) { return zoneCounts[b] - zoneCounts[a]; })[0];

  var note = el("p", share >= 60 ? "block-check ok" : "block-check warn");
  note.textContent = share >= 60
    ? share + "% of the measurable work sits in the zones a " + plan.meta["block type"].toLowerCase() +
      " block is built on."
    : "Only " + share + "% of the measurable work is in the zones a " + plan.meta["block type"].toLowerCase() +
      " block is built on — most of it is " + zoneLabel(dominant) + ".";
  host.appendChild(note);
}

function renderPlan(plan) {
  var out = document.getElementById("planOutput");
  var host = document.getElementById("planWeeks");
  host.textContent = "";

  var days = 0, items = 0, tracked = 0, tempos = 0;
  var zoneCounts = {};
  var occurrences = {};
  plan.weeks.forEach(function (w) {
    var wrap = el("div", "plan-week");
    wrap.appendChild(el("p", "plan-week-head", w.label));
    var grid = el("div", "plan-days");
    w.days.forEach(function (d) {
      days++;
      var card = el("div", "plan-day");
      var head = el("div", "plan-day-head");
      head.appendChild(el("span", "plan-day-title", d.label));
      head.appendChild(el("span", "plan-day-count", d.items.length + (d.items.length === 1 ? " lift" : " lifts")));
      card.appendChild(head);
      d.items.forEach(function (it) {
        items++;
        it._occ = occurrences[it.raw] = (occurrences[it.raw] === undefined ? 0 : occurrences[it.raw] + 1);
        if (it.lift) tracked++;
        if (it.tempo) tempos++;
        var z = itemZone(it);
        if (z) zoneCounts[z] = (zoneCounts[z] || 0) + 1;
        card.appendChild(renderPlanItem(it));
      });
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    host.appendChild(wrap);
  });

  var summary = [
    plan.weeks.length + (plan.weeks.length === 1 ? " week" : " weeks"),
    days + (days === 1 ? " day" : " days"),
    items + (items === 1 ? " exercise" : " exercises"),
    tracked + " sensor-tracked"
  ];
  if (tempos) summary.push(tempos + " with tempo");
  var noZone = countMissingZones(plan);
  if (noZone) summary.push("⚠ " + noZone + " without a zone");
  document.getElementById("planSummary").textContent = summary.join(" · ");
  renderBlock(plan, zoneCounts);

  var unWrap = document.getElementById("planUnparsed");
  var unList = document.getElementById("planUnparsedList");
  unList.textContent = "";
  var SHOW = 12;
  plan.unparsed.slice(0, SHOW).forEach(function (u) {
    var li = document.createElement("li");
    li.appendChild(el("span", "mono", u.line));
    li.appendChild(el("span", "why", " — " + u.reason));
    unList.appendChild(li);
  });
  if (plan.unparsed.length > SHOW) {
    var more = document.createElement("li");
    more.appendChild(el("span", "why", "…and " + (plan.unparsed.length - SHOW) + " more lines"));
    unList.appendChild(more);
  }
  unWrap.hidden = plan.unparsed.length === 0;

  out.hidden = items === 0 && plan.unparsed.length === 0;

  var status = document.getElementById("planStatus");
  if (!items && !plan.unparsed.length) status.textContent = "No plan loaded.";
  else if (!items) status.textContent = "Nothing readable found — check the format notes above.";
  else status.textContent = "Read " + items + " exercises" +
    (plan.unparsed.length ? ", skipped " + plan.unparsed.length + " line(s)." : ".");
}

// The plan as last read from the text box, for saving it to the team (coachplans.js).
var currentPlan = null;

function runPlanParse(save) {
  var text = document.getElementById("planText").value;
  var plan = parsePlan(text);
  currentPlan = plan;
  var nameInput = document.getElementById("planName");
  if (plan.title && !nameInput.value.trim()) nameInput.value = plan.title;
  renderPlan(plan);
  if (save) {
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify({ name: nameInput.value, text: text }));
    } catch (e) { /* private mode or quota — the plan just doesn't persist */ }
  }
}

var PLAN_SAMPLE = [
  "# Peaking block",
  "",
  "Week 1",
  "Day 1 — Heavy squat",
  "Back Squat 5x3 @140kg @31X1",
  "Pause Squat 3x2 @120kg @33X0 // three full seconds in the hole",
  "Bench Press 4x5 @85kg",
  "",
  "Day 2 — Pull",
  "Deadlift 3x2 @85% // belt on",
  "Romanian Deadlift 3x8 @100kg",
  "Barbell Row 4x8 @70kg",
  "",
  "Week 2",
  "Day 1 — Heavy squat",
  "Back Squat 5x3 @145kg @31X1",
  "Bench Press 4x4 @87.5kg @RPE8",
  "Chin-ups 4x8"
].join("\n");

(function initPlans() {
  var textEl = document.getElementById("planText");
  var dropEl = document.getElementById("planDrop");
  var fileEl = document.getElementById("planFile");

  document.getElementById("planParseBtn").addEventListener("click", function () { runPlanParse(true); });

  document.getElementById("planTemplateBtn").addEventListener("click", function () {
    var url = URL.createObjectURL(buildTemplateXlsx());
    var a = document.createElement("a");
    a.href = url;
    a.download = "V-Lo programme template.xlsx";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  document.getElementById("planSampleBtn").addEventListener("click", function () {
    textEl.value = PLAN_SAMPLE;
    document.getElementById("planName").value = "";
    runPlanParse(true);
  });

  document.getElementById("planClearBtn").addEventListener("click", function () {
    textEl.value = "";
    document.getElementById("planName").value = "";
    try { localStorage.removeItem(PLAN_KEY); } catch (e) { /* nothing to clear */ }
    if (typeof closeTeamPlan === "function") closeTeamPlan();
    runPlanParse(false);
  });

  var debounce;
  textEl.addEventListener("input", function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () { runPlanParse(true); }, 400);
  });
  document.getElementById("planName").addEventListener("change", function () { runPlanParse(true); });

  function readFile(file) {
    if (!file) return;
    var status = document.getElementById("planStatus");
    var ext = (file.name.split(".").pop() || "").toLowerCase();

    function apply(text) {
      textEl.value = text;
      var base = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
      if (base) document.getElementById("planName").value = base;
      runPlanParse(true);
    }

    if (ext === "doc" || ext === "xls") {
      status.textContent = "That's the older binary Word/Excel format. Save it as .docx or .xlsx and drop it again.";
      return;
    }

    if (ext === "docx" || ext === "xlsx" || ext === "xlsm") {
      status.textContent = "Reading " + file.name + "…";
      file.arrayBuffer().then(function (buf) {
        var zip = readZip(buf);
        return ext === "docx" ? docxToLines(zip) : xlsxToLines(zip);
      }).then(function (lines) {
        var text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
        if (!text) {
          status.textContent = ext === "docx"
            ? "No text found in that document — is the plan inside a table or an image?"
            : "No cells with content found in that workbook.";
          return;
        }
        apply(text);
      }).catch(function (err) {
        status.textContent = "Couldn't read that file: " + ((err && err.message) || err);
      });
      return;
    }

    var reader = new FileReader();
    reader.onload = function () { apply(String(reader.result)); };
    reader.readAsText(file);
  }

  dropEl.addEventListener("click", function () { fileEl.click(); });
  dropEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileEl.click(); }
  });
  fileEl.addEventListener("change", function () { readFile(fileEl.files[0]); fileEl.value = ""; });

  ["dragenter", "dragover"].forEach(function (evt) {
    dropEl.addEventListener(evt, function (e) { e.preventDefault(); dropEl.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (evt) {
    dropEl.addEventListener(evt, function (e) { e.preventDefault(); dropEl.classList.remove("is-over"); });
  });
  dropEl.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]);
  });

  try {
    var saved = JSON.parse(localStorage.getItem(PLAN_KEY) || "null");
    if (saved && saved.text) {
      textEl.value = saved.text;
      if (saved.name) document.getElementById("planName").value = saved.name;
      runPlanParse(false);
    }
  } catch (e) { /* nothing saved, or unreadable — start empty */ }
})();
