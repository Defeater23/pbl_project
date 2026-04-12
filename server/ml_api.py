import os
import joblib
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="EmoStar ML Bot API")

# Allow CORS for easy testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalyzeRequest(BaseModel):
    text: str

model_path = os.path.join(os.path.dirname(__file__), 'data', 'emotion_model.joblib')
pipeline = None

# Official GoEmotions labels
GO_EMOTION_COLUMNS = [
    "admiration", "amusement", "anger", "annoyance", "approval", "caring",
    "confusion", "curiosity", "desire", "disappointment", "disapproval", 
    "disgust", "embarrassment", "excitement", "fear", "gratitude", "grief",
    "joy", "love", "nervousness", "optimism", "pride", "realization",
    "relief", "remorse", "sadness", "surprise", "neutral"
]

POSITIVE = {"admiration", "amusement", "approval", "caring", "excitement", "gratitude", "joy", "love", "optimism", "pride", "relief", "desire", "curiosity"}
NEGATIVE = {"anger", "annoyance", "disappointment", "disapproval", "disgust", "embarrassment", "fear", "grief", "nervousness", "remorse", "sadness"}

@app.on_event("startup")
def load_model():
    global pipeline
    if os.path.exists(model_path):
        print(f"Loading emotion ML bot from {model_path}...")
        pipeline = joblib.load(model_path)
        print("ML Bot is online and listening on port 5000.")
    else:
        print("WARNING: Model not found! Run train_model.py first.")

@app.post("/predict")
def predict_emotion(req: AnalyzeRequest):
    if pipeline is None:
        return {"error": "machine_learning_model_missing"}
        
    text = req.text.strip()
    if not text:
        return {"error": "text is required"}
        
    # Get probabilities from the ML pipeline
    probas = pipeline.predict_proba([text])
    
    emotions = {}
    for i, col in enumerate(GO_EMOTION_COLUMNS):
        class_probas = probas[i][0]
        # class_probas[1] represents probability of the positive class for this label
        if len(class_probas) > 1:
            emotions[col] = int(round(class_probas[1] * 100))
        else:
            emotions[col] = 0
            
    # Find dominant emotion
    non_neutral = {k: v for k, v in emotions.items() if k != "neutral"}
    dominant = max(non_neutral, key=non_neutral.get) if non_neutral else "neutral"
    
    if emotions.get(dominant, 0) == 0:
        dominant = "neutral"
        emotions["neutral"] = 100
        
    pos_score = sum(emotions[e] for e in POSITIVE if e in emotions)
    neg_score = sum(emotions[e] for e in NEGATIVE if e in emotions)
    
    sentiment = "neutral"
    if pos_score > neg_score * 1.15:
        sentiment = "positive"
    elif neg_score > pos_score * 1.15:
        sentiment = "negative"
        
    return {
        "emotions": emotions,
        "dominant": dominant,
        "sentiment": sentiment,
        "source": "ml_bot_pipeline"
    }

if __name__ == "__main__":
    uvicorn.run("ml_api:app", host="127.0.0.1", port=5000, reload=False)
