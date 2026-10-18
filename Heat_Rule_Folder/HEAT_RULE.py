from enum import IntEnum

class HeatLevel(IntEnum):
    COLD = 1
    COOL = 2
    COMFORTABLE = 3 # --// Perfect
    HOT = 4
    EXTREME_HEAT = 5

# --// The defined temperature definitons
CENTERS = {
    HeatLevel.COLD: 10.0,          # 10 C or colder: fully "cold"
    HeatLevel.COOL: 17.0,
    HeatLevel.COMFORTABLE: 24.0,   # 24 C (75 F): the perfect middle
    HeatLevel.HOT: 31.0,
    HeatLevel.EXTREME_HEAT: 38.0,  # 38 C or hotter: fully "extreme heat"
}

# Normalized scale: 0% at the first center (10 C), 100% at the last center (38 C).
# Comfortable (24 C) therefore sits at exactly 50%.
SCALE_MIN = CENTERS[HeatLevel.COLD]
SCALE_MAX = CENTERS[HeatLevel.EXTREME_HEAT]

def memberships(temp_c):
    levels = list(HeatLevel)                      # [COLD, COOL, COMFORTABLE, HOT, EXTREME_HEAT]
    centers = [CENTERS[lv] for lv in levels]      # [10, 17, 24, 31, 38], same order as levels
    result = {lv: 0.0 for lv in levels}           # start every level at 0%

    if temp_c <= centers[0]:
        # Colder than the Cold peak: nothing colder to blend with -> fully Cold.
        result[levels[0]] = 1.0
    elif temp_c >= centers[-1]:
        # Hotter than the Extreme Heat peak: nothing hotter to blend with -> fully Extreme.
        result[levels[-1]] = 1.0
    else:
        # Find the pair of neighbouring peaks the temperature sits between.
        for i in range(len(centers) - 1):
            low, high = centers[i], centers[i + 1]
            if low <= temp_c <= high:
                # How far across the gap are we? 0 = right on the lower peak, 1 = right on the upper.
                share_high = (temp_c - low) / (high - low)
                result[levels[i]] = 1.0 - share_high   # lower level fades out...
                result[levels[i + 1]] = share_high     # ...as the upper level fades in
                break
    return result

def heat_rule(temp_c):
    """Run the fuzzy heat rule on one temperature (C). Returns a dictionary."""
    if temp_c is None or temp_c != temp_c:  # None or NaN
        raise ValueError("temperature is required")
    temp_c = float(temp_c)

    m = memberships(temp_c)
    # Main level = the one with the highest percentage; an exact tie goes to the higher level.
    dominant = max(m, key=lambda lv: (m[lv], lv))

    # Position on the 0-100% scale: how far from SCALE_MIN toward SCALE_MAX, capped at both ends.
    position = (temp_c - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)
    position = min(1.0, max(0.0, position))

    return {
        "temp_c": round(temp_c, 2),
        "level": dominant.name,
        "level_number": int(dominant),
        #"scale_position_pct": round(position * 100, 1),
        "memberships_pct": {lv.name: round(v * 100, 1) for lv, v in m.items()},
    }

def _label(name):
    return name.replace("_", " ").title()

def describe(temp_c):
    """Run the rule and return a short, readable result."""
    r = heat_rule(temp_c)
    parts = [f"{_label(name)} {pct:g}%"
             for name, pct in r["memberships_pct"].items() if pct > 0]
    return (
        f"Temperature:  {r['temp_c']:g} C\n"
        f"Level:        {_label(r['level'])} (level {r['level_number']} of 5)\n"
        #f"Scale:        {r['scale_position_pct']:g}%  (0% = cold, 50% = comfortable, 100% = extreme heat)\n"
        f"Breakdown:    {' | '.join(parts)}"
    )

if __name__ == "__main__":
    # Usage:  python heat_rule.py 34.8      (or run with no number and type it in)
    import sys
    raw = sys.argv[1] if len(sys.argv) > 1 else input("enter a number in celsius bruh, this is for new castle county & corn:")
    try:
        print(describe(float(raw)))
    except ValueError:
        print("bro enter a real number bruh")