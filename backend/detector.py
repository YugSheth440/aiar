import os
import cv2
import numpy as np
import csv
from datetime import datetime
import torch
from PIL import Image
import io
from transformers import AutoProcessor, AutoModelForCausalLM

class HazardDetector:
    def __init__(self):
        # Select GPU if available, else fallback to CPU
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        
        print(f"[*] Loading Florence-2 Model (microsoft/Florence-2-large) on {self.device}...")
        
        # Load model and processor (trust_remote_code=True is required)
        self.model = AutoModelForCausalLM.from_pretrained(
            "microsoft/Florence-2-large", 
            torch_dtype=self.torch_dtype, 
            trust_remote_code=True
        ).to(self.device)
        self.processor = AutoProcessor.from_pretrained("microsoft/Florence-2-large", trust_remote_code=True)
        print("[*] Florence-2 Model loaded successfully.")
        
        # Combined active model labels (we start empty or with dynamic keys)
        self.names = {}

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
        Decodes raw image bytes, runs the Florence-2 object detection model,
        appends any active detections to detections_log.csv (with cooldown tracking), and returns results.
        """
        try:
            image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            width, height = image.size
        except Exception as e:
            print(f"[!] Error decoding image: {e}")
            return []

        # 1. Run Object Detection
        prompt = "<OD>"
        inputs = self.processor(text=prompt, images=image, return_tensors="pt").to(self.device, self.torch_dtype)

        with torch.no_grad():
            generated_ids = self.model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=1024,
                do_sample=False,
                num_beams=3
            )

        generated_text = self.processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed_answer = self.processor.post_process_generation(
            generated_text, 
            task=prompt, 
            image_size=(width, height)
        )

        # 2. Run Captioning
        caption_prompt = "<MORE_DETAILED_CAPTION>"
        caption_inputs = self.processor(text=caption_prompt, images=image, return_tensors="pt").to(self.device, self.torch_dtype)

        with torch.no_grad():
            caption_generated_ids = self.model.generate(
                input_ids=caption_inputs["input_ids"],
                pixel_values=caption_inputs["pixel_values"],
                max_new_tokens=1024,
                do_sample=False,
                num_beams=3
            )

        caption_generated_text = self.processor.batch_decode(caption_generated_ids, skip_special_tokens=False)[0]
        caption_parsed_answer = self.processor.post_process_generation(
            caption_generated_text, 
            task=caption_prompt, 
            image_size=(width, height)
        )

        # Print Florence-2 live outputs to the terminal
        print("\n" + "=" * 20 + " FLORENCE-2 LIVE OUTPUT " + "=" * 20)
        print(f"[+] Caption: {caption_parsed_answer.get(caption_prompt, '')}")
        print(f"[+] Detections: {parsed_answer.get(prompt, {})}")
        print("=" * 64 + "\n")

        detections = []
        if prompt in parsed_answer:
            results = parsed_answer[prompt]
            bboxes = results.get("bboxes", [])
            labels = results.get("labels", [])
            
            for cls_idx, (bbox, label) in enumerate(zip(bboxes, labels)):
                # Ensure label is mapped in self.names
                lbl_lower = label.lower().strip()
                if lbl_lower not in self.names:
                    # Give it a unique class ID
                    self.names[2000 + len(self.names)] = lbl_lower
                
                cls_id = next(k for k, v in self.names.items() if v == lbl_lower)

                detections.append({
                    "bbox": [int(coord) for coord in bbox],
                    "confidence": 1.0,
                    "class": cls_id,
                    "label": lbl_lower,
                    "source": "florence"
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
