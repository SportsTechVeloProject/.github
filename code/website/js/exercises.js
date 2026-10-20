/* exercises.js — the exercise bank: every exercise V-Lo knows, how it's logged,
   and whether the Movesense sensors can record it.
   Part of V-Lo. Loaded as a plain script, early; see vlo.html for the order.

   To add an exercise, add a line to EXERCISE_BANK. Fields:
     key        stable id, stored in the database (sessions.exercise). Never rename.
     name       shown in the app
     aka        other names a coach or athlete might write (any language); matched
                ignoring case and accents
     log        what's filled in per set; see LOG_TYPES
     sensor     "squat" | "bench" | "deadlift": recorded and analyzed with that
                lift's analysis and speed zones (python/main.py ANALYSIS)
                "barbell": recordable, analysis not written yet
                omitted: not recorded with the sensors
     cat, equip, muscles: for browsing and searching

   Exercises a plan names that aren't in the bank still work: they're logged
   as weight × reps (or as time when the plan gave a duration). */
"use strict";

// The fields a set has, per kind of exercise. Each exercise shows only its own.
var LOG_TYPES = {
  weight_reps:         { fields: ["weight", "reps"],       label: "Weight × reps" },
  bodyweight_reps:     { fields: ["reps"],                 label: "Reps" },
  weighted_bodyweight: { fields: ["added", "reps"],        label: "Reps, optional added weight" },
  duration:            { fields: ["time"],                 label: "Time" },
  weight_duration:     { fields: ["weight", "time"],       label: "Weight × time" },
  distance_duration:   { fields: ["time", "distance"],     label: "Time and distance" }
};

