"""squats.py — the data team's Squats2.py as a function main.py can call.

Their files are in squat/, copied unchanged from Product-testing by
sync_data_team.py (squat/SOURCE.txt says which commit). This file runs the
same steps as squat/Squats2.py; only the start and the end differ:
  - input:  the recording's samples (list of dicts) instead of a CSV, the
            reported rep count, and the coach's zone instead of TYPE
  - output: one dict per rep instead of results.json; their plots and debug
            prints only with plot=True
After a sync, check that analyze() still matches Squats2.py.

Squats2.py uses one sensor: the side whose velocity drifts least. Its reps
fill that side's columns; the other side stays empty.
"""

import contextlib
import io
import os
import sys

import numpy as np
import pandas as pd

SQUAT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "squat")
sys.path.insert(0, SQUAT_DIR)  # their files import each other by plain name

import matplotlib.pyplot as plt
import MagdwickFilter
import VelocityCalculations
from scipy.integrate import cumulative_trapezoid

# The recording's target zone -> Squats2's TYPE. Since 2026-10-15 the website
# saves the zone's code group, which IS the TYPE: fast (> 1.30 m/s), medium
# (0.50-1.30), slow (< 0.50); see SPEED_ZONES / zoneGroup() in js/core.js.
# The four older names (recordings saved before that) keep their old mapping.
ZONE_TYPES = {
    "fast": "fast",
    "medium": "medium",
    "slow": "slow",
    "Speed–strength": "fast",
    "Strength–speed": "medium",
    "Accelerative strength": "slow",
    "Maximal strength": "slow",
}
DEFAULT_TYPE = "medium"  # no zone (free workouts, older recordings)

SAMPLE_RATE = 104.0  # Hz
WINDOW_SIZE = 15
MIN_SECONDS = 6      # their drift step reads the first 5 s, so shorter can't work


def source():
    try:
        with open(os.path.join(SQUAT_DIR, "SOURCE.txt"), encoding="utf-8") as f:
            line = f.read().splitlines()[1]
        return "Squats2.py (Product-testing %s)" % line.split("commit ")[1].split(" ")[0]
    except (OSError, IndexError):
        return "Squats2.py (Product-testing)"


VERSION = source()


def is_left_better(magnitude_filtered_right, magnitude_filtered_left, t_sec_right, t_sec_left):
    """Copied from Squats2.py (importing it would run their whole script):
    True when the left sensor's velocity drifts less than the right's."""
    mean_acceleration_left = np.mean(magnitude_filtered_left[104:208])
    mean_acceleration_right = np.mean(magnitude_filtered_right[104:208])
    velocity_left = cumulative_trapezoid(magnitude_filtered_left - mean_acceleration_left, t_sec_left, initial=0)
    velocity_right = cumulative_trapezoid(magnitude_filtered_right - mean_acceleration_right, t_sec_right, initial=0)
    return np.max(np.abs(velocity_left[312:-520])) < np.max(np.abs(velocity_right[312:-520]))


