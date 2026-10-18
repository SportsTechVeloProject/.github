# V-Lo

**Velocity-based training for the platform, not the lab.**

V-Lo turns a Movesense Flash IMU clipped to the bar sleeve into live bar speed, tempo and velocity loss, set by set. Instead of loading from a spreadsheet written on Sunday, lifters load from what their body is actually doing today.

> Screenshots below are from the demo environment and show fictional data.

---

## Landing page

### Front page
![V-Lo front page](doc/images/website/website_frontpage.png)

The hero section introduces the core idea: every rep, measured. The card on the right shows an example rep from a back squat set, with the velocity curve over time and the three key numbers V-Lo reports: peak concentric velocity, mean velocity and velocity loss across the set.

### How it works
![How it works](doc/images/website/website_HIW.png)

Three steps from sensor to decision: clip the Movesense Flash to the bar, lift like normal while the IMU samples at 104 Hz, and let V-Lo tell you when to stop, drop weight or push on once velocity loss crosses your threshold.

### Training zones
![Velocity training zones](doc/images/website/website_zones.png)

Every set is classified into one of five velocity zones from the VBT literature (Bryan Mann, via GymAware), from starting strength (> 1.30 m/s) down to absolute strength (< 0.50 m/s). The zone is decided by the measured mean bar speed, with % of 1RM shown only as a typical reference.

### Built for powerlifting
![Scoped to competitive powerlifting](doc/images/website/website_scope.png)

V-Lo is deliberately focused on competitive powerlifting (squat, bench and deadlift under federation rules) rather than being a general fitness tracker with a barbell mode added on.

### Pricing
![Pricing](doc/images/website/website_sub.png)

V-Lo is a pure software subscription running on the existing Movesense sensor platform, so there is no hardware markup. There are two plans: **Lifter** for your own training and **Coach** for managing a squad, priced per lifter.

---

## The app

### Team dashboard
![Team dashboard](doc/images/website/website_team.png)

The team page gives athletes and coaches a quick overview: today's planned session, number of athletes, total volume lifted, this week's volume compared with the recent average, and average bar speed per lift.

### Team members
![Coaches and athletes](doc/images/website/website_atheletes.png)

Coaches and athletes in the team are listed with their join date. From here you can open an athlete's profile, suggest new members, or leave the team.

### Top PRs per velocity zone

<table>
  <tr>
    <td><img src="doc/images/website/website_PB_back.png" alt="Top PRs back squat"></td>
    <td><img src="doc/images/website/website_pb_front.png" alt="Top PRs front squat"></td>
  </tr>
  <tr>
    <td align="center"><em>Back squat</em></td>
    <td align="center"><em>Front squat</em></td>
  </tr>
</table>

The leaderboard shows the three heaviest sets in each speed zone, one per athlete. Only sets recorded with the sensor count, since a PR here is defined by both load and measured bar speed.

---

## Hardware

V-Lo works with the [Movesense](https://www.movesense.com/) Flash sensor. No proprietary hardware is required.