var EXERCISE_BANK = [
  // ---- squat (recorded, analyzed with the squat analysis) ----
  { key: "back_squat", name: "Back squat", aka: ["squat", "squats", "competition squat", "comp squat", "sq", "hnébeygja", "hnébeygju", "hnébeygjur", "knäböj"], log: "weight_reps", sensor: "squat", cat: "Squat", equip: "barbell", muscles: ["quads", "glutes", "adductors"] },
  { key: "high_bar_squat", name: "High-bar squat", aka: ["high bar squat", "hbbs"], log: "weight_reps", sensor: "squat", cat: "Squat", equip: "barbell", muscles: ["quads", "glutes"] },
  { key: "low_bar_squat", name: "Low-bar squat", aka: ["low bar squat", "lbbs"], log: "weight_reps", sensor: "squat", cat: "Squat", equip: "barbell", muscles: ["glutes", "quads", "hamstrings"] },
  { key: "pause_squat", name: "Pause squat", aka: ["paused squat", "pause squats", "pausuhnébeygja"], log: "weight_reps", sensor: "squat", cat: "Squat", equip: "barbell", muscles: ["quads", "glutes"] },
  { key: "tempo_squat", name: "Tempo squat", aka: ["tempo squats"], log: "weight_reps", sensor: "squat", cat: "Squat", equip: "barbell", muscles: ["quads", "glutes"] },
  { key: "box_squat", name: "Box squat", aka: ["box squats"], log: "weight_reps", sensor: "squat", cat: "Squat", equip: "barbell", muscles: ["glutes", "quads", "hamstrings"] },
  { key: "pin_squat", name: "Pin squat", aka: ["pin squats", "anderson squat"], log: "weight_reps", sensor: "squat", cat: "Squat", equip: "barbell", muscles: ["quads", "glutes"] },
  { key: "front_squat", name: "Front squat", aka: ["front squats", "framhnébeygja", "frontböj"], log: "weight_reps", sensor: "squat", cat: "Squat", equip: "barbell", muscles: ["quads", "upper back"] },
  { key: "safety_bar_squat", name: "Safety bar squat", aka: ["ssb squat", "ssb"], log: "weight_reps", sensor: "squat", cat: "Squat", equip: "barbell", muscles: ["quads", "upper back"] },

  // ---- bench (recorded, analyzed with the bench analysis once it exists) ----
  { key: "bench_press", name: "Bench press", aka: ["bench", "bp", "competition bench", "comp bench", "flat bench", "bekkpressa", "bekkpressu", "bänkpress", "bankpress"], log: "weight_reps", sensor: "bench", cat: "Bench", equip: "barbell", muscles: ["chest", "triceps", "front delts"] },
  { key: "pause_bench", name: "Pause bench press", aka: ["paused bench", "pause bench", "competition pause bench"], log: "weight_reps", sensor: "bench", cat: "Bench", equip: "barbell", muscles: ["chest", "triceps"] },
  { key: "close_grip_bench", name: "Close-grip bench press", aka: ["close grip bench", "cgbp", "close grip bench press"], log: "weight_reps", sensor: "bench", cat: "Bench", equip: "barbell", muscles: ["triceps", "chest"] },
  { key: "wide_grip_bench", name: "Wide-grip bench press", aka: ["wide grip bench"], log: "weight_reps", sensor: "bench", cat: "Bench", equip: "barbell", muscles: ["chest", "front delts"] },
  { key: "tempo_bench", name: "Tempo bench press", aka: ["tempo bench"], log: "weight_reps", sensor: "bench", cat: "Bench", equip: "barbell", muscles: ["chest", "triceps"] },
  { key: "spoto_press", name: "Spoto press", aka: ["spoto"], log: "weight_reps", sensor: "bench", cat: "Bench", equip: "barbell", muscles: ["chest", "triceps"] },
  { key: "larsen_press", name: "Larsen press", aka: ["larsen"], log: "weight_reps", sensor: "bench", cat: "Bench", equip: "barbell", muscles: ["chest", "triceps"] },
  { key: "board_press", name: "Board press", aka: ["2 board press", "board bench"], log: "weight_reps", sensor: "bench", cat: "Bench", equip: "barbell", muscles: ["triceps", "chest"] },
  { key: "pin_press", name: "Pin press", aka: ["bench pin press"], log: "weight_reps", sensor: "bench", cat: "Bench", equip: "barbell", muscles: ["triceps", "chest"] },
  { key: "floor_press", name: "Floor press", aka: [], log: "weight_reps", sensor: "bench", cat: "Bench", equip: "barbell", muscles: ["triceps", "chest"] },

  // ---- deadlift (recorded, analyzed with the deadlift analysis once it exists) ----
  { key: "deadlift", name: "Deadlift", aka: ["conventional deadlift", "competition deadlift", "comp deadlift", "dl", "réttstöðulyfta", "réttstöðulyftu", "marklyft"], log: "weight_reps", sensor: "deadlift", cat: "Deadlift", equip: "barbell", muscles: ["hamstrings", "glutes", "back"] },
  { key: "sumo_deadlift", name: "Sumo deadlift", aka: ["sumo", "sumo dl"], log: "weight_reps", sensor: "deadlift", cat: "Deadlift", equip: "barbell", muscles: ["glutes", "adductors", "quads"] },
  { key: "pause_deadlift", name: "Pause deadlift", aka: ["paused deadlift"], log: "weight_reps", sensor: "deadlift", cat: "Deadlift", equip: "barbell", muscles: ["hamstrings", "back"] },
  { key: "deficit_deadlift", name: "Deficit deadlift", aka: ["deficit pull", "deficit dl"], log: "weight_reps", sensor: "deadlift", cat: "Deadlift", equip: "barbell", muscles: ["hamstrings", "quads", "back"] },
  { key: "block_pull", name: "Block pull", aka: ["block pulls", "rack pull", "rack pulls"], log: "weight_reps", sensor: "deadlift", cat: "Deadlift", equip: "barbell", muscles: ["back", "glutes"] },

  // ---- other barbell lifts (recordable; analysis to come) ----
  { key: "overhead_press", name: "Overhead press", aka: ["ohp", "military press", "strict press", "militärpress"], log: "weight_reps", sensor: "barbell", cat: "Upper body", equip: "barbell", muscles: ["shoulders", "triceps"] },
  { key: "push_press", name: "Push press", aka: [], log: "weight_reps", sensor: "barbell", cat: "Upper body", equip: "barbell", muscles: ["shoulders", "triceps", "legs"] },
  { key: "incline_bench_press", name: "Incline bench press", aka: ["incline bench", "incline press"], log: "weight_reps", sensor: "barbell", cat: "Upper body", equip: "barbell", muscles: ["upper chest", "front delts"] },
  { key: "romanian_deadlift", name: "Romanian deadlift", aka: ["rdl", "rdls", "romanian deadlifts"], log: "weight_reps", sensor: "barbell", cat: "Lower body", equip: "barbell", muscles: ["hamstrings", "glutes"] },
  { key: "stiff_leg_deadlift", name: "Stiff-leg deadlift", aka: ["stiff leg deadlift", "sldl"], log: "weight_reps", sensor: "barbell", cat: "Lower body", equip: "barbell", muscles: ["hamstrings", "lower back"] },
  { key: "good_morning", name: "Good morning", aka: ["good mornings"], log: "weight_reps", sensor: "barbell", cat: "Lower body", equip: "barbell", muscles: ["hamstrings", "lower back"] },
  { key: "hip_thrust", name: "Hip thrust", aka: ["barbell hip thrust", "hip thrusts"], log: "weight_reps", sensor: "barbell", cat: "Lower body", equip: "barbell", muscles: ["glutes"] },
  { key: "barbell_row", name: "Barbell row", aka: ["bent over row", "bent-over row", "bb row", "rodd"], log: "weight_reps", sensor: "barbell", cat: "Back", equip: "barbell", muscles: ["upper back", "lats"] },
  { key: "pendlay_row", name: "Pendlay row", aka: [], log: "weight_reps", sensor: "barbell", cat: "Back", equip: "barbell", muscles: ["upper back", "lats"] },
  { key: "barbell_curl", name: "Barbell curl", aka: ["bb curl"], log: "weight_reps", sensor: "barbell", cat: "Arms", equip: "barbell", muscles: ["biceps"] },
  { key: "power_clean", name: "Power clean", aka: ["clean"], log: "weight_reps", sensor: "barbell", cat: "Olympic", equip: "barbell", muscles: ["full body"] },
  { key: "trap_bar_deadlift", name: "Trap bar deadlift", aka: ["hex bar deadlift", "trap bar"], log: "weight_reps", sensor: "barbell", cat: "Lower body", equip: "trap bar", muscles: ["quads", "glutes", "back"] },

  // ---- lower body accessories ----
  { key: "leg_press", name: "Leg press", aka: [], log: "weight_reps", cat: "Lower body", equip: "machine", muscles: ["quads", "glutes"] },
  { key: "hack_squat", name: "Hack squat", aka: ["machine hack squat"], log: "weight_reps", cat: "Lower body", equip: "machine", muscles: ["quads"] },
  { key: "belt_squat", name: "Belt squat", aka: [], log: "weight_reps", cat: "Lower body", equip: "machine", muscles: ["quads", "glutes"] },
  { key: "goblet_squat", name: "Goblet squat", aka: [], log: "weight_reps", cat: "Lower body", equip: "dumbbell", muscles: ["quads", "glutes"] },
  { key: "bulgarian_split_squat", name: "Bulgarian split squat", aka: ["bss", "rear foot elevated split squat", "split squat"], log: "weight_reps", cat: "Lower body", equip: "dumbbell", muscles: ["quads", "glutes"] },
  { key: "lunge", name: "Lunge", aka: ["lunges", "walking lunge", "walking lunges"], log: "weight_reps", cat: "Lower body", equip: "dumbbell", muscles: ["quads", "glutes"] },
  { key: "step_up", name: "Step-up", aka: ["step up", "step ups"], log: "weight_reps", cat: "Lower body", equip: "dumbbell", muscles: ["quads", "glutes"] },
  { key: "leg_extension", name: "Leg extension", aka: ["leg extensions"], log: "weight_reps", cat: "Lower body", equip: "machine", muscles: ["quads"] },
  { key: "leg_curl", name: "Leg curl", aka: ["leg curls", "lying leg curl", "seated leg curl", "hamstring curl"], log: "weight_reps", cat: "Lower body", equip: "machine", muscles: ["hamstrings"] },
  { key: "back_extension", name: "Back extension", aka: ["back extensions", "hyperextension", "45 degree back extension"], log: "weighted_bodyweight", cat: "Lower body", equip: "bench", muscles: ["lower back", "glutes", "hamstrings"] },
  { key: "glute_ham_raise", name: "Glute-ham raise", aka: ["ghr", "glute ham raise"], log: "weighted_bodyweight", cat: "Lower body", equip: "bench", muscles: ["hamstrings", "glutes"] },
  { key: "nordic_curl", name: "Nordic curl", aka: ["nordic hamstring curl", "nordics"], log: "bodyweight_reps", cat: "Lower body", equip: "none", muscles: ["hamstrings"] },
  { key: "calf_raise", name: "Calf raise", aka: ["calf raises", "standing calf raise"], log: "weight_reps", cat: "Lower body", equip: "machine", muscles: ["calves"] },
  { key: "reverse_hyper", name: "Reverse hyper", aka: ["reverse hyperextension"], log: "weight_reps", cat: "Lower body", equip: "machine", muscles: ["glutes", "lower back"] },

  // ---- upper body accessories ----
  { key: "dumbbell_bench_press", name: "Dumbbell bench press", aka: ["db bench", "dumbbell bench"], log: "weight_reps", cat: "Upper body", equip: "dumbbell", muscles: ["chest", "triceps"] },
  { key: "incline_dumbbell_press", name: "Incline dumbbell press", aka: ["incline db press", "incline dumbbell bench"], log: "weight_reps", cat: "Upper body", equip: "dumbbell", muscles: ["upper chest", "front delts"] },
  { key: "dumbbell_shoulder_press", name: "Dumbbell shoulder press", aka: ["db shoulder press", "seated dumbbell press"], log: "weight_reps", cat: "Upper body", equip: "dumbbell", muscles: ["shoulders", "triceps"] },
  { key: "dip", name: "Dip", aka: ["dips", "weighted dips", "weighted dip"], log: "weighted_bodyweight", cat: "Upper body", equip: "bodyweight", muscles: ["triceps", "chest"] },
  { key: "push_up", name: "Push-up", aka: ["push up", "push ups", "push-ups", "pushups"], log: "bodyweight_reps", cat: "Upper body", equip: "bodyweight", muscles: ["chest", "triceps"] },
  { key: "triceps_pushdown", name: "Triceps pushdown", aka: ["tricep pushdown", "pushdowns", "rope pushdown"], log: "weight_reps", cat: "Arms", equip: "cable", muscles: ["triceps"] },
  { key: "skull_crusher", name: "Skull crusher", aka: ["skull crushers", "lying triceps extension"], log: "weight_reps", cat: "Arms", equip: "ez bar", muscles: ["triceps"] },
  { key: "overhead_triceps_extension", name: "Overhead triceps extension", aka: ["overhead tricep extension"], log: "weight_reps", cat: "Arms", equip: "cable", muscles: ["triceps"] },
  { key: "dumbbell_curl", name: "Dumbbell curl", aka: ["db curl", "biceps curl", "bicep curl", "curls"], log: "weight_reps", cat: "Arms", equip: "dumbbell", muscles: ["biceps"] },
  { key: "hammer_curl", name: "Hammer curl", aka: ["hammer curls"], log: "weight_reps", cat: "Arms", equip: "dumbbell", muscles: ["biceps", "forearms"] },
  { key: "lateral_raise", name: "Lateral raise", aka: ["lateral raises", "side raise", "side raises"], log: "weight_reps", cat: "Upper body", equip: "dumbbell", muscles: ["side delts"] },
  { key: "rear_delt_fly", name: "Rear delt fly", aka: ["reverse fly", "rear delt flyes"], log: "weight_reps", cat: "Upper body", equip: "dumbbell", muscles: ["rear delts"] },
  { key: "face_pull", name: "Face pull", aka: ["face pulls"], log: "weight_reps", cat: "Upper body", equip: "cable", muscles: ["rear delts", "upper back"] },
  { key: "band_pull_apart", name: "Band pull-apart", aka: ["band pull aparts", "band pull-aparts", "pull aparts"], log: "bodyweight_reps", cat: "Upper body", equip: "band", muscles: ["rear delts", "upper back"] },

  // ---- back ----
  { key: "pull_up", name: "Pull-up", aka: ["pull up", "pull ups", "pull-ups", "pullups", "weighted pull up", "weighted pull-up"], log: "weighted_bodyweight", cat: "Back", equip: "bodyweight", muscles: ["lats", "biceps"] },
  { key: "chin_up", name: "Chin-up", aka: ["chin up", "chin ups", "chin-ups", "chinups", "weighted chin up"], log: "weighted_bodyweight", cat: "Back", equip: "bodyweight", muscles: ["lats", "biceps"] },
  { key: "lat_pulldown", name: "Lat pulldown", aka: ["lat pull down", "pulldown", "pulldowns"], log: "weight_reps", cat: "Back", equip: "cable", muscles: ["lats"] },
  { key: "seated_cable_row", name: "Seated cable row", aka: ["cable row", "seated row"], log: "weight_reps", cat: "Back", equip: "cable", muscles: ["upper back", "lats"] },
  { key: "dumbbell_row", name: "Dumbbell row", aka: ["db row", "one arm row", "single arm row"], log: "weight_reps", cat: "Back", equip: "dumbbell", muscles: ["lats", "upper back"] },
  { key: "chest_supported_row", name: "Chest-supported row", aka: ["chest supported row", "seal row", "t-bar row", "t bar row"], log: "weight_reps", cat: "Back", equip: "machine", muscles: ["upper back", "lats"] },
  { key: "inverted_row", name: "Inverted row", aka: ["inverted rows", "body row"], log: "bodyweight_reps", cat: "Back", equip: "bodyweight", muscles: ["upper back"] },
  { key: "shrug", name: "Shrug", aka: ["shrugs", "dumbbell shrug"], log: "weight_reps", cat: "Back", equip: "dumbbell", muscles: ["traps"] },

  // ---- core ----
  { key: "plank", name: "Plank", aka: ["planks", "planki", "plankan"], log: "duration", cat: "Core", equip: "none", muscles: ["core"] },
  { key: "side_plank", name: "Side plank", aka: ["side planks"], log: "duration", cat: "Core", equip: "none", muscles: ["obliques"] },
  { key: "hollow_hold", name: "Hollow hold", aka: ["hollow body hold"], log: "duration", cat: "Core", equip: "none", muscles: ["core"] },
  { key: "ab_wheel", name: "Ab wheel", aka: ["ab wheel rollout", "ab rollout", "rollouts"], log: "bodyweight_reps", cat: "Core", equip: "ab wheel", muscles: ["core"] },
  { key: "hanging_leg_raise", name: "Hanging leg raise", aka: ["hanging leg raises", "leg raises", "hanging knee raise"], log: "bodyweight_reps", cat: "Core", equip: "bodyweight", muscles: ["core", "hip flexors"] },
  { key: "cable_crunch", name: "Cable crunch", aka: ["cable crunches"], log: "weight_reps", cat: "Core", equip: "cable", muscles: ["abs"] },
  { key: "pallof_press", name: "Pallof press", aka: [], log: "weight_reps", cat: "Core", equip: "cable", muscles: ["core", "obliques"] },
  { key: "dead_bug", name: "Dead bug", aka: ["dead bugs"], log: "bodyweight_reps", cat: "Core", equip: "none", muscles: ["core"] },
  { key: "sit_up", name: "Sit-up", aka: ["sit up", "sit ups", "situps", "crunch", "crunches"], log: "bodyweight_reps", cat: "Core", equip: "none", muscles: ["abs"] },

  // ---- carries and sleds ----
  { key: "farmers_carry", name: "Farmer's carry", aka: ["farmers carry", "farmer carry", "farmers walk", "farmer's walk"], log: "weight_duration", cat: "Carries", equip: "dumbbell", muscles: ["grip", "traps", "core"] },
  { key: "suitcase_carry", name: "Suitcase carry", aka: ["suitcase carries"], log: "weight_duration", cat: "Carries", equip: "dumbbell", muscles: ["obliques", "grip"] },
  { key: "sled_push", name: "Sled push", aka: ["prowler", "prowler push", "sled"], log: "weight_duration", cat: "Carries", equip: "sled", muscles: ["legs", "conditioning"] },

  // ---- conditioning ----
  { key: "bike", name: "Bike", aka: ["stationary bike", "exercise bike", "cycling", "bike erg", "hjól", "hjóla", "cykel", "cykling"], log: "distance_duration", cat: "Conditioning", equip: "machine", muscles: ["legs", "cardio"] },
  { key: "assault_bike", name: "Assault bike", aka: ["air bike", "airdyne", "echo bike"], log: "distance_duration", cat: "Conditioning", equip: "machine", muscles: ["full body", "cardio"] },
  { key: "row_erg", name: "Rowing machine", aka: ["row erg", "rower", "rowing", "erg", "concept2"], log: "distance_duration", cat: "Conditioning", equip: "machine", muscles: ["full body", "cardio"] },
  { key: "ski_erg", name: "Ski erg", aka: ["skierg", "ski"], log: "distance_duration", cat: "Conditioning", equip: "machine", muscles: ["full body", "cardio"] },
  { key: "run", name: "Run", aka: ["running", "jog", "jogging", "treadmill", "hlaup", "hlaupa", "löpning", "löpa"], log: "distance_duration", cat: "Conditioning", equip: "none", muscles: ["legs", "cardio"] },
  { key: "walk", name: "Walk", aka: ["walking", "incline walk", "ganga", "promenad"], log: "distance_duration", cat: "Conditioning", equip: "none", muscles: ["cardio"] },
  { key: "swim", name: "Swim", aka: ["swimming", "sund", "simning"], log: "distance_duration", cat: "Conditioning", equip: "none", muscles: ["full body", "cardio"] },
  { key: "jump_rope", name: "Jump rope", aka: ["skipping", "skipping rope"], log: "duration", cat: "Conditioning", equip: "rope", muscles: ["calves", "cardio"] },
  { key: "box_jump", name: "Box jump", aka: ["box jumps"], log: "bodyweight_reps", cat: "Conditioning", equip: "box", muscles: ["legs", "power"] },
  { key: "burpee", name: "Burpee", aka: ["burpees"], log: "bodyweight_reps", cat: "Conditioning", equip: "none", muscles: ["full body", "cardio"] },

  // ---- mobility and recovery ----
  { key: "mobility", name: "Mobility", aka: ["mobility work", "liðleiki", "rörlighet"], log: "duration", cat: "Mobility", equip: "none", muscles: [] },
  { key: "hip_mobility", name: "Hip mobility", aka: ["hip mobility work", "hip opener", "hip openers"], log: "duration", cat: "Mobility", equip: "none", muscles: ["hips"] },
  { key: "thoracic_mobility", name: "Thoracic mobility", aka: ["t-spine mobility", "upper back mobility"], log: "duration", cat: "Mobility", equip: "none", muscles: ["upper back"] },
  { key: "stretching", name: "Stretching", aka: ["stretch", "stretches", "teygjur", "teygja", "stretcha"], log: "duration", cat: "Mobility", equip: "none", muscles: [] },
  { key: "foam_rolling", name: "Foam rolling", aka: ["foam roll", "foam roller"], log: "duration", cat: "Mobility", equip: "foam roller", muscles: [] },
  { key: "yoga", name: "Yoga", aka: [], log: "duration", cat: "Mobility", equip: "none", muscles: [] },
  { key: "warm_up", name: "Warm-up", aka: ["warm up", "warmup", "upphitun", "uppvärmning"], log: "duration", cat: "Mobility", equip: "none", muscles: [] }
];

