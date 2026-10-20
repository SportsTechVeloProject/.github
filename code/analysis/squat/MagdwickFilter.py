import pandas as pd
import numpy as np

import imufusion
from scipy.signal import find_peaks
import matplotlib.pyplot as plt
from scipy.integrate import cumulative_trapezoid
import ValidatePeaks as ValidatePeaks

def madgwick_filter(
    x,
    y,
    z,
    gx,
    gy,
    gz,
    dt,
    gain=0.5,
    acceleration_rejection=10,
    magnetic_rejection=10,
    rejection_timeout=5
):
    # ========================================================
    # Create AHRS filter
    # ========================================================

    ahrs = imufusion.Ahrs()

    # ========================================================
    # Configure AHRS / Madgwick settings
    # ========================================================

    settings = imufusion.AhrsSettings()

    settings.convention = imufusion.CONVENTION_NWU
    settings.gain = gain
    settings.acceleration_rejection = acceleration_rejection
    settings.magnetic_rejection = magnetic_rejection
    settings.rejection_timeout = rejection_timeout

    ahrs.set_settings(settings)

    # ========================================================
    # Store earth-frame acceleration
    # ========================================================

    earth_acceleration = []

    # ========================================================
    # Run filter
    # ========================================================

    for i in range(len(x)):

        # ----------------------------------------------------
        # Accelerometer
        # ----------------------------------------------------

        accel = np.array([
            x[i],
            y[i],
            z[i]
        ])

        # ----------------------------------------------------
        # Gyroscope
        # ----------------------------------------------------

        gyro = np.array([
            gx[i],
            gy[i],
            gz[i]
        ])

        # ----------------------------------------------------
        # Update AHRS
        # No magnetometer is used
        # ----------------------------------------------------

        ahrs.update_no_magnetometer(
            gyro,
            accel,
        )

        # ----------------------------------------------------
        # Get acceleration in earth frame
        # ----------------------------------------------------

        earth_acceleration.append(
            ahrs.get_earth_acceleration()
        )

    # ========================================================
    # Convert results to NumPy array
    # ========================================================

    earth_acceleration = np.array(
        earth_acceleration
    )

    # ========================================================
    # Calculate acceleration magnitude
    # ========================================================

    magnitude = np.sqrt(
        earth_acceleration[:, 0] ** 2 +
        earth_acceleration[:, 1] ** 2 +
        earth_acceleration[:, 2] ** 2
    )

    # ========================================================
    # Return results
    # ========================================================

    return earth_acceleration, magnitude