<div align="center">

![V-LO: every rep, measured](docs/images/readme/banner.svg)

**Velocity-based training for powerlifters and strength-athletes, built on two off-the-shelf Movesense sensors and a web app for athletes and coaches.**

# [▶ Open the V-LO web app](https://sportstechveloproject.github.io/.github/code/website/)

![Sensors](https://img.shields.io/badge/sensors-2×_Movesense-7086f5?style=flat-square)
![Sampling](https://img.shields.io/badge/sampling-104_Hz-7086f5?style=flat-square)
![Backend](https://img.shields.io/badge/backend-Supabase-3ecf8e?style=flat-square)
![Analysis](https://img.shields.io/badge/analysis-Azure-0078d4?style=flat-square)
![Lifts](https://img.shields.io/badge/lifts-squat_·_bench_·_deadlift-e8875f?style=flat-square)

[Why VBT](#why-vbt) · [The problem](#the-problem) · [How it works](#how-it-works) · [The app](#the-app) · [Results](#results) · [Get started](#get-started) · [Team](#team)

</div>

<br>

<table>
  <tr>
    <td align="center" width="25%"><img src="docs/images/readme/male-back-squat.png" alt="Back squat"><br><sub><b>Back squat</b></sub></td>
    <td align="center" width="25%"><img src="docs/images/readme/female-front-squat.png" alt="Front squat"><br><sub><b>Front squat</b></sub></td>
    <td align="center" width="25%"><img src="docs/images/readme/male-bench-press.png" alt="Bench press"><br><sub><b>Bench press</b></sub></td>
    <td align="center" width="25%"><img src="docs/images/readme/female-deadlift.png" alt="Deadlift"><br><sub><b>Deadlift</b></sub></td>
  </tr>
</table>

<p align="center"><sub>Click a section below to open it.</sub></p>

---

<a id="why-vbt"></a>
<details>
<summary><h1>🏋️ Why velocity-based training?</h1></summary>
<br>

<table>
  <tr>
    <td width="58%" valign="top">

Traditional programs prescribe load as a fixed percentage of your 1RM. But your strength changes day to day with sleep, stress and fatigue, so Sunday's spreadsheet may be wrong by Thursday.

**Velocity-based training (VBT)** uses bar speed instead. As the load gets closer to your max, the bar slows down in a predictable way, which gives a live, objective readout of how hard a set really is.

✅ **Autoregulate:** load for the day you're actually having<br>
✅ **Manage fatigue:** stop a set when bar speed drops too far<br>
✅ **Estimate 1RM:** without testing a true max<br>
✅ **Train with intent:** a number after every rep makes you push

VBT gives strength gains similar to percentage-based training, at lower training loads.

  </td>
    <td width="42%" align="center">
      <img src="docs/images/readme/female-back-squat.png" alt="Back squat with sensors on the bar ends">
    </td>
  </tr>
</table>

## Velocity zones

Every set is classified by its mean bar speed:

![Velocity zones](docs/images/readme/velocity-zones.svg)

<details>
<summary><h3>Zones as a table · click to open</h3></summary>
<br>

| Zone | Mean velocity | Typical % 1RM | Training effect |
|---|---|---|---|
| 🔵 Starting strength | > 1.30 m/s | bodyweight | Overcoming inertia: jumps and throws |
| 🟢 Speed-strength | 1.00–1.30 m/s | 20–40% | Speed first, strength second |
| 🟢 Strength-speed | 0.75–1.00 m/s | 40–60% | Moderately heavy loads, as fast as possible |
| 🟡 Accelerative strength | 0.50–0.75 m/s | 65–80% | Driving heavy loads as fast as possible |
| 🟠 Absolute strength | < 0.50 m/s | 80–100% | Maximal force: heavy triples, doubles, singles |

</details>

</details>

---

<a id="the-problem"></a>
<details>
<summary><h1>🎯 The problem</h1></summary>
<br>

Coaches report three barriers to using VBT today:

<table>
  <tr>
    <td align="center" width="33%">💸<br><b>Expensive</b><br><sub>The most accurate devices, linear position transducers, cost a lot.</sub></td>
    <td align="center" width="33%">🔌<br><b>Hard to use</b><br><sub>Cables and setup get in the way of the lift.</sub></td>
    <td align="center" width="33%">📉<br><b>Limited accuracy</b><br><sub>Cheaper wireless IMUs suffer from drift and bar rotation.</sub></td>
  </tr>
</table>

> ℹ️ **Our research question:** Can two end-mounted IMUs give accurate enough mean concentric velocity for feedback during training, despite irregular barbell rotation?

<details>
<summary><h3>Why do cheaper sensors struggle? · click to open</h3></summary>
<br>

- **Integration drift.** Velocity comes from integrating acceleration, so small errors add up over time.
- **Irregular bar rotation.** The bar tilts and rotates mid-lift, so the sensor axes stop lining up with the movement.
- **One side only.** A single sensor can't tell whether the left and right sides of the bar move differently.

</details>

</details>

---

<a id="how-it-works"></a>
<details>
<summary><h1>⚙️ How it works</h1></summary>
<br>

V-LO puts **one Movesense sensor on each end of the bar**. The velocitydrift of both sensors are compared and the data from the sensor with the most linear drift are used for velocity estimations.

![Data pipeline from rep to result](docs/images/readme/pipeline.svg)

<table>
  <tr>
    <td width="50%" valign="top">

**From acceleration to velocity**

1. **Orientation:** the Madgwick filter fuses accelerometer and gyroscope data
2. **Drift correction:** The velocity drift is approximated as linear. Estimating a gradient coefficient from the first and last half second of data. 
3. **Rep detection:** Velocity peaks are identified by comparing number of peaks to the known number of repetitions performed. 
4. **Velocity:** For each repetition the mean velocity is estimated by integrating the acceleration over time for each repetition. Only the velocity data with a value above the approximated drift is used. The peak velocity is estimated using the velocity curves peak height. 
  </td>
    <td width="50%" valign="top">

**Why Movesense, not a custom board?**

A custom IMU would mean building our own firmware, Bluetooth stack and enclosure. That time would come out of the data analysis and the user experience, which are our core contributions.

Movesense is commercially available, with a 9-axis IMU and Bluetooth Low Energy.

  </td>
  </tr>
</table>

<details>
<summary><h3>Data pipeline in detail · click to open</h3></summary>
<br>

1. **Save.** You press **■ Stop & save**. The web app saves the sensor data and adds a row to the `sessions` table in Supabase.
2. **Trigger.** A Supabase webhook fires on the new row and sends the recording to our app on Azure.
3. **Analyze.** Azure queues the recording, runs the analysis code (`Squats2`) and saves the reps and velocities back to Supabase.
4. **Show.** The web app checks for results every 2 seconds and shows the set's velocity, whether it hit the target zone, and a suggested next weight. No refresh needed.

- **Cold start:** if Azure has been idle, the first set can take 10–30 s.
- **Retries:** missed sets are resent automatically every minute.
- **Errors:** if a set can't be analyzed, it shows the reason instead of a result.

</details>

</details>

---

<a id="the-app"></a>
<details>
<summary><h1>📱 The app</h1></summary>
<br>

<table>
  <tr>
    <td width="40%" align="center">
      <img src="docs/images/readme/male-deadlift.png" alt="Deadlift">
    </td>
    <td width="60%" valign="top">

**1.** 📍 Place the sensors on the bar ends<br>
**2.** 📶 Connect in the web app<br>
**3.** 🏋️ Pick exercise and weight<br>
**4.** 📊 Lift and get feedback on every rep

After each set you see **peak and mean velocity**, a **rep-by-rep readout**, **consistency**, whether you **hit the target zone**, and a **suggested next weight**.

Web-based, so it works on any phone, tablet or laptop.

  </td>
  </tr>
</table>

![V-LO website](docs/images/website/website_frontpage.png)

Coaches get a team view with training volume, average bar speed per lift, and PR leaderboards for each velocity zone.

<table>
  <tr>
    <td align="center"><img src="docs/images/website/website_team.png" alt="Team dashboard"><br><sub><b>Team dashboard</b></sub></td>
    <td align="center"><img src="docs/images/website/website_PB_back.png" alt="Top PRs per velocity zone"><br><sub><b>Top PRs per velocity zone</b></sub></td>
  </tr>
</table>

➡️ **More screenshots:** [Website walkthrough](docs/images/website/README.md)

</details>

---

<a id="results"></a>
<details>
<summary><h1>📊 Results</h1></summary>
<br>

We validated V-LO against a **GymAware RS linear position transducer**, a gold-standard reference that recorded the same reps at the same time.

<table>
  <tr>
    <td align="center" width="33%"><h2>4</h2><sub>participants, 6 squats in each of 3 velocity zones</sub></td>
    <td align="center" width="33%"><h2>&lt;&nbsp;0.10&nbsp;m/s</h2><sub>error in the zones where powerlifters train</sub></td>
    <td align="center" width="33%"><h2>5.8&nbsp;s</h2><sub>median time from saved set to feedback</sub></td>
  </tr>
</table>

## Accurate where powerlifters train

The table shows the mean absolute error (± SD) between V-LO and GymAware, in m/s:

| Zone (by peak velocity) | Mean velocity | Peak velocity | Error below 0.10 m/s? |
|---|---:|---:|:---:|
| Absolute strength (< 0.5 m/s) | 0.03 ± 0.02 | 0.04 ± 0.02 | ✅ Yes |
| Speed strength (0.5–1.3 m/s) | 0.05 ± 0.16 | 0.06 ± 0.03 | ✅ Yes |
| Starting strength (> 1.3 m/s) | 0.33 ± 0.17 | 0.21 ± 0.13 | ❌ No |

<p align="center"><img src="docs/images/readme/peak-velocity-chart.png" width="60%" alt="Peak velocity per participant, GymAware vs V-LO"></p>

### Why accuracy drops at high speed

V-LO doesn't measure velocity directly. It integrates acceleration over each rep, and that approach works best for slower, heavier lifts:

- **Fast reps are short.** At 104 Hz, a very fast rep contains fewer samples, so each small measurement error carries more weight in the result.
- **Fast reps have bigger, sharper accelerations.** Quick changes in speed and more bar vibration make the signal harder to follow, and errors build up faster during integration.
- **The drift correction assumes the drift is linear.** That holds well over a controlled lift, but less well when the movement is very explosive.

This matters less than it sounds: **peak velocities above 1.3 m/s only happen with very light loads, which powerlifters rarely train with.** In the zones where powerlifting training happens, the error stays below 0.10 m/s.

## Feedback before the next set

<table>
  <tr>
    <td align="center" width="50%"><h1>5.8 s</h1><sub>median processing time</sub></td>
    <td align="center" width="50%"><h1>0.9–7.5 s</h1><sub>range over 7 recorded sets</sub></td>
  </tr>
</table>

Measured from the moment a recording is saved until its results appear in the app. Results usually arrive well before the next set starts, since rest between sets in powerlifting is typically a few minutes. The spread comes mainly from the analysis app on Azure: when it has been idle, it needs a few extra seconds to start up. This is a preliminary test.

</details>

---

<a id="get-started"></a>
<details>
<summary><h1>🚀 Get started</h1></summary>
<br>

```bash
python -m http.server 8080
```

Then open [localhost:8080/vlo.html](http://localhost:8080/vlo.html) in **Chrome or Edge** (they support Web Bluetooth, which connects to the sensors) and log in with your own account.

> ⚠️ **Warning:** The analysis runs on Azure, so changes to the analysis code also need a deploy. Check with the team before deploying.

## Recording a set

![How to record a set](docs/images/readme/recording-guide.svg)

Standing still at the start gives a clean baseline, gaps between reps help separate them, and a firm rack marks the end of the set.

</details>

---

<a id="limitations"></a>
<details>
<summary><h1>🧭 Limitations and roadmap</h1></summary>
<br>

<table>
  <tr>
    <td width="45%" valign="top">

**Known limitations**

- Small number of participants
- The participants were not professional powerlifters
- The evaluation was only done for squats
- Unreliable Bluetooth connection
- Slow first set after Azure is idle

  </td>
    <td width="55%" valign="top">

### Next steps
- [ ] **Better drift handling** to make fast, light lifts as accurate as heavy ones
- [ ] **Bench press and deadlift** analysis, validated like the squat
- [ ] **A larger validation study** with powerlifters
- [ ] **Combine both sensors**, e.g. to measure left–right balance
- [ ] **Automatic rep detection**, so no rep count has to be entered

### Longer term
- [ ] **Estimate the 1RM** from the athlete's load–velocity profile
- [ ] **Intelligent coach platform** with programs and benchmarks
- [ ] **More exercises**, including team sports
- [ ] **Other lifting equipment** beyond the barbell
- [ ] **Wearable version** that tracks the athlete
  </td>
  </tr>
</table>

</details>

---

<a id="repository"></a>
<details>
<summary><h1>📁 Repository</h1></summary>
<br>




<pre>
.github/
├── <a href="README.md">README.md</a>                           ← this page
├── <a href="code/">code/</a>                               ← all source code
│   ├── <a href="code/analysis/">analysis/</a>                       ← Azure app that analyses each set
│   │   ├── <a href="code/analysis/squat/">squat/</a>                      ← squat analysis (Squats2.py)
│   │   ├── <a href="code/analysis/function_app.py">function_app.py</a>             ← entry point Azure runs
│   │   └── <a href="code/analysis/requirements.txt">requirements.txt</a>            ← Python packages
│   ├── <a href="code/database/">database/</a>                       ← Supabase database
│   │   ├── <a href="code/database/migrations/">migrations/</a>                 ← changes to the tables, by date
│   │   └── <a href="code/database/queries/">queries/</a>                    ← useful SQL queries
│   └── <a href="code/website/">website/</a>                        ← the V-LO web app
│       ├── <a href="code/website/css/">css/</a>                        ← styling (vlo.css)
│       └── <a href="code/website/js/">js/</a>                         ← app logic: sensors, recording, charts
├── <a href="data/">data/</a>                               ← recorded sensor data and test results
├── <a href="docs/">docs/</a>
│   ├── <a href="docs/images/">images/</a>
│   │   ├── <a href="docs/images/readme/">readme/</a>                     ← banners, diagrams and 3D lifters
│   │   └── <a href="docs/images/website/">website/</a>                    ← screenshots of the V-LO website
│   └── <a href="docs/papers/">papers/</a>                         ← final paper and presentation
└── <a href="Issue_Template/">Issue_Template/</a>                     ← templates for reporting issues
</pre>

| Path | What's inside |
|---|---|
| [`code/analysis/`](code/analysis/) | The Azure app that runs after every saved set. `function_app.py` is the entry point, and `supabase_api.py` reads recordings from and writes results back to Supabase. |
| [`code/analysis/squat/`](code/analysis/squat/) | The squat analysis: `MagdwickFilter.py` (orientation), `ValidatePeaks.py` (rep detection), `VelocityCalculations.py` (velocity) and `Squats2.py`, which ties them together. |
| [`code/database/migrations/`](code/database/migrations/) | SQL files that build and change the Supabase tables, named by date so they run in order. |
| [`code/database/queries/`](code/database/queries/) | Saved SQL queries, such as `processing-timing.sql` for checking how long the analysis takes. |
| [`code/website/`](code/website/) | The V-LO web app. Start it with `python -m http.server 8080`. |
| [`code/website/css/`](code/website/css/) | The styling for the whole app, in `vlo.css`. |
| [`code/website/js/`](code/website/js/) | The app logic: `sensors.js` (Bluetooth), `recorder.js` (recording sets), `charts.js`, `vbt.js`, `team.js`, `plans.js` and more. |
| [`data/`](data/) | Recorded sensor data from test sessions, plus the GymAware reference data used in the validation. |
| [`docs/images/readme/`](docs/images/readme/) | The banners, diagrams and 3D lifter images used in this README. |
| [`docs/images/website/`](docs/images/website/) | Screenshots of the V-LO website, with a [walkthrough](docs/images/website/README.md) explaining each page. |
| [`docs/papers/`](docs/papers/) | The [final paper](docs/papers/Full%20Time%20Paper.pdf) and the [final presentation](docs/papers/V-LO%20Final%20Presentation.pdf). |
| [`Issue_Template/`](Issue_Template/) | Templates for reporting bugs and suggesting features. |

</details>

---

<a id="team"></a>
<details>
<summary><h1>👥 Team</h1></summary>
<br>

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/arvidaxe"><img src="https://github.com/arvidaxe.png" width="80" alt="Arvid"><br><b>Arvid</b></a>
    </td>
    <td align="center">
      <a href="https://github.com/GreipurGislason"><img src="https://github.com/GreipurGislason.png" width="80" alt="Greipur"><br><b>Greipur</b></a>
    </td>
    <td align="center">
      <a href="https://github.com/HugoPersson01"><img src="https://github.com/HugoPersson01.png" width="80" alt="Hugo"><br><b>Hugo</b></a>
    </td>
    <td align="center">
      <a href="https://github.com/siljekongstorpjohansen"><img src="https://github.com/siljekongstorpjohansen.png" width="80" alt="Silje"><br><b>Silje</b></a>
    </td>
    <td align="center">
      <a href="https://github.com/svanbergaddi"><img src="https://github.com/svanbergaddi.png" width="80" alt="Svanberg"><br><b>Svanberg</b></a>
    </td>
  </tr>
</table>

<details>
<summary><h3>Roles · click to open</h3></summary>
<br>

<table>
  <tr>
    <td colspan="2" align="center">

### 🧭 Scrum master
[**Svanberg (Addi)**](https://github.com/svanbergaddi)<br>
Led the sprints and built the data pipeline from Supabase to Azure and back. Worked across both the UI and the code.

  </td>
  </tr>
  <tr>
    <td width="50%" valign="top">

### 🎨 UI / UX
Designed and built the web app: the dashboard, the flow for connecting sensors and picking a lift, and how feedback is shown after each set.

- [**Hugo**](https://github.com/HugoPersson01)
- [**Greipur**](https://github.com/GreipurGislason)

  </td>
    <td width="50%" valign="top">

### 🐍 Data and analysis
Wrote the Python code that processes the sensor data: filtering, orientation, rep detection and velocity estimation.

- [**Silje**](https://github.com/siljekongstorpjohansen)
- [**Arvid**](https://github.com/arvidaxe)

  </td>
  </tr>
</table>

</details>

</details>
