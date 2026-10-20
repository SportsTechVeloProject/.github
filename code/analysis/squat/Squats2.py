import pandas as pd
import numpy as np
import os
from scipy.signal import find_peaks
import matplotlib.pyplot as plt
from scipy.integrate import cumulative_trapezoid
import MagdwickFilter
import VelocityCalculations
import sys

def is_left_better(magnitude_filtered_right, magnitude_filtered_left, t_sec_right, t_sec_left):
    mean_acceleration_left = np.mean(magnitude_filtered_left[104:208])
    mean_acceleration_right = np.mean(magnitude_filtered_right[104:208])


    velocity_left = cumulative_trapezoid(magnitude_filtered_left - mean_acceleration_left, t_sec_left, initial=0)
    velocity_right = cumulative_trapezoid(magnitude_filtered_right - mean_acceleration_right, t_sec_right, initial=0)
    if (np.max(np.abs(velocity_left[312:-520])) < np.max(np.abs(velocity_right[312:-520]))):
        return True
    else:
        return False


# ============================================================
# Read CSV
# ============================================================
# The data needed is IMU values (gyro + acc), time_stamps, number of reps, optimal speed zone
file_path = os.path.join(
    os.path.dirname(__file__),
    "siljeFast.csv"
)
TYPE = 'fast' # slow, medium, fast
REPS = 6

data = pd.read_csv(file_path)

# ============================================================
# Separate left and right sensors
# ============================================================
left_data = data[data["sensor"] == "left"].copy()
right_data = data[data["sensor"] == "right"].copy()

left_data = left_data.reset_index(drop=True)
right_data = right_data.reset_index(drop=True)

# ============================================================
# ACCELEROMETER
# ============================================================

x_left = left_data["x"].to_numpy()
y_left = left_data["y"].to_numpy()
z_left = left_data["z"].to_numpy()

t_left = left_data["t"].to_numpy()


x_right = right_data["x"].to_numpy()
y_right = right_data["y"].to_numpy()
z_right = right_data["z"].to_numpy()

t_right = right_data["t"].to_numpy()

# ============================================================
# Raw acceleration magnitude
# ============================================================

magnitude_left_raw = np.sqrt(
    x_left**2 +
    y_left**2 +
    z_left**2
)

magnitude_right_raw = np.sqrt(
    x_right**2 +
    y_right**2 +
    z_right**2
)


# ============================================================
# Time
# ============================================================

t_left_sec = (t_left - t_left[0]) 
t_right_sec = (t_right - t_right[0])

#============================================================
#Data to be used in the fusion filter
#============================================================

gx_left = left_data["gx"].to_numpy()
gy_left = left_data["gy"].to_numpy()
gz_left = left_data["gz"].to_numpy()

gx_right = right_data["gx"].to_numpy()
gy_right = right_data["gy"].to_numpy()
gz_right = right_data["gz"].to_numpy()


# ============================================================
# Sample rate
# ============================================================

sample_rate = 104.0  # Hz

dt_left = 1.0 / sample_rate
dt_right = 1.0 / sample_rate


# ============================================================
# Filter using magdwick filter 
# ============================================================

earth_acceleration_left, magnitude_left_filtered = MagdwickFilter.madgwick_filter(
    x_left,
    y_left,
    z_left,
    gx_left,
    gy_left,
    gz_left,
    dt_left
)
earth_acceleration_right, magnitude_right_filtered = MagdwickFilter.madgwick_filter(
    x_right,
    y_right,
    z_right,
    gx_right,
    gy_right,
    gz_right,
    dt_right
)

# ============================================================
# Calculate velocity using the filtered acceleration
# ============================================================

WINDOW_SIZE = 15

if is_left_better(magnitude_right_filtered, magnitude_left_filtered, t_right_sec, t_left_sec):
    results = VelocityCalculations.calculate_velocity3(
    magnitude_left_filtered, 
    t_left_sec,
    TYPE,
    reps=REPS,
    magnitude_raw=magnitude_left_raw,
    window_size=WINDOW_SIZE
    )
else:
    results = VelocityCalculations.calculate_velocity3(
    magnitude_right_filtered,
    t_right_sec,
    TYPE,
    reps=REPS,
    magnitude_raw=magnitude_right_raw,
    window_size=WINDOW_SIZE
)

average_v = results['average_velocities']
peak_v = results['peak_velocities']


# Print results:
for i in range(len(average_v)):
    print("Average Rep: ", i+1, " average: ", float(average_v[i]), " peak: ", float(peak_v[i]))
    print("----")


data = {
    "average_velocities": pd.Series(average_v),
    "peak_velocities": pd.Series(peak_v),
    "crossings": pd.Series(crossings),
    "velocity": pd.Series(velocity)
}

pd.DataFrame(data).to_json("results.json", orient="columns", indent=4)
