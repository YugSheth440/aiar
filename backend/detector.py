import os
import cv2
import numpy as np
import csv
import re
import json
import base64
from datetime import datetime
from PIL import Image
import io
from mistralai.client import Mistral

class HazardDetector:
    def __init__(self):
        print("[*] Initializing Mistral Client for Pixtral-12B...")
        self.client = Mistral(api_key="8KL3OIAVw9OZ6RUaKqN6Fz5X8RXWbxK8")
        print("[*] Mistral Client initialized successfully.")
        
        # Combined active model labels (we start empty or with dynamic keys)
        self.names = {}
        self.latest_detections = []
        self.latest_caption = ""
        self.latest_analysis = {
            "actions": ["Good day, everything looks good. No hazards found."],
            "priority": "low",
            "threat_level": "safe"
        }

        # 3. Setup Telemetry CSV logging files and tables
        self.csv_log_file = "detections_log.csv"
        self.fields = ["class", "label", "confidence", "peak_confidence", "x_min", "y_min", "x_max", "y_max", "source", "timestamps"]
        
        # Hysteresis presence tracking memory to avoid duplicate logs
        self.active_tracks = {}      # Maps label (string) -> last_seen_datetime (datetime)
        self.cooldown_seconds = 8.0  # Cooldown window: object must leave view for 8 seconds to be logged as a new session

        # Define file paths for hazards and non-hazards tables
        self.predefined_hazards_file = "hazards.csv"
        self.detected_hazards_file = "detected_hazards.csv"
        self.non_hazards_file = "non_hazards.csv"

        # Predefined hazards set
        self.predefined_hazard_labels = set()

        # Create predefined hazards table if it doesn't exist yet
        if not os.path.exists(self.predefined_hazards_file):
            try:
                with open(self.predefined_hazards_file, mode='w', newline='', encoding='utf-8') as file:
                    writer = csv.DictWriter(file, fieldnames=["label", "severity"])
                    writer.writeheader()
                    writer.writerows([
                        {"label": "fire", "severity": "critical"},
                        {"label": "thunder", "severity": "high"},
                        {"label": "panic", "severity": "critical"},
                        {"label": "smoke", "severity": "high"}
                    ])
                print(f"[+] Created default predefined hazards reference table: {self.predefined_hazards_file}")
            except Exception as e:
                print(f"[!] Error creating default hazards file: {e}")

        # Load predefined hazard labels
        try:
            with open(self.predefined_hazards_file, mode='r', newline='', encoding='utf-8') as file:
                reader = csv.DictReader(file)
                for row in reader:
                    lbl = row.get("label")
                    if lbl:
                        self.predefined_hazard_labels.add(lbl.lower().strip())
            print(f"[+] Loaded predefined hazards list: {self.predefined_hazard_labels}")
        except Exception as e:
            print(f"[!] Error loading predefined hazards: {e}")
            self.predefined_hazard_labels = {"fire", "thunder", "panic", "smoke"}

        # Load existing detections from main CSV if it exists
        self.all_detections = {}
        if os.path.exists(self.csv_log_file):
            try:
                with open(self.csv_log_file, mode='r', newline='', encoding='utf-8') as file:
                    reader = csv.DictReader(file)
                    for row in reader:
                        label = row.get("label")
                        if label:
                            ts = row.get("timestamps") or row.get("timestamp") or ""
                            conf = float(row.get("confidence", 0.0))
                            peak_conf = float(row.get("peak_confidence") or row.get("confidence") or 0.0)
                            self.all_detections[label] = {
                                "class": int(row.get("class", 0)),
                                "label": label,
                                "confidence": conf,
                                "peak_confidence": peak_conf,
                                "x_min": int(row.get("x_min", 0)),
                                "y_min": int(row.get("y_min", 0)),
                                "x_max": int(row.get("x_max", 0)),
                                "y_max": int(row.get("y_max", 0)),
                                "source": row.get("source", ""),
                                "timestamps": ts
                            }
                print(f"[+] Loaded {len(self.all_detections)} existing categories from log file.")
            except Exception as e:
                print(f"[!] Error loading existing log file: {e}")

        # Distribute/Redistribute categories based on the > 50% peak confidence threshold
        self.detected_hazards = {}
        self.non_hazards = {}
        for label, row in self.all_detections.items():
            peak_conf = row.get("peak_confidence", 0.0)
            is_hazard = (label.lower().strip() in self.predefined_hazard_labels) and (peak_conf > 0.5)
            if is_hazard:
                self.detected_hazards[label] = row.copy()
            elif peak_conf > 0.5:
                # Keep in non_hazards ONLY if peak_confidence > 50%
                self.non_hazards[label] = row.copy()

        # Rewrite CSV files to ensure consistency and apply schema changes
        self.write_dict_to_csv(self.detected_hazards_file, self.detected_hazards)
        self.write_dict_to_csv(self.non_hazards_file, self.non_hazards)

    def parse_pixtral_response(self, text, img_width, img_height):
        detections = []
        analysis = {
            "actions": ["Good day, everything looks good. No hazards found."],
            "priority": "low",
            "threat_level": "safe"
        }
        
        # 1. Try to find the JSON block first
        json_match = re.search(r'```json\s*(\{[\s\S]*?\})\s*```', text)
        if json_match:
            try:
                data = json.loads(json_match.group(1))
                # Parse detections
                parsed_list = data.get("detections", [])
                for item in parsed_list:
                    label = item.get("label", "").lower().strip()
                    box_2d = item.get("box_2d") # [xmin, ymin, xmax, ymax] in 0-1 range
                    if label and isinstance(box_2d, list) and len(box_2d) == 4:
                        xmin, ymin, xmax, ymax = box_2d
                        x_min = int(xmin * img_width)
                        y_min = int(ymin * img_height)
                        x_max = int(xmax * img_width)
                        y_max = int(ymax * img_height)
                        
                        detections.append({
                            "bbox": [x_min, y_min, x_max, y_max],
                            "confidence": 1.0,
                            "label": label,
                            "source": "pixtral"
                        })
                
                # Parse analysis
                parsed_analysis = data.get("analysis", {})
                if "actions" in parsed_analysis:
                    analysis["actions"] = parsed_analysis["actions"]
                if "priority" in parsed_analysis:
                    analysis["priority"] = parsed_analysis["priority"]
                if "threat_level" in parsed_analysis:
                    analysis["threat_level"] = parsed_analysis["threat_level"]
                
                return detections, analysis
            except Exception as e:
                print(f"[!] Error parsing JSON block: {e}")

        # 2. Fallback: Parse from natural text coordinates if JSON block parsing failed or is empty
        pattern = r'(?:from|at)\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)\s*to\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)'
        matches = re.finditer(pattern, text, re.IGNORECASE)
        
        for match in matches:
            start_idx = match.start()
            xmin_val, ymin_val, xmax_val, ymax_val = map(float, match.groups())
            
            search_window = text[max(0, start_idx-200):start_idx]
            label_matches = re.findall(r'\*\*(.*?)\*\*[\s:]*', search_window)
            label = "object"
            if label_matches:
                label = label_matches[-1].lower().strip()
                label = re.sub(r'[\d.\-:]+', '', label).strip()
                
            x_min = int(xmin_val * img_width)
            y_min = int(ymin_val * img_height)
            x_max = int(xmax_val * img_width)
            y_max = int(ymax_val * img_height)
            
            detections.append({
                "bbox": [x_min, y_min, x_max, y_max],
                "confidence": 1.0,
                "label": label if label else "object",
                "source": "pixtral"
            })
            
        return detections, analysis

    def clean_description(self, text):
        cleaned = re.sub(r'```json\s*\{[\s\S]*?\}\s*```', '', text)
        return cleaned.strip()

    def detect_image(self, img_bytes: bytes):
        """
        Decodes raw image bytes, runs Pixtral-12B to analyze the scene and perform object detection,
        appends any active detections to detections_log.csv (with cooldown tracking), and returns results.
        """
        try:
            image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            width, height = image.size
        except Exception as e:
            print(f"[!] Error decoding image: {e}")
            return [], "", {
                "actions": ["Good day, everything looks good. No hazards found."],
                "priority": "low",
                "threat_level": "safe"
            }

        # Re-save to JPEG bytes
        buffered = io.BytesIO()
        image.save(buffered, format="JPEG")
        jpegs_bytes = buffered.getvalue()

        # Encode image to base64
        base64_image = base64.b64encode(jpegs_bytes).decode('utf-8')

        # Call Pixtral-12B via Mistral API
        prompt = (
            "Analyze this image. Perform object detection by listing the key objects with their approximate coordinates "
            "if possible, and provide a detailed scene understanding/description. "
            "Identify if there is any hazard, safety threat, or danger.\n\n"
            "CRITICAL: At the very end of your response, output a structured JSON block inside a ```json ... ``` code fence. "
            "The JSON must follow this schema:\n"
            "{\n"
            "  \"detections\": [\n"
            "    {\"label\": \"person\", \"box_2d\": [0.05, 0.25, 0.45, 0.65]}\n"
            "  ],\n"
            "  \"analysis\": {\n"
            "    \"actions\": [\"mitigation action 1\", \"mitigation action 2\", \"mitigation action 3\"],\n"
            "    \"priority\": \"high/medium/low\",\n"
            "    \"threat_level\": \"critical/warning/safe\"\n"
            "  }\n"
            "}\n\n"
            "Rules for analysis:\n"
            "- If hazards are present, set actions to 3 clear mitigation steps, priority to high/medium, threat_level to critical/warning.\n"
            "- If no hazards, set actions to [\"Good day, everything looks good. No hazards found.\"], priority to low, threat_level to safe."
        )

        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt
                    },
                    {
                        "type": "image_url",
                        "image_url": f"data:image/jpeg;base64,{base64_image}"
                    }
                ]
            }
        ]

        try:
            print("[*] Calling Pixtral-12B via Mistral API...")
            response = self.client.chat.complete(
                model="pixtral-12b-2409",
                messages=messages
            )
            full_content = response.choices[0].message.content
            print("[+] Pixtral-12B response received successfully.")
        except Exception as e:
            print(f"[!] Pixtral API Call failed: {e}")
            return [], f"Error calling Pixtral API: {str(e)}", {
                "actions": ["Error calling Pixtral API"],
                "priority": "low",
                "threat_level": "safe"
            }

        # Parse detections and clean description
        detections, analysis = self.parse_pixtral_response(full_content, width, height)
        caption = self.clean_description(full_content)

        # Print live outputs to the terminal
        print("\n" + "=" * 20 + " PIXTRAL-12B LIVE OUTPUT " + "=" * 20)
        print(f"[+] Scene Description:\n{caption}")
        print(f"[+] Detections: {detections}")
        print(f"[+] Analysis: {analysis}")
        print("=" * 64 + "\n")

        # Map to class IDs in detections list
        for det in detections:
            lbl_lower = det["label"]
            if lbl_lower not in self.names:
                self.names[2000 + len(self.names)] = lbl_lower
            det["class"] = next(k for k, v in self.names.items() if v == lbl_lower)

        # Write live detections to rolling CSV log file with presence tracking
        if len(detections) > 0:
            self.append_detections_to_csv(detections)

        self.latest_detections = detections
        self.latest_caption = caption
        self.latest_analysis = analysis

        return detections, caption, analysis

    def load_csv_to_dict(self, filepath):
        """
        Helper to read a consolidated CSV back into an in-memory dictionary.
        """
        data_dict = {}
        try:
            with open(filepath, mode='r', newline='', encoding='utf-8') as file:
                reader = csv.DictReader(file)
                for row in reader:
                    label = row.get("label")
                    if label:
                        ts = row.get("timestamps") or row.get("timestamp") or ""
                        conf = float(row.get("confidence", 0.0))
                        peak_conf = float(row.get("peak_confidence") or row.get("confidence") or 0.0)
                        data_dict[label] = {
                            "class": int(row.get("class", 0)),
                            "label": label,
                            "confidence": conf,
                            "peak_confidence": peak_conf,
                            "x_min": int(row.get("x_min", 0)),
                            "y_min": int(row.get("y_min", 0)),
                            "x_max": int(row.get("x_max", 0)),
                            "y_max": int(row.get("y_max", 0)),
                            "source": row.get("source", ""),
                            "timestamps": ts
                        }
        except Exception as e:
            print(f"[!] Error loading {filepath}: {e}")
        return data_dict

    def write_dict_to_csv(self, filepath, data_dict):
        """
        Helper to write an in-memory database dictionary to a CSV file.
        """
        try:
            with open(filepath, mode='w', newline='', encoding='utf-8') as file:
                writer = csv.DictWriter(file, fieldnames=self.fields)
                writer.writeheader()
                for label, row in data_dict.items():
                    writer.writerow(row)
        except Exception as e:
            print(f"[!] Error writing to {filepath}: {e}")

    def write_all_to_csv(self):
        """
        Rewrites the entire CSV log file with the current in-memory detections database.
        """
        self.write_dict_to_csv(self.csv_log_file, self.all_detections)

    def append_detections_to_csv(self, detections):
        """
        Appends every live detection as a new row in detections_log.csv (chronological log),
        and then routes/updates the active consolidated detections in detected_hazards.csv
        and non_hazards.csv.
        """
        now = datetime.now()
        timestamp = now.strftime("%Y-%m-%d %H:%M:%S")
        
        # 1. Clean up stale tracks (objects that left the screen longer than cooldown_seconds)
        stale_labels = []
        for label, last_seen in self.active_tracks.items():
            if (now - last_seen).total_seconds() > self.cooldown_seconds:
                stale_labels.append(label)
        for label in stale_labels:
            del self.active_tracks[label]

        # 2. Process active detections and append directly to detections_log.csv
        updated_hazards = False
        updated_non_hazards = False
        
        try:
            file_exists = os.path.exists(self.csv_log_file) and os.path.getsize(self.csv_log_file) > 0
            with open(self.csv_log_file, mode='a', newline='', encoding='utf-8') as log_file:
                writer = csv.DictWriter(log_file, fieldnames=self.fields)
                if not file_exists:
                    writer.writeheader()

                for det in detections:
                    label = det["label"]
                    is_new_session = label not in self.active_tracks
                    
                    # Update master in-memory cache to compute correct peak confidence
                    if label in self.all_detections:
                        if is_new_session:
                            existing_ts = self.all_detections[label]["timestamps"]
                            if not existing_ts:
                                self.all_detections[label]["timestamps"] = timestamp
                            elif timestamp not in existing_ts.split(";"):
                                self.all_detections[label]["timestamps"] += f";{timestamp}"
                        
                        self.all_detections[label]["class"] = det["class"]
                        self.all_detections[label]["confidence"] = det["confidence"]
                        self.all_detections[label]["peak_confidence"] = max(self.all_detections[label].get("peak_confidence", 0.0), det["confidence"])
                        self.all_detections[label]["x_min"] = det["bbox"][0]
                        self.all_detections[label]["y_min"] = det["bbox"][1]
                        self.all_detections[label]["x_max"] = det["bbox"][2]
                        self.all_detections[label]["y_max"] = det["bbox"][3]
                        self.all_detections[label]["source"] = det["source"]
                    else:
                        self.all_detections[label] = {
                            "class": det["class"],
                            "label": label,
                            "confidence": det["confidence"],
                            "peak_confidence": det["confidence"],
                            "x_min": det["bbox"][0],
                            "y_min": det["bbox"][1],
                            "x_max": det["bbox"][2],
                            "y_max": det["bbox"][3],
                            "source": det["source"],
                            "timestamps": timestamp
                        }
                    
                    # Append this specific detection instance to the rolling log only if it is a new session
                    if is_new_session:
                        writer.writerow({
                            "class": det["class"],
                            "label": label,
                            "confidence": det["confidence"],
                            "peak_confidence": self.all_detections[label]["peak_confidence"],
                            "x_min": det["bbox"][0],
                            "y_min": det["bbox"][1],
                            "x_max": det["bbox"][2],
                            "y_max": det["bbox"][3],
                            "source": det["source"],
                            "timestamps": timestamp
                        })

                    # Route to Split Tables based on Predefined Hazards Set & Peak Confidence > 0.50
                    peak_conf = self.all_detections[label]["peak_confidence"]
                    is_hazard = (label.lower().strip() in self.predefined_hazard_labels) and (peak_conf > 0.5)
                    
                    if is_hazard:
                        # Remove from non_hazards if it was previously routed there
                        if label in self.non_hazards:
                            del self.non_hazards[label]
                            updated_non_hazards = True
                        
                        target_dict = self.detected_hazards
                        updated_flag = "hazards"
                    else:
                        # Remove from detected_hazards if it was previously routed there
                        if label in self.detected_hazards:
                            del self.detected_hazards[label]
                            updated_hazards = True
                        
                        # Keep in non_hazards ONLY if peak_confidence > 50%
                        if peak_conf > 0.5:
                            target_dict = self.non_hazards
                            updated_flag = "non_hazards"
                        else:
                            # Remove from non_hazards if it was previously there but confidence is now under threshold
                            if label in self.non_hazards:
                                del self.non_hazards[label]
                                updated_non_hazards = True
                            target_dict = None
                    
                    if target_dict is not None:
                        if label in target_dict:
                            if is_new_session:
                                existing_ts = target_dict[label]["timestamps"]
                                if not existing_ts:
                                    target_dict[label]["timestamps"] = timestamp
                                elif timestamp not in existing_ts.split(";"):
                                    target_dict[label]["timestamps"] += f";{timestamp}"
                            
                            target_dict[label]["class"] = det["class"]
                            target_dict[label]["confidence"] = det["confidence"]
                            target_dict[label]["peak_confidence"] = peak_conf
                            target_dict[label]["x_min"] = det["bbox"][0]
                            target_dict[label]["y_min"] = det["bbox"][1]
                            target_dict[label]["x_max"] = det["bbox"][2]
                            target_dict[label]["y_max"] = det["bbox"][3]
                            target_dict[label]["source"] = det["source"]
                        else:
                            target_dict[label] = {
                                "class": det["class"],
                                "label": label,
                                "confidence": det["confidence"],
                                "peak_confidence": peak_conf,
                                "x_min": det["bbox"][0],
                                "y_min": det["bbox"][1],
                                "x_max": det["bbox"][2],
                                "y_max": det["bbox"][3],
                                "source": det["source"],
                                "timestamps": timestamp
                            }
                        
                        if updated_flag == "hazards":
                            updated_hazards = True
                        elif updated_flag == "non_hazards":
                            updated_non_hazards = True
                    
                    # Keep active session alive
                    self.active_tracks[label] = now
        except Exception as e:
            print(f"[!] Error writing to rolling log: {e}")
            
        # 3. Flush updates to split CSV files
        if updated_hazards:
            self.write_dict_to_csv(self.detected_hazards_file, self.detected_hazards)
        if updated_non_hazards:
            self.write_dict_to_csv(self.non_hazards_file, self.non_hazards)

    def reset_all(self):
        """
        Clears all in-memory dictionaries and resets/truncates the CSV files on disk.
        """
        self.all_detections.clear()
        self.detected_hazards.clear()
        self.non_hazards.clear()
        self.active_tracks.clear()
        
        # Write empty CSVs (only headers)
        self.write_all_to_csv()
        self.write_dict_to_csv(self.detected_hazards_file, self.detected_hazards)
        self.write_dict_to_csv(self.non_hazards_file, self.non_hazards)
        print("[*] HazardDetector database and tracking cache reset.")
