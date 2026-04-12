import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import express from "express";
import { MongoClient } from "mongodb";

import {
  analyzeWithLexicon,
  defaultLexiconPath,
  loadEmotionWordIndex,
} from "./goemotionsLexicon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", "database", ".env") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/";
const MONGODB_DB = process.env.MONGODB_DB || "emostar";
const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, "..");

/** @type {Map<string, Array<{ emotion: string, weight: number }>> | null} */
let goEmotionWordIndex = null;
const lexiconPath = defaultLexiconPath(ROOT);
if (fs.existsSync(lexiconPath)) {
  goEmotionWordIndex = loadEmotionWordIndex(lexiconPath);
  console.log(`GoEmotions lexicon: ${lexiconPath} (${goEmotionWordIndex.size} words)`);
} else {
  console.warn(`GoEmotions lexicon not found at ${lexiconPath}`);
}

let mongoClient;
let db;
/** @type {Promise<import("mongodb").Db> | null} */
let connectPromise = null;

function toPublicEntry(doc) {
  return {
    id: doc.clientId,
    text: doc.text,
    date: doc.date,
    timestamp: doc.timestamp,
    ...(doc.analysis ? { analysis: doc.analysis } : {}),
  };
}

async function ensureMongo() {
  if (db) return db;
  if (!connectPromise) {
    connectPromise = (async () => {
      mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
      await mongoClient.connect();
      const d = mongoClient.db(MONGODB_DB);
      await d.collection("journal_entries").createIndex({ timestamp: -1 });
      await d.collection("journal_entries").createIndex({ clientId: 1 });
      db = d;
      return d;
    })().catch(async (err) => {
      try {
        await mongoClient?.close();
      } catch {
        /* ignore */
      }
      mongoClient = undefined;
      db = undefined;
      connectPromise = null;
      throw err;
    });
  }
  return connectPromise;
}

async function getCollection() {
  const d = await ensureMongo();
  return d.collection("journal_entries");
}

const app = express();
app.use(express.json({ limit: "512kb" }));

// Allow GoEmotions + journal API when the page is opened as a file:// URL or from another dev port (Live Preview).
app.use("/api", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/api/health", async (_req, res) => {
  try {
    const d = await ensureMongo();
    await d.command({ ping: 1 });
    res.json({ ok: true, mongo: true, db: MONGODB_DB });
  } catch {
    res.status(503).json({ ok: false, mongo: false, db: MONGODB_DB });
  }
});

app.get("/api/journal-entries", async (_req, res) => {
  try {
    const col = await getCollection();
    const docs = await col
      .find({})
      .sort({ timestamp: -1 })
      .limit(500)
      .toArray();
    res.json(docs.map(toPublicEntry));
  } catch (e) {
    res.status(503).json({ error: String(e.message || e) });
  }
});

app.post("/api/goemotions-analyze", async (req, res) => {
  const text = req.body?.text;
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text is required" });
    return;
  }

  try {
    // Forward the text to the local Python ML API running on port 5000
    const mlResponse = await fetch("http://127.0.0.1:5000/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    });

    if (!mlResponse.ok) {
      throw new Error(`ML server error: ${await mlResponse.text()}`);
    }

    const result = await mlResponse.json();
    res.json(result);
  } catch (e) {
    console.error("ML Bot prediction failed:", e);

    // Detailed error to help the UI inform the user
    res.status(503).json({ error: "ml_bot_unavailable", message: String(e.message || e) });
  }
});

app.post("/api/journal-entries", async (req, res) => {
  try {
    const { id, text, date, timestamp, analysis } = req.body || {};
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "text is required" });
      return;
    }
    const clientId = typeof id === "number" ? id : Number(id) || Date.now();
    const doc = {
      clientId,
      text: text.trim(),
      date: typeof date === "string" ? date : new Date().toISOString(),
      timestamp: typeof timestamp === "number" ? timestamp : Date.now(),
      analysis: analysis && typeof analysis === "object" ? analysis : null,
    };
    const col = await getCollection();
    await col.insertOne(doc);
    res.status(201).json(toPublicEntry(doc));
  } catch (e) {
    res.status(503).json({ error: String(e.message || e) });
  }
});

app.use(express.static(ROOT));

app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    res.status(404).json({ error: "api_not_found", path: req.path });
    return;
  }
  res.sendFile(path.join(ROOT, "index.html"));
});

/** @type {import('http').Server | undefined} */
let httpServer;
const MAX_PORT_TRIES = 30;

function listenFrom(port, triesLeft) {
  if (triesLeft <= 0) {
    console.error(
      `No free port found between ${PORT} and ${PORT + MAX_PORT_TRIES - 1}. Close another app using that range or set PORT in server/.env.`,
    );
    process.exit(1);
    return;
  }
  const server = app.listen(port, () => {
    httpServer = server;
    console.log(`EmoStar site + API at http://127.0.0.1:${port}`);
    if (port !== PORT) {
      console.warn(`(Port ${PORT} was busy; using ${port} instead.)`);
    }
    console.log(`MongoDB "${MONGODB_DB}" connects on first API request (${MONGODB_URI})`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      try {
        server.close();
      } catch {
        /* ignore */
      }
      console.warn(`Port ${port} is already in use, trying ${port + 1}...`);
      listenFrom(port + 1, triesLeft - 1);
      return;
    }
    console.error(err);
    process.exit(1);
  });
}

listenFrom(PORT, MAX_PORT_TRIES);

process.on("SIGINT", async () => {
  try {
    await new Promise((resolve) => {
      if (httpServer) httpServer.close(() => resolve());
      else resolve();
    });
    await mongoClient?.close();
  } finally {
    process.exit(0);
  }
});
