# V-Lo database structure

![V-Lo database structure: people and teams, recordings, and training plans and workouts, with their foreign keys](database-diagram.svg)

Supabase (Postgres). Everything belongs to a **person** (`profiles`), people can be grouped into **teams**, and training data comes in two shapes that meet in the middle:

- **What was planned and done:** a plan → given to an athlete → dated workouts → the sets the athlete logged.
- **What the sensors measured:** a recording of one set → its reps and their bar speeds.

A logged set can point to the recording made during it. That link is where "the plan said 5 × 3 @ 140 kg" meets "rep 2 moved at 0.52 m/s".

> **Status:** the people/team tables and `sessions`/`reps` already exist. The four plan and workout tables are defined in [`supabase/plans.sql`](../supabase/plans.sql) and have **not been created yet**.

## The three groups

### 1. People and teams (existing)

*Columns checked against the live database. The foreign keys and delete behaviour of the existing tables are inferred from how the app queries them; confirm them in Supabase → Table Editor → a table → the column's link icon.*

| Table | One row per | Foreign keys | Why they're related |
|---|---|---|---|
| `profiles` | person | `id` → `auth.users.id` | Supabase Auth owns logins; `profiles` holds what the app shows (the name). Same id, so a login and its profile are always the same person. Every "person" column in the plan tables points here. |
| `teams` | team | `created_by` → `profiles` | Remembers who started the team. |
| `team_members` | person in a team | `team_id` → `teams`, `user_id` → `profiles` | Many-to-many: a person can be in several teams, a team has many people. `role` (admin / coach / member) is **per team**, so the same login can coach one team and train in another. **Every coach permission rule hangs off this table.** |
| `team_invites` | invite | `team_id` → `teams`, `created_by` and `invited_user_id` → `profiles` | Who invited whom to which team, with which role. |
| `team_join_requests` | request to join | `team_id` → `teams`, `user_id` → `profiles`, `invite_id` → `team_invites` | An athlete's invite link becomes a request a coach approves; `invite_id` records which link it came from. |

### 2. Recordings (existing)

| Table | One row per | Foreign keys | Why they're related |
|---|---|---|---|
| `sessions` | **recorded set** (one Start → Stop with the sensors) | `user_id` → the lifter | A recording belongs to the person who lifted, *not* to a team: history moves with the lifter if they change team, and someone with no team can still record. Coaches see it because the lifter is in their team. Optional `target_zone` (e.g. 'Strength–speed', with an en dash) is the coach's zone from the plan, for the analysis; null when the set wasn't planned with one ([migration](../supabase/migrations/2026-10-13-session-target-zone.sql)). |
| `reps` | rep detected in a recording | `session_id` → `sessions` (delete the recording → its reps go too) | A rep only exists inside a recording. Written by `python/main.py`. |
| Storage `raw-sessions` | raw sensor file | path stored in `sessions.raw_data_path` | The ~1 MB of samples is too big for a row, so it lives in Storage; the row points to it. Re-running the analysis reads it from there. |

### 3. Training plans and workouts (new)

| Table | One row per | Foreign keys | Why they're related |
|---|---|---|---|
| `plans` | programme | `team_id` → `teams` **or** `owner_id` → `profiles` (exactly one), `created_by` → `profiles` | A **team plan** belongs to the team, so every coach in it can use and edit it, not only its author. A **personal plan** belongs to one person, who writes and follows it without a coach. |
| `plan_assignments` | plan given to one athlete | `plan_id` → `plans`, `athlete_id` → `profiles` | The same plan can go to many athletes, each with their own start date and training weekdays, which is why this is its own table. A team plan can only go to members of that team; a personal plan only to its owner. |
| `workouts` | **one training day for one athlete**, on a date | `athlete_id` → `profiles`, `assignment_id` → `plan_assignments` (**optional**) | **Planned** workouts are created when a plan is assigned (week 2 day 1 → Mon 20 Oct); the coach can move one without touching the plan, and "done" or "missed" belongs to that day. **Free** workouts have no assignment: the athlete trained without a plan. Either way this is the "day's lifting session" the app groups sets by. `athlete_id` sits directly on the workout so "whose day is this" never depends on a plan existing. |
| `set_logs` | set the athlete finished (weight, reps, Done) | `workout_id` → `workouts`, `athlete_id` → `profiles`, `recording_id` → `sessions` (**optional, unique**) | Belongs to the day it was done in. `recording_id` is set only when the sensors were used, and links the logged set to its measured reps. Unique: one recording belongs to at most one set. |

