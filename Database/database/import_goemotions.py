"""
Download GoEmotions (Kaggle: debarshichanda/goemotions) via kagglehub and import into MongoDB.

Prerequisites:
  - MongoDB running and reachable (e.g. mongodb://127.0.0.1:27017/)
  - Kaggle API credentials for kagglehub (see https://www.kaggle.com/docs/api)

Usage (from repo root or database/):
  pip install -r database/requirements.txt
  copy database\\.env.example database\\.env   # then edit if needed
  python database/import_goemotions.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import kagglehub
import pandas as pd
from dotenv import load_dotenv
from pymongo import MongoClient, ASCENDING
from pymongo.errors import PyMongoError

# Official GoEmotions taxonomy (27 emotions + neutral), column names in released CSVs
GO_EMOTION_COLUMNS = [
    "admiration",
    "amusement",
    "anger",
    "annoyance",
    "approval",
    "caring",
    "confusion",
    "curiosity",
    "desire",
    "disappointment",
    "disapproval",
    "disgust",
    "embarrassment",
    "excitement",
    "fear",
    "gratitude",
    "grief",
    "joy",
    "love",
    "nervousness",
    "optimism",
    "pride",
    "realization",
    "relief",
    "remorse",
    "sadness",
    "surprise",
    "neutral",
]


def load_env() -> None:
    here = Path(__file__).resolve().parent
    load_dotenv(here / ".env")
    load_dotenv(here.parent / ".env")


def dataset_dir() -> Path:
    path = kagglehub.dataset_download("debarshichanda/goemotions")
    p = Path(path)
    print("Path to dataset files:", p)
    return p


def find_csv_files(root: Path) -> list[Path]:
    return sorted(root.rglob("*.csv"))


def emotion_columns_present(df: pd.DataFrame) -> list[str]:
    cols = {c.lower(): c for c in df.columns}
    out: list[str] = []
    for name in GO_EMOTION_COLUMNS:
        key = name.lower()
        if key in cols:
            out.append(cols[key])
    return out


def row_to_doc(row: dict, emotion_cols: list[str], text_col: str) -> dict | None:
    text = row.get(text_col)
    if text is None or (isinstance(text, float) and pd.isna(text)):
        return None
    text = str(text).strip()
    if not text:
        return None

    labels: dict[str, int] = {}
    active: list[str] = []
    for c in emotion_cols:
        v = row.get(c, 0)
        try:
            iv = int(float(v))
        except (TypeError, ValueError):
            iv = 0
        labels[c.lower()] = iv
        if iv == 1:
            active.append(c.lower())

    doc: dict = {
        "source": "goemotions",
        "text": text,
        "emotions": sorted(active),
        "labels": labels,
    }
    # carry common metadata if present
    for meta in (
        "id",
        "author",
        "subreddit",
        "created_utc",
        "rater_id",
        "example_id",
        "example_very_unclear",
    ):
        for key in row:
            if key and key.lower() == meta:
                doc[meta] = row[key]
                break
    return doc


def pick_text_column(df: pd.DataFrame) -> str | None:
    for candidate in ("text", "comment", "sentence", "content"):
        for c in df.columns:
            if c.lower() == candidate:
                return c
    return None


def import_csvs(
    client: MongoClient,
    db_name: str,
    csv_paths: list[Path],
    limit_per_file: int | None,
) -> int:
    db = client[db_name]
    coll = db["goemotions_samples"]
    coll.drop_indexes()
    coll.delete_many({"source": "goemotions"})

    total = 0
    for csv_path in csv_paths:
        print(f"Reading {csv_path} ...")
        df = pd.read_csv(csv_path, low_memory=False)
        text_col = pick_text_column(df)
        if not text_col:
            print(f"  Skip (no text column): columns={list(df.columns)}")
            continue
        emotion_cols = emotion_columns_present(df)
        if not emotion_cols:
            print(f"  Skip (no known emotion columns): columns={list(df.columns)}")
            continue

        batch: list[dict] = []
        n = 0
        for _, row in df.iterrows():
            if limit_per_file is not None and n >= limit_per_file:
                break
            doc = row_to_doc(row.to_dict(), emotion_cols, text_col)
            if doc:
                batch.append(doc)
                n += 1
            if len(batch) >= 2000:
                coll.insert_many(batch, ordered=False)
                total += len(batch)
                batch.clear()
        if batch:
            coll.insert_many(batch, ordered=False)
            total += len(batch)
        print(f"  Imported {n} rows from {csv_path.name}")

    coll.create_index([("text", ASCENDING)])
    coll.create_index([("emotions", ASCENDING)])
    coll.create_index([("source", ASCENDING)])
    print(f"Done. Total documents in goemotions_samples: {coll.count_documents({})}")
    return total


def main() -> int:
    load_env()
    uri = os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017/")
    db_name = os.environ.get("MONGODB_DB", "emostar")
    limit_raw = os.environ.get("IMPORT_LIMIT", "").strip()
    limit_per_file: int | None = int(limit_raw) if limit_raw else None

    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=8000)
        client.admin.command("ping")
    except PyMongoError as e:
        print(f"MongoDB connection failed: {e}", file=sys.stderr)
        print(
            "Tip: start MongoDB locally (e.g. `docker compose -f database/docker-compose.yml up -d`) "
            "or set MONGODB_URI to your Atlas connection string.",
            file=sys.stderr,
        )
        return 1

    root = dataset_dir()
    csvs = find_csv_files(root)
    if not csvs:
        print("No CSV files found under dataset path.", file=sys.stderr)
        client.close()
        return 1

    import_csvs(client, db_name, csvs, limit_per_file)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
