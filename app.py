import streamlit as st
import plotly.express as px
from src.data_loader import load_master



st.set_page_config(
    page_title="Crop Shield",
    page_icon="🌽",
    layout="wide",
)



from src.ui.heat_map import render_advisory
#from src.ui.soil_map import render_soil_context
#from src.ui.county_report import render_county_report
#from src.ui.validation import render_validation

# Data

@st.cache_data
def get_data():
    return load_master()


df = get_data()

# Page config
# st.set_page_config(
#     page_title="Crop Shield",
#     page_icon=":ear_of_corn:",
#     layout="wide",
# )
st.title("Crop Shield")
#st.caption("DSU Hackathon, October 17-18, 2026 * One row = one county, one crop, one year")


# Sidebar filters
st.sidebar.header("Filters")

states = st.sidebar.multiselect(
    "State",
    options=sorted(df["state_alpha"].unique()),
    default=sorted(df["state_alpha"].unique()),
)

crops = st.sidebar.multiselect(
    "Crop",
    options=sorted(df["crop"].unique()),
    default=["CORN"],
)

year_min, year_max = st.sidebar.slider(
    "Year range",
    min_value=int(df["year"].min()),
    max_value=int(df["year"].max()),
    value=(2000, 2025),
)

# Apply filters
filtered = df[
    (df["state_alpha"].isin(states))
    & (df["crop"].isin(crops))
    & (df["year"].between(year_min, year_max))
]

st.sidebar.metric("Rows selected", f"{len(filtered):,}")

# Tabs

tab_overview, tab_heat, tab_soil, tab_county_report = st.tabs(
    ["Overview", "Heat Stress Map", "Soil Water Storage Map", "County Report"]
)

# Tab 1: Overview
# This is a working demo. Use it as a pattern for the other features to develop

with tab_overview:
    st.subheader("Dataset overview")

    col1, col2, col3 = st.columns(3)
    col1.metric("Counties", filtered["fips"].nunique())
    col2.metric("Crops", filtered["crop"].nunique())
    col3.metric("Year span", f"{year_min}–{year_max}")

    # Yield time series — one working chart as the template
    st.subheader("Yield over time")

    reported = filtered[filtered["yield_status"] == "reported"]

    if len(reported) > 0:
        state_yield = (reported.groupby(["state_alpha", "crop", "year"], as_index=False).agg(mean_yield=("yield_per_acre", "mean")))

        fig = px.line(
            state_yield,
            x="year",
            y="mean_yield",
            color="state_alpha",
            facet_col="crop",
            labels={
                "mean_yield": "Mean yield (bu/acre)",
                "year": "Year",
                "state_alpha": "State",
            },
        )
        fig.update_layout(height=400)
        st.plotly_chart(fig, width="stretch")
    else:
        st.info("No reported yields for this selection.")


# Tab 2: Heat Stress - Include Heat risk Score and how we got there

with tab_heat:
    render_advisory()
    #st.subheader("Weather & Yield")
    #st.write("Explore how precipitation, temperature, GDD, and extreme heat relate to crop yield.")

    # TODO: Your weather analysis here


# Tab 3: Include prioritization

with tab_soil:
    st.subheader("Drought Analysis")
    st.write("Investigate how drought severity and duration affect yields.")

    # TODO: Your drought analysis here

# Tab 4: Soil & Risk

with tab_county_report:
    st.subheader("Soil & Risk")
    st.write("Separate what the soil determines from what the weather determines.")
    # TODO: Your soil and risk analysis here