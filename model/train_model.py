import pandas as pd
import joblib
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, root_mean_squared_error, r2_score

def main():
    print("Step 1: Loading and preprocessing data...")
    # Load data, ensuring FIPS codes remain strings to preserve leading zeros
    df = pd.read_csv('data/master_dataset.csv', dtype={'fips': str})
    
    # Define our core features and target
    base_features = ['tavg_c', 'extreme_heat_days', 'precip_anomaly_pct', 'mean_dsci', 'aws_100cm_mm']
    target = 'yield_anomaly_pct'
    
    # Drop rows missing any of our required columns
    df_clean = df.dropna(subset=base_features + [target, 'year', 'crop']).copy()
    
    # One-hot encode the 'crop' column so the model understands crop-specific biological thresholds
    df_encoded = pd.get_dummies(df_clean, columns=['crop'], drop_first=True)
    
    # Capture the exact feature column names used for training (needed for the Streamlit app later)
    model_features = base_features + [col for col in df_encoded.columns if col.startswith('crop_')]

    print("Step 2: Performing chronological split (Train: 2000-2018, Test: 2019-2025)...")
    train_df = df_encoded[df_encoded['year'] <= 2018]
    test_df = df_encoded[df_encoded['year'] >= 2019]

    X_train = train_df[model_features]
    y_train = train_df[target]
    
    X_test = test_df[model_features]
    y_test = test_df[target]

    print(f"Training samples: {len(X_train)} | Testing samples: {len(X_test)}")

    print("Step 3: Training Random Forest Regressor...")
    # n_estimators=100; random_state ensures reproducibility
    rf_model = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
    rf_model.fit(X_train, y_train)

    print("Step 4: Predicting and Validating on unseen data...")
    y_pred = rf_model.predict(X_test)
    
    mae = mean_absolute_error(y_test, y_pred)
    rmse = root_mean_squared_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)
    
    print("\n--- Model Performance (2019-2025) ---")
    print(f"Mean Absolute Error (MAE): {mae:.2f}%")
    print(f"Root Mean Squared Error (RMSE): {rmse:.2f}%")
    print(f"R-squared (R2): {r2:.3f}")

    print("\nStep 5: Extracting Feature Importance & Saving Model...")
    importances = pd.Series(rf_model.feature_importances_, index=model_features).sort_values(ascending=False)
    print("Feature Importances:\n", importances)

    # Save the trained model and the expected feature layout
    artifact = {
        'model': rf_model,
        'features': model_features
    }
    joblib.dump(artifact, 'crop_yield_rf_model.joblib')
    
    print("\nModel saved successfully as 'crop_yield_rf_model.joblib'.")

if __name__ == "__main__":
    main()