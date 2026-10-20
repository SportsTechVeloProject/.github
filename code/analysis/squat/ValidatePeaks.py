import pandas as pd
import numpy as np
import os
from scipy.signal import find_peaks
import matplotlib.pyplot as plt
from scipy.integrate import cumulative_trapezoid


# ============================================================
# Filter false peaks 
# ============================================================

def validate_peaks(signal, peaks, sample_rate):
    valid_peaks = []

    # Number of samples to inspect before/after peak
    BEFORE_TIME = 0.05      # seconds
    AFTER_TIME = 0.05        # seconds

    BEFORE_SAMPLES = int(BEFORE_TIME * sample_rate)
    AFTER_SAMPLES = int(AFTER_TIME * sample_rate)

    for peak in peaks:

        # Make sure we have enough data around the peak
        if peak < BEFORE_SAMPLES:
            continue

        if peak + AFTER_SAMPLES >= len(signal):
            continue

        # Values before and after peak
        before = signal[
            peak - BEFORE_SAMPLES:peak
        ]

        after = signal[
            peak + 1:peak + AFTER_SAMPLES
        ]

        peak_value = signal[peak]


        before_range = np.max(before) - np.min(before)
        after_range = np.max(after) - np.min(after)


        baseline = np.mean(
            np.concatenate([
                before[-5:],
                after[:5]
            ])
        )

        peak_height = peak_value - baseline


        before_diff = np.diff(before)
        after_diff = np.diff(after)

        max_change_before = np.max(np.abs(before_diff))
        max_change_after = np.max(np.abs(after_diff))

        # ----------------------------------------------------
        # Thresholds
        # ----------------------------------------------------

        MIN_PEAK_HEIGHT = -5.0

        MAX_CHANGE_BEFORE = 3.0
        MAX_CHANGE_AFTER = 3.0

        # ----------------------------------------------------
        # Validate peak
        # ----------------------------------------------------

        if (
            peak_height > MIN_PEAK_HEIGHT
            and max_change_before < MAX_CHANGE_BEFORE
            and max_change_after < MAX_CHANGE_AFTER
        ):

            valid_peaks.append(peak)

    return np.array(valid_peaks)