/* ---------------- lookup ---------------- */
// Folds a name for matching: lowercase, no accents, Icelandic letters spelled out.
function exerciseFold(s) {
  return String(s || "").toLowerCase()
    .replace(/þ/g, "th").replace(/ð/g, "d").replace(/æ/g, "ae").replace(/ø/g, "o")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

var EXERCISE_BY_KEY = {};
var EXERCISE_NAMES = []; // [{ fold, ex }], longest name first
EXERCISE_BANK.forEach(function (ex) {
  EXERCISE_BY_KEY[ex.key] = ex;
  [ex.name].concat(ex.aka || []).forEach(function (n) { EXERCISE_NAMES.push({ fold: exerciseFold(n), ex: ex }); });
});
EXERCISE_NAMES.sort(function (a, b) { return b.fold.length - a.fold.length; });

// Words that describe how an exercise is done rather than which exercise it is.
var EXERCISE_DESCRIBERS = ["easy", "hard", "heavy", "light", "slow", "fast", "warm", "up", "warmup", "top", "set", "sets",
  "back", "off", "backoff", "single", "double", "triple", "work", "working", "technique", "volume", "recovery", "steady",
  "interval", "intervals", "zone", "2", "comp", "competition", "the", "with", "and", "belt", "belted", "raw"];

// The bank entry a written name refers to, or null. An exact name or alias
// wins. Otherwise, among the known names contained in it (longest first): the
// first whose leftover words only describe it ("Bench warm up" → bench press,
// "Walk easy" → walk); failing that, the longest name of two or more words
// ("Pause squat 2s pause" → pause squat). A one-word name with other real
// words around it doesn't count, so "Zercher squat" is not a back squat.
function findExercise(name) {
  var f = exerciseFold(name);
  if (!f) return null;
  for (var i = 0; i < EXERCISE_NAMES.length; i++) if (EXERCISE_NAMES[i].fold === f) return EXERCISE_NAMES[i].ex;
  var padded = " " + f + " ";
  var multiWord = null;
  for (var j = 0; j < EXERCISE_NAMES.length; j++) {
    var known = EXERCISE_NAMES[j].fold;
    if (!known || padded.indexOf(" " + known + " ") === -1) continue;
    var rest = padded.replace(" " + known + " ", " ").trim().split(" ").filter(Boolean);
    var describesOnly = rest.every(function (w) { return EXERCISE_DESCRIBERS.indexOf(w) !== -1 || /^\d+[a-z]*$/.test(w); });
    if (describesOnly) return EXERCISE_NAMES[j].ex;
    if (!multiWord && known.indexOf(" ") !== -1) multiWord = EXERCISE_NAMES[j].ex;
  }
  return multiWord;
}

// Lifts whose analysis and speed zones exist (EXERCISES in core.js).
function analyzedLift(ex) {
  return ex && (ex.sensor === "squat" || ex.sensor === "bench" || ex.sensor === "deadlift") ? ex.sensor : null;
}
