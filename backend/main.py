import os
import base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from groq import Groq
from detector import HazardDetector

# Load environmental variables from .env file
load_dotenv()

app = FastAPI(title="Fire & Smoke Detection API")

# Allow CORS for React Native Web clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize detector
detector = HazardDetector()

@app.get("/")
def read_root():
    return {
        "status": "running",
        "model": "Dual-Model Ensemble (best.pt + yolov8n.pt)",
        "classes": detector.names
    }

@app.post("/detect")
async def detect_hazard(file: UploadFile = File(...)):
    """
    Standard HTTP POST endpoint for single-frame hazard detection.
    """
    img_bytes = await file.read()
    detections = detector.detect_image(img_bytes)
    return {"detections": detections}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for high-frequency, low-latency video frame streaming.
    Decodes binary payloads or base64-encoded text payloads.
    """
    await websocket.accept()
    print("[*] WebSocket client connected.")
    try:
        while True:
            message = await websocket.receive()
            
            img_bytes = None
            if "bytes" in message:
                img_bytes = message["bytes"]
            elif "text" in message:
                text_data = message["text"]
                # Strip base64 prefix if present
                if "," in text_data:
                    text_data = text_data.split(",")[1]
                try:
                    img_bytes = base64.b64decode(text_data)
                except Exception as e:
                    await websocket.send_json({"error": "Invalid base64 encoding", "details": str(e)})
                    continue

            if img_bytes:
                detections = detector.detect_image(img_bytes)
                await websocket.send_json({
                    "detections": detections,
                    "count": len(detections)
                })
                
    except WebSocketDisconnect:
        print("[*] WebSocket client disconnected.")
    except Exception as e:
        print(f"[!] WebSocket error: {e}")
        try:
            await websocket.close()
        except:
            pass

@app.get("/analyze")
def analyze_safety():
    """
    Queries Groq's llama-3.3-70b-versatile model to analyze the current safety situation
    based on active hazards and non-hazard detections.
    """
    # 1. Fetch active targets from detector state
    hazards = list(detector.detected_hazards.keys())
    non_hazards = list(detector.non_hazards.keys())
    
    # 2. Get API key from environment
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return {
            "status": "error",
            "message": "GROQ_API_KEY environment variable is not configured on the server."
        }
        
    try:
        client = Groq(api_key=api_key)
        
        prompt = f"""
You are an emergency response assistant.

Hazards:
{hazards}

Available Objects:
{non_hazards}

Return the 3 MOST IMPORTANT actions the user should take RIGHT NOW.

Requirements:
- Exactly 3 actions.
- Action-oriented sentences.
- Maximum 10 words each.
- Use available objects when helpful.
- Return ONLY JSON.

{{
  "actions": [
    "",
    "",
    ""
  ]
}}
"""

        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You are a safety expert."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            response_format={"type": "json_object"},
            temperature=0.3
        )
        
        import json
        analysis_json = json.loads(response.choices[0].message.content)
        return {
            "status": "success",
            "hazards": hazards,
            "non_hazards": non_hazards,
            "actions": analysis_json.get("actions", [])
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }

@app.post("/reset")
def reset_detections():
    """
    Clears all database logs and active in-memory cached detections.
    """
    try:
        detector.reset_all()
        return {
            "status": "success",
            "message": "Database logs and detector caches reset successfully."
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }
