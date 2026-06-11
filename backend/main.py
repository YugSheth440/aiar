import os
import json
import base64
import csv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from detector import HazardDetector

load_dotenv()

app = FastAPI(title="Pixtral-12B Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

detector = HazardDetector()

def get_csv_labels(filepath):
    """Load labels from CSV."""
    labels = []
    if os.path.exists(filepath):
        try:
            with open(filepath, mode='r', newline='', encoding='utf-8') as file:
                reader = csv.DictReader(file)
                for row in reader:
                    lbl = row.get("label")
                    if lbl:
                        labels.append(lbl)
        except Exception as e:
            print(f"[!] Error reading {filepath}: {e}")
    return labels

# SambaNova analyzer removed. Pixtral-12B now performs direct analysis.

@app.get("/")
def health():
    return {"status": "running", "model": "Pixtral-12B"}

@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    """Single frame detection."""
    img_bytes = await file.read()
    detections, caption, analysis = detector.detect_image(img_bytes)
    return {"detections": detections, "caption": caption, "analysis": analysis}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Real-time WebSocket for video frames."""
    await websocket.accept()
    print("[+] WebSocket client connected")
    frame_count = 0
    
    try:
        while True:
            message = await websocket.receive()
            
            img_bytes = None
            if "bytes" in message:
                img_bytes = message["bytes"]
            elif "text" in message:
                text_data = message["text"]
                if "," in text_data:
                    text_data = text_data.split(",")[1]
                try:
                    img_bytes = base64.b64decode(text_data)
                except:
                    continue

            if img_bytes:
                frame_count += 1
                
                # Detect and analyze with Pixtral
                detections, caption, analysis_result = detector.detect_image(img_bytes)
                
                # Convert detections to array format expected by React frontend
                detection_array = []
                if isinstance(detections, list):
                    detection_array = detections
                elif isinstance(detections, dict) and "labels" in detections:
                    labels = detections.get("labels", [])
                    bboxes = detections.get("bboxes", [])
                    detection_array = [
                        {
                            "label": label,
                            "bbox": bbox,
                            "confidence": 1.0,
                            "class": i
                        }
                        for i, (label, bbox) in enumerate(zip(labels, bboxes))
                    ]
                
                # Send as array of detections (React app format)
                response = {
                    "frame": frame_count,
                    "detections": detection_array,
                    "count": len(detection_array),
                    "analysis": analysis_result
                }
                
                await websocket.send_json(response)
                
    except WebSocketDisconnect:
        print(f"[*] WebSocket disconnected after {frame_count} frames")
    except Exception as e:
        print(f"[!] WebSocket error: {e}")

@app.post("/analyze-frame")
async def analyze_frame(payload: dict):
    """Analyze a single frame with detailed output."""
    try:
        return {
            "status": "success",
            "analysis": detector.latest_analysis,
            "labels": payload.get("labels", [])
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/test-groq")
def test_groq():
    """Test Pixtral analysis with demo data."""
    return {
        "status": "success", 
        "result": detector.latest_analysis,
        "test_labels": ["person", "fire", "smoke", "door"],
        "test_caption": "Testing Pixtral-12B active telemetry"
    }

@app.post("/reset")
def reset_detections():
    """Clear all detections."""
    try:
        if hasattr(detector, 'reset_all'):
            detector.reset_all()
        return {
            "status": "success",
            "message": "Detector reset successfully"
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/analyze")
def analyze_safety():
    """Analyze current safety situation using Pixtral."""
    print("\n[*] /analyze endpoint called")
    
    labels = [d.get("label", "") for d in detector.latest_detections]
    
    # Categorize them dynamically based on predefined hazard labels
    hazards = [lbl for lbl in labels if lbl.lower().strip() in detector.predefined_hazard_labels]
    non_hazards = [lbl for lbl in labels if lbl.lower().strip() not in detector.predefined_hazard_labels]
    
    analysis_result = detector.latest_analysis
    
    return {
        "status": "success",
        "hazards": hazards,
        "non_hazards": non_hazards,
        "analysis": analysis_result,
        "actions": analysis_result.get("actions", [])
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)