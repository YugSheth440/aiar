import os
import cv2
import numpy as np
import csv
from datetime import datetime
from ultralytics import YOLO

class HazardDetector:
    def __init__(self):
        # 1. Load Custom Hazard Model (best.pt)
        custom_model_path = "best.pt"
        self.is_custom_active = True
        
        if not os.path.exists(custom_model_path):
            print(f"[*] Custom model '{custom_model_path}' not found in backend directory.")
            print("[*] Falling back to default 'yolov8n.pt' for custom model slot.")
            custom_model_path = "yolov8n.pt"
            self.is_custom_active = False
        
        print(f"[*] Loading Custom YOLO Model from: {custom_model_path}")
        self.custom_model = YOLO(custom_model_path)
        self.custom_names = self.custom_model.names
        print(f"[*] Custom YOLO Model loaded. Classes: {self.custom_names}")

        # 2. Load Standard Objects Model (yolov8n.pt)
        standard_model_path = "yolov8n.pt"
        print(f"[*] Loading Standard YOLO Model from: {standard_model_path}")
        self.standard_model = YOLO(standard_model_path)
        self.standard_names = self.standard_model.names
        print(f"[*] Standard YOLO Model loaded. Classes: {len(self.standard_names)} items.")
        
        # Combined active model labels
        self.names = {**self.custom_names}
        # Add standard names offset by 1000 to prevent label collisions
        for cls_id, label in self.standard_names.items():
            self.names[cls_id + 1000] = label

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

    def detect_image(self, img_bytes: bytes):
        """
        Decodes raw image bytes, runs the dual-model inference pipeline,
        appends any active detections to detections_log.csv (with cooldown tracking), and returns results.
        """
        np_arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if img is None:
            return []

        detections = []

        # Part A: Run Custom Hazard Model (best.pt)
        custom_results = self.custom_model(img, verbose=False)
        for result in custom_results:
            for box in result.boxes:
                xyxy = box.xyxy.tolist()[0]
                conf = float(box.conf[0])
                cls = int(box.cls[0])
                label = self.custom_names.get(cls, f"class_{cls}")
                
                detections.append({
                    "bbox": [int(x) for x in xyxy],
                    "confidence": round(conf, 4),
                    "class": cls,
                    "label": label,
                    "source": "custom"
                })

        # Part B: Run Standard Objects Model (yolov8n.pt) if custom model is active
        if self.is_custom_active:
            standard_results = self.standard_model(img, verbose=False)
            for result in standard_results:
                for box in result.boxes:
                    xyxy = box.xyxy.tolist()[0]
                    conf = float(box.conf[0])
                    cls = int(box.cls[0])
                    label = self.standard_names.get(cls, f"class_{cls}")
                    
                    detections.append({
                        "bbox": [int(x) for x in xyxy],
                        "confidence": round(conf, 4),
                        "class": cls + 1000,
                        "label": label,
                        "source": "standard"
                    })
        
        # 4. Write live detections to rolling CSV log file with presence tracking
        if len(detections) > 0:
            self.append_detections_to_csv(detections)

        return detections

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