def analyze(samples, reps=None, zone=None, plot=False):
    warnings = []
    if not reps:
        raise ValueError("The number of reps is needed to analyze a squat set (Squats2 looks for exactly that many).")
    speed_type = ZONE_TYPES.get(zone)
    if not speed_type:
        speed_type = DEFAULT_TYPE
        warnings.append("No target zone: analyzed as '%s'." % DEFAULT_TYPE)

    # ============================================================
    # Samples -> table (was: pd.read_csv)
    # ============================================================

    data = pd.DataFrame(samples)
    for col in ["t", "x", "y", "z", "gx", "gy", "gz"]:
        data[col] = pd.to_numeric(data[col], errors="coerce")
    # Gyro is empty until the sensor's first gyro packet arrives.
    data[["gx", "gy", "gz"]] = data[["gx", "gy", "gz"]].fillna(0.0)

    # ============================================================
    # Separate left and right sensors
    # ============================================================

    left_data = data[data["sensor"] == "left"].sort_values("t").reset_index(drop=True)
    right_data = data[data["sensor"] == "right"].sort_values("t").reset_index(drop=True)
    need = int(MIN_SECONDS * SAMPLE_RATE)
    if len(left_data) < need or len(right_data) < need:
        raise ValueError("Recording too short: Squats2 needs at least %d s from both sensors, starting with "
                         "2–5 s standing still (got %.1f s left, %.1f s right)."
                         % (MIN_SECONDS, len(left_data) / SAMPLE_RATE, len(right_data) / SAMPLE_RATE))

    x_left, y_left, z_left = (left_data[c].to_numpy() for c in ("x", "y", "z"))
    x_right, y_right, z_right = (right_data[c].to_numpy() for c in ("x", "y", "z"))
    t_left = left_data["t"].to_numpy()
    t_right = right_data["t"].to_numpy()

    # ============================================================
    # Raw acceleration magnitude
    # ============================================================

    magnitude_left_raw = np.sqrt(x_left**2 + y_left**2 + z_left**2)
    magnitude_right_raw = np.sqrt(x_right**2 + y_right**2 + z_right**2)

    # ============================================================
    # Time
    # ============================================================

    t_left_sec = t_left - t_left[0]
    t_right_sec = t_right - t_right[0]

    # ============================================================
    # Filter using magdwick filter
    # ============================================================

    dt = 1.0 / SAMPLE_RATE
    _, magnitude_left_filtered = MagdwickFilter.madgwick_filter(
        x_left, y_left, z_left,
        left_data["gx"].to_numpy(), left_data["gy"].to_numpy(), left_data["gz"].to_numpy(), dt)
    _, magnitude_right_filtered = MagdwickFilter.madgwick_filter(
        x_right, y_right, z_right,
        right_data["gx"].to_numpy(), right_data["gy"].to_numpy(), right_data["gz"].to_numpy(), dt)

    # ============================================================
    # Calculate velocity using the filtered acceleration (one side)
    # ============================================================

    if is_left_better(magnitude_right_filtered, magnitude_left_filtered, t_right_sec, t_left_sec):
        side, magnitude, t_sec, raw = "left", magnitude_left_filtered, t_left_sec, magnitude_left_raw
    else:
        side, magnitude, t_sec, raw = "right", magnitude_right_filtered, t_right_sec, magnitude_right_raw

    try:
        with quiet(plot, reps):
            results = VelocityCalculations.calculate_velocity3(
                magnitude, t_sec, speed_type, reps=reps, magnitude_raw=raw, window_size=WINDOW_SIZE)
    except IndexError as err:
        # Their drift step looks for the bar being racked (a big spike) after
        # the first 5 s to find where the set ends; without it, this fails.
        spike, needed = end_spike(raw, speed_type)
        if plot:
            plot_end_spike(t_sec, raw, needed, side, speed_type)
        raise ValueError("Couldn't find the end of the set: the biggest spike after 5 s on the %s sensor was "
                         "%.1f m/s², the '%s' analysis needs one above %.1f (the bar being racked). Start recording "
                         "standing still for a few seconds, and press Stop only after the bar is back in the rack."
                         % (side, spike, speed_type, needed)) from err

    # ============================================================
    # One row per rep (was: results.json)
    # ============================================================

    average_v = results["average_velocities"]
    peak_v = results["peak_velocities"]
    rows = []
    for i in range(len(average_v)):
        rows.append({
            "rep_index": i + 1,
            side + "_mean_velocity": float(average_v[i]),
            side + "_peak_velocity": float(peak_v[i]) if i < len(peak_v) else None,
            "metrics": {"sensor_used": side, "speed_type": speed_type},
        })
    if len(rows) != reps:
        warnings.append("Expected %d reps (reported), found %d." % (reps, len(rows)))
    return {"reps": rows, "warnings": warnings, "version": VERSION}


DRIFT_START = 520  # VelocityCalculations.find_drift looks for the spike from here (5 s)


def end_spike(raw, speed_type):
    """The biggest acceleration after 5 s, and the height find_drift needs
    (its threshold: a multiple of the average acceleration, per type)."""
    needed = VelocityCalculations.threshold_dict[speed_type][0] * float(np.mean(raw))
    after = raw[DRIFT_START:]
    return (float(np.max(after)) if len(after) else 0.0), needed


def plot_end_spike(t_sec, raw, needed, side, speed_type):
    """With --plot: why the end of the set wasn't found."""
    plt.figure(figsize=(12, 5))
    plt.plot(t_sec, raw, label="raw acceleration magnitude (%s sensor)" % side)
    plt.axhline(needed, color="red", linestyle="--", label="find_drift threshold ('%s')" % speed_type)
    plt.axvline(t_sec[min(DRIFT_START, len(t_sec) - 1)], color="grey", linestyle=":", label="5 s: search starts here")
    plt.xlabel("Time [s]")
    plt.ylabel("Acceleration [m/s²]")
    plt.title("No spike above the threshold after 5 s: the set's end (bar racked) wasn't found")
    plt.legend()
    plt.grid(True)
    plt.show()


@contextlib.contextmanager
def quiet(plot, reps):
    """Their velocity step always plots and prints debug output: without
    plot=True no plot windows (none on Azure) and prints swallowed. Always: a
    stop when the rep search can't find enough reps (their loop lowers the
    threshold forever), with what it did find."""
    real_show, real_find_peaks = plt.show, VelocityCalculations.find_peaks

    def guarded_find_peaks(x, *args, **kwargs):
        height = kwargs.get("height")
        if isinstance(height, (int, float)) and height < -10:
            found = len(real_find_peaks(x, distance=kwargs.get("distance"))[0])
            gap = (kwargs.get("distance") or 1) / SAMPLE_RATE
            raise ValueError(
                "Couldn't find the reported %d reps: at most %d in the part of the recording the analysis "
                "searches (%.1f s: from 5 s after Record until 2 s before the bar is racked), counting rep "
                "peaks at least %.0f s apart. Do the reps after the first 5 s, wait 2 s before racking, and "
                "check the rep count." % (reps, found, len(x) / SAMPLE_RATE, gap))
        return real_find_peaks(x, *args, **kwargs)

    VelocityCalculations.find_peaks = guarded_find_peaks
    if not plot:
        plt.show = lambda *a, **k: None
    try:
        if plot:
            yield
        else:
            with contextlib.redirect_stdout(io.StringIO()):
                yield
    finally:
        plt.show = real_show
        VelocityCalculations.find_peaks = real_find_peaks
        if not plot:
            plt.close("all")
