from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import joblib
import pandas as pd

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. Load the model and the historical data into memory on startup
artifact = joblib.load('crop_yield_rf_model.joblib')
model = artifact['model']
model_features = artifact['features']

# Load the master dataset to act as our weather/soil database
df = pd.read_csv('data/master_dataset.csv', dtype={'fips': str})

@app.get("/api/counties")
def get_county_predictions(crop: str, year: int = 2023):
    # 2. Filter the database for the requested crop and year
    scenario_df = df[(df['crop'] == crop) & (df['year'] == year)].copy()
    
    if scenario_df.empty:
        raise HTTPException(status_code=404, detail="No data found for this crop/year combination.")

    # 3. One-hot encode the crop column to match the model's training state
    scenario_encoded = pd.get_dummies(scenario_df, columns=['crop'])
    
    # Ensure all required model features exist (fill missing crop columns with False)
    for col in model_features:
        if col not in scenario_encoded.columns:
            scenario_encoded[col] = False
            
    # 4. Drop counties missing required environmental data for this specific year
    valid_data = scenario_encoded.dropna(subset=model_features).copy()
    
    # 5. Run batch predictions
    predictions = model.predict(valid_data[model_features])
    
    # 6. Format the payload for the React frontend
    results = []
    for i, (_, row) in enumerate(valid_data.iterrows()):
        results.append({
            "fips": row['fips'],
            "county_name": row['county_name'],
            "state_alpha": row['state_alpha'],
            "crop": crop,
            "year": year,
            # Invert yield anomaly so crop loss (negative) becomes a positive Heat Risk score (0-100%)
            "heatRisk": round(max(0, -predictions[i]) / 100, 2), 
            "hotDays": int(row['extreme_heat_days']),
            "droughtWeeks": int(row['weeks_in_d2_plus']),
            "waterStorage": float(row['aws_100cm_mm'])
        })
        
    return results