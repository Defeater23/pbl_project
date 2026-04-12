"""
train_model.py  --  EmoStar improved emotion classifier
========================================================
Key improvements over the naive baseline:

  1. sublinear_tf TF-IDF  -- log(1+tf) normalization (biggest single gain)
  2. LinearSVC             -- gold standard for sparse text; 5-10x faster
                             than LogisticRegression/saga on high-dim data
  3. class_weight=balanced -- corrects for heavy GoEmotions label imbalance
  4. CalibratedClassifierCV-- adds predict_proba() to LinearSVC
  5. Per-label thresholds  -- instead of one global 0.5 cut-off, each of the
                             28 emotions gets its own optimal threshold tuned
                             on a held-out validation set using F1 search.
                             This is the single biggest fix for rare labels.
  6. Threshold saved       -- persisted alongside the model so ml_api.py can
                             use the same per-label thresholds at inference.
"""

import os
import sys
import numpy as np
from pymongo import MongoClient
from dotenv import load_dotenv
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.multioutput import MultiOutputClassifier
from sklearn.svm import LinearSVC
from sklearn.calibration import CalibratedClassifierCV
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import f1_score, hamming_loss, accuracy_score
import joblib
import warnings
warnings.filterwarnings("ignore")

GO_EMOTION_COLUMNS = [
    "admiration", "amusement", "anger", "annoyance", "approval", "caring",
    "confusion", "curiosity", "desire", "disappointment", "disapproval",
    "disgust", "embarrassment", "excitement", "fear", "gratitude", "grief",
    "joy", "love", "nervousness", "optimism", "pride", "realization",
    "relief", "remorse", "sadness", "surprise", "neutral"
]

# ---- Data Loading -----------------------------------------------------------

def load_data():
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

    uri     = os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017/")
    db_name = os.environ.get("MONGODB_DB", "emostar")

    print("[1/6] Connecting to MongoDB at %s  db='%s'..." % (uri, db_name))
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    coll   = client[db_name]["goemotions_samples"]

    print("[2/6] Fetching data from MongoDB...")
    texts, labels_list = [], []
    for doc in coll.find({"source": "goemotions"}):
        texts.append(doc["text"])
        labels_list.append([doc.get("labels", {}).get(c, 0) for c in GO_EMOTION_COLUMNS])

    return texts, labels_list

# ---- Build Pipeline ---------------------------------------------------------

def build_pipeline():
    tfidf = TfidfVectorizer(
        max_features  = 50000,
        ngram_range   = (1, 2),
        sublinear_tf  = True,    # log(1+tf) -- biggest single accuracy boost
        min_df        = 3,
        strip_accents = "unicode",
        analyzer      = "word",
        stop_words    = "english",
    )
    svc = LinearSVC(
        C            = 0.5,
        max_iter     = 2000,
        class_weight = "balanced",   # fixes label imbalance
    )
    calibrated = CalibratedClassifierCV(svc, cv=3, method="sigmoid")
    return Pipeline([
        ("tfidf", tfidf),
        ("clf",   MultiOutputClassifier(calibrated, n_jobs=-1)),
    ])

# ---- Per-label threshold tuning ---------------------------------------------

def tune_thresholds(pipeline, X_val, y_val):
    """
    For each emotion label, search the probability threshold in [0.05, 0.95]
    that maximises F1 on the validation set.
    Default 0.5 collapses all rare labels to zero -- this fixes that.
    """
    print("[5/6] Tuning per-label probability thresholds on validation set...")
    proba = pipeline.predict_proba(X_val)   # list of 28 arrays, shape (N, 2)
    y_val = np.array(y_val)

    thresholds = []
    grid = np.arange(0.05, 0.96, 0.05)

    for i, emotion in enumerate(GO_EMOTION_COLUMNS):
        pos_proba = proba[i][:, 1]          # P(label=1)
        best_t, best_f1 = 0.5, 0.0
        for t in grid:
            preds = (pos_proba >= t).astype(int)
            f1 = f1_score(y_val[:, i], preds, zero_division=0)
            if f1 > best_f1:
                best_f1, best_t = f1, t
        thresholds.append(float(best_t))

    return thresholds

# ---- Evaluate ---------------------------------------------------------------

