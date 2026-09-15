<!-- Optional: a photo of the sensors on the bar, or a velocity plot.
     Upload it by dragging into any GitHub comment box, then paste the
     URL it generates here. This is the highest-value thing on the page. -->

# SportsTech Velo

**Problem being solved statement**

We put a Movesense IMU on each end of the barbell and turn the raw motion
into feedback the athlete can act on between reps: bar velocity through the
concentric phase, and the difference between the left and right side of the
lift.

University project in sports technology at KTH, autumn 2026.
Supervisor: Jonas Willén.

---

## How it works

Two Movesense sensors clamp to the barbell sleeves and stream accelerometer
and gyroscope data ⟨over BLE — adjust if the path is different⟩ to a web app,
which segments each rep, isolates the upward phase, and shows the athlete
their velocity and left/right asymmetry.


## The team

| Who | Focus |
|---|---|
| **Addi** | Scrum master, project management |
| **Arvid**, **Silje** | Data pipeline, analysis, validation |
| **Hugo**, **Greipur** | UI/UX, backend, physical product |

## Where things are

- **[Project board](⟨link⟩)** — current sprint, backlog, who owns what
- **[Weekly log](⟨link⟩)** — what we did and what we learned, week by week
- **[Decision records](⟨link⟩)** — why the project looks the way it does
- **[MoveSenseCode](https://github.com/SportsTechVeloProject/MoveSenseCode)** — sensor handling and web app
- **[Product-testing](https://github.com/SportsTechVeloProject/Product-testing)** — test scripts and validation
- **[Users Website](https://github.com/SportsTechVeloProject/Product-and-UI)** - eventual user interface

## Decisions worth knowing about

- **Movesense over a custom IMU board.** 
- **Web app rather than native.**