## How one set flows through the tables

```
plans ──► plan_assignments ──► workouts ──► set_logs ──recording_id──► sessions ──► reps
"Peaking    "Arvid, from        "Mon 20 Oct,   "Back squat,           "the recording   "rep 1: 0.55 m/s
 block"      Mon 13 Oct,         Week 2 Day 1"  set 2: 140 kg × 3,      of that set"     rep 2: 0.52 m/s …"
             Mon/Wed/Fri"                       Done 18:42"
```

- **With sensors** (squat, bench, deadlift): pressing Done stops the recording → a `sessions` row + raw file → `main.py` writes its `reps` → the set log's `recording_id` points to it.
- **Without sensors:** the set log has `recording_id` empty. Nothing else changes.
- **Without a plan:** the athlete starts a free workout for today and logs sets in it. The chain starts at `workouts`.
- **A recording on its own** (e.g. `main.py` on a test file) is just a `sessions` row with its `reps`; nothing points to it.

### Why the link goes from `set_logs` to `sessions` (and not the other way)

A recording can exist without any plan or workout (test recordings), and a logged set can exist without a recording (no sensors). The link is optional on both sides, so it sits as a nullable column on the side created *second*: the set log, which points at the recording made during it.

## Who it works for

| Situation | What they can do |
|---|---|
| **Athlete with no team** | Record sets with sensors, see all their own analysis (speeds, zones, fastest rep, left/right), log free workouts, write and follow personal plans. Nobody else sees their data. |
| **Athlete in a team** | All of the above, plus follow plans their coaches assign. The team's coaches can read their training data. |
| **Coach** | Coaching is a role in a team, not a kind of account. A coach can also train: record sets, log free workouts, follow a personal plan, or assign a team plan to themselves. |
| **Coach of several teams** | One `team_members` row per team. They see each team's plans and athletes; a team's plan can only be assigned to that team's members. To reuse a plan in another team, copy it (planned website feature). |
| **Athlete in several teams** | Can follow plans from each; their calendar shows workouts from all of them. Each team's coaches read their training data. |

*Website limitation for now:* the app loads only one team per person. Several teams per person needs a team switcher in the header; the database already supports it.

## What happens on delete

| Delete a… | Also deleted | Kept |
|---|---|---|
| team | its members, invites, requests, **team plans → assignments → planned workouts → their set logs** | everyone's recordings, free workouts and personal plans |
| plan | its assignments → planned workouts → their set logs | recordings (the set log's link just disappears) |
| assignment ("Unassign") | its planned workouts → their set logs | recordings |
| workout | its set logs | recordings |
| recording (`sessions` row) | its reps | the set log (its `recording_id` becomes empty) |
| person (`profiles`) | their memberships, recordings, personal plans, assignments, workouts, set logs | team plans they wrote (`created_by` becomes empty; the team still owns them) |

Rows for the existing tables (team, person, recording) describe the expected behaviour; the plan rows are what `plans.sql` sets up. Recordings are never deleted by plan changes: measured data is the hardest thing to get back.

## Who can see and change what (row level security)

| | Read | Create / change |
|---|---|---|
| `plans` | team plans: the team's coaches · personal plans: the owner · anyone following the plan | team plans: the team's coaches · personal plans: the owner |
| `plan_assignments` | the athlete · whoever manages the plan | whoever manages the plan (team plan → team members only; personal plan → only the owner) |
| `workouts` | the athlete · coaches of a team the athlete is in | planned: whoever manages the plan; the athlete can only mark them complete · free: the athlete |
| `set_logs` | the athlete · coaches of a team the athlete is in | the athlete, for their own workouts only |

Enforced in the database as well as the app: a plan can't have more training days in a week than the athlete's chosen weekdays; nobody can hand a workout or set to someone else; only the plan's manager can move a planned workout.

## Known loose ends

- **Exercise names are plain text** in three places (`sessions.exercise` = `back_squat`, plan exercises = "Back Squat", `set_logs.exercise`). The app matches them with the plan reader's lift matcher. A shared exercise list table would make this exact; not needed yet.
- `sessions.reported_rep_count` and `set_logs.reps` can disagree (what the lifter said vs what they typed after the set); for planned sets, `set_logs.reps` is the one to trust.
- **Website work still to do:** athlete calendar and workout view, free workouts, personal plans, team switcher, copying a plan to another team.