def evaluate_with_thresholds(pipeline, X_test, y_test, thresholds):
    print("\n[6/6] Final evaluation on held-out 20%% test set...")
    proba  = pipeline.predict_proba(X_test)
    y_test = np.array(y_test)

    # Apply per-label thresholds
    y_pred = np.zeros_like(y_test)
    for i in range(len(GO_EMOTION_COLUMNS)):
        pos_proba = proba[i][:, 1]
        y_pred[:, i] = (pos_proba >= thresholds[i]).astype(int)

    micro_f1  = f1_score(y_test, y_pred, average="micro",   zero_division=0)
    macro_f1  = f1_score(y_test, y_pred, average="macro",   zero_division=0)
    sample_f1 = f1_score(y_test, y_pred, average="samples", zero_division=0)
    h_loss    = hamming_loss(y_test, y_pred)
    exact_acc = accuracy_score(y_test, y_pred)

    print("\n" + "=" * 60)
    print("   IMPROVED MODEL -- FINAL EVALUATION (per-label thresholds)")
    print("=" * 60)
    print("  Micro  F1    : %.4f   (overall label accuracy)" % micro_f1)
    print("  Macro  F1    : %.4f   (avg per emotion class)"  % macro_f1)
    print("  Sample F1    : %.4f   (avg per sample)"         % sample_f1)
    print("  Hamming Loss : %.4f   (lower = better)"         % h_loss)
    print("  Exact Match  : %.4f   (all labels correct)"     % exact_acc)
    print("=" * 60)

    print("\n  Per-emotion F1 scores (best to worst):")
    print("  %-18s %6s  %5s  %s" % ("Emotion", "F1", "Thr", "Bar"))
    print("  " + "-" * 50)
    per_label_f1 = f1_score(y_test, y_pred, average=None, zero_division=0)
    rows = sorted(zip(GO_EMOTION_COLUMNS, per_label_f1, thresholds),
                  key=lambda x: -x[1])
    for emotion, score, thr in rows:
        bar  = "#" * int(score * 25)
        mark = "[OK]" if score >= 0.5 else ("[~]" if score >= 0.3 else "[X]")
        print("  %-18s %.4f  %.2f  %-4s  %s" % (emotion, score, thr, mark, bar))
    print("=" * 60)
    print("\n  Per-label thresholds saved alongside model for ml_api.py")

# ---- Main -------------------------------------------------------------------

def train_and_save():
    texts, labels = load_data()

    if not texts:
        print("No training data found. Run import_goemotions.py first.")
        sys.exit(1)

    print("\n[3/6] Loaded %s samples -> splitting 70/10/20 train/val/test..." % f"{len(texts):,}")
    # First split off 20% test
    X_tmp, X_test, y_tmp, y_test = train_test_split(
        texts, labels, test_size=0.2, random_state=42
    )
    # Then split remaining into 87.5/12.5 -> approx 70/10 of total
    X_train, X_val, y_train, y_val = train_test_split(
        X_tmp, y_tmp, test_size=0.125, random_state=42
    )
    print("      Train: %s  |  Val: %s  |  Test: %s" % (
        f"{len(X_train):,}", f"{len(X_val):,}", f"{len(X_test):,}"
    ))

    print("\n[4/6] Building & training pipeline (LinearSVC + calibration)...")
    print("      (sublinear TF-IDF 50K + balanced class weights + calibrated SVM)")
    pipeline = build_pipeline()
    pipeline.fit(X_train, y_train)
    print("      [OK] Training complete!")

    thresholds = tune_thresholds(pipeline, X_val, y_val)

    evaluate_with_thresholds(pipeline, X_test, y_test, thresholds)

    # Save both model and thresholds
    data_dir  = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "server", "data")
    )
    os.makedirs(data_dir, exist_ok=True)
    model_path     = os.path.join(data_dir, "emotion_model.joblib")
    threshold_path = os.path.join(data_dir, "emotion_thresholds.joblib")

    joblib.dump(pipeline,    model_path,     compress=3)
    joblib.dump({"thresholds": thresholds, "labels": GO_EMOTION_COLUMNS},
                threshold_path, compress=3)

    print("\n[DONE] Model saved     -> %s" % model_path)
    print("[DONE] Thresholds saved -> %s" % threshold_path)

if __name__ == "__main__":
    train_and_save()
