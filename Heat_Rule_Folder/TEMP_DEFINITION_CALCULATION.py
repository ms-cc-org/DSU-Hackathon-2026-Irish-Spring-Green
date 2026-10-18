import NewCastleCountyInfo

temp_avg = 0
extreme_heatdays_avg = 0

OPTIMAL_CROP_TEMPS = {
    # --// In Celsius
    'Corn': 28.3,
    'Soybeans': 27.5
}

for yearinfo in NewCastleCountyInfo.NEW_CASTLE_DATA['CORN'].items():
    year_average_temperature = yearinfo[1]['tavg_c']
    year_heatdays_avg = yearinfo[1]['extreme_heat_days']

    temp_avg += year_average_temperature
    extreme_heatdays_avg += year_heatdays_avg

temp_avg /= len(NewCastleCountyInfo.NEW_CASTLE_DATA['CORN'])
extreme_heatdays_avg /= len(NewCastleCountyInfo.NEW_CASTLE_DATA['CORN'])

# print(len(NewCastleCountyInfo.NEW_CASTLE_DATA['CORN']))
print(f'temp_avg: {temp_avg}')
print(f'optimal corn temp: {OPTIMAL_CROP_TEMPS['Corn']}')
print(f'optimal soybean temp: {OPTIMAL_CROP_TEMPS['Soybeans']}')
print(f'extreme_heat_avg: {extreme_heatdays_avg}')


OPTIMAL_CROP_TEMPS = {
    "Corn": 28.3,
    "Soybeans": 27.5,
}

COUNTY_AVG_TEMP = 21.8721
COUNTY_EXTREME_HEAT_DAYS = 3.1053

def calculate_centers(crop):
    optimal = OPTIMAL_CROP_TEMPS[crop]

    # Use both historical county climate variables
    climate_shift = optimal - COUNTY_AVG_TEMP
    heat_shift = COUNTY_EXTREME_HEAT_DAYS / 10.0

    return {
        'COLD': round(COUNTY_AVG_TEMP - 12.0, 1),
        'COOL': round(COUNTY_AVG_TEMP - 5.0, 1),
        'COMFORTABLE': round(optimal, 1),
        'HOT': round(optimal + 7.0 - heat_shift, 1),
        'EXTREME_HEAT': round(optimal + 14.0 - heat_shift, 1),
    }


CENTERS = calculate_centers("Corn")