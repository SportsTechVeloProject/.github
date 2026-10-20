import pandas as pd
import numpy as np
from scipy.signal import find_peaks
import matplotlib.pyplot as plt
from scipy.integrate import cumulative_trapezoid
import ValidatePeaks as ValidatePeaks

# Different zone thresholds
threshold_dict = {
    'slow' : [3, 208],
    'medium': [2, 208],
    'fast': [3, 208]
}

def peak_detect(velocity, start, stop, reps, type):
    speed = 3.0
    peaks, peak_info = find_peaks(velocity[start:stop], height=speed, distance=threshold_dict[type][1])
    i = 0
    while(len(peaks) < reps):
        speed = speed - 0.01
        peaks, peak_info = find_peaks(velocity[start:stop], height=speed, distance=threshold_dict[type][1])
        i += 1
    print(i)
    if(len(peaks) > reps):
        peaks = peaks[:-1]
    return peaks + start, peak_info

def find_drift(velocity, t_sec, magnitude_raw, type):
    Treshold = threshold_dict[type][0] * np.mean(magnitude_raw)
    start_index = 520
    indexes, _ = find_peaks(magnitude_raw[start_index:], height=Treshold)
    print(indexes)

    stop_index = indexes[-1]

    stop_index =  start_index + stop_index - 208
    print("stop", stop_index)
    
    #k, m = np.polyfit(t_sec[start:stop], velocity[start:stop], 1)
    end = np.mean(velocity[stop_index-208:stop_index])
    start = np.mean(velocity[52:260])

    k = (end - start) / (t_sec[stop_index-104] - t_sec[156])

    return k, start, start_index, stop_index

   

def calculate_velocity3(magnitude_filtered, t_sec, type, reps, magnitude_raw, window_size=7):
    all_repetition_acceleration = []
    all_repetition_time = []
    all_repetition_velocity = []

    average_velocities = []

    # Filter acceleration with moving average:
    magnitude_filtered = np.convolve(magnitude_filtered, np.ones(window_size) / window_size, 'same') 

    #Average of the acceleration on 1-2s
    mean_acceleration = np.mean(magnitude_filtered[104:208])


    # Calculate the velocity by integration
    velocity = cumulative_trapezoid(magnitude_filtered - mean_acceleration, t_sec, initial=0)

    # Assume the drift is linear.
    k, m, start_index, stop_index = find_drift(velocity, t_sec, magnitude_raw, type)
    y = k*t_sec + m
    diff = velocity - y
    print("Stop index", stop_index)

    peaks, peak_info = peak_detect(diff, start_index, stop_index, reps, type)
    
    if (type == 'fast'):
        
        ind = peaks[0] - 416
        velocity = velocity[ind:]
        t_sec = t_sec[ind:]
        t_sec = t_sec - t_sec[0]
        k, m, start_index, stop_index = find_drift(velocity, t_sec, magnitude_raw[ind:], type)
        y = k*t_sec #+ m
        diff = velocity - y
        peaks, peak_info = peak_detect(diff, 0, stop_index, reps, type)
    for peak in peaks:
        start = peak
        end = peak
        while(diff[start] > 0):
            start -= 1
        while(diff[end] > 0):
            end += 1
        mean_v = np.mean(diff[start:end])
        average_velocities.append(mean_v)
    
    plt.plot(t_sec, y)
    plt.plot(t_sec, velocity)
    plt.plot(t_sec[peaks], diff[peaks], 'x', markersize=10)
    plt.plot(t_sec, diff)
    plt.show()
       
    return {
        "all_acceleration": all_repetition_acceleration,
        "all_time": all_repetition_time,
        "all_velocity": all_repetition_velocity,
        "average_velocities": average_velocities,
        "peak_velocities": peak_info['peak_heights'],
    }

