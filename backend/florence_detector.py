import torch
from PIL import Image
import io
import numpy as np
from transformers import AutoProcessor, AutoModelForCausalLM

class FlorenceDetector:
    def __init__(self, model_id="microsoft/Florence-2-large"):
        # Select GPU if available, else fallback to CPU
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        
        print(f"[*] Loading Florence-2 Model ({model_id}) on {self.device}...")
        
        # Load model and processor (trust_remote_code=True is required)
        self.model = AutoModelForCausalLM.from_pretrained(
            model_id, 
            torch_dtype=self.torch_dtype, 
            trust_remote_code=True
        ).to(self.device)
        self.processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
        print("[*] Florence-2 Model loaded successfully.")

    def detect_objects(self, img_bytes: bytes, prompt: str = "<OD>") -> list:
        """
        Runs Florence-2 inference for the given prompt (default is '<OD>' for Object Detection).
        Supported prompts include:
          - '<OD>' : Standard Object Detection
          - '<CAPTION>' : Basic image description
          - '<DETAILED_CAPTION>' : Richer description
          - '<DENSE_REGION_CAPTION>' : Rich localized captions
        """
        # Convert bytes to PIL Image
        image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        width, height = image.size

        # Preprocess input
        inputs = self.processor(text=prompt, images=image, return_tensors="pt").to(self.device, self.torch_dtype)

        # Generate predictions
        with torch.no_grad():
            generated_ids = self.model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=1024,
                do_sample=False,
                num_beams=3
            )

        # Post-process generation text to structured response
        generated_text = self.processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed_answer = self.processor.post_process_generation(
            generated_text, 
            task=prompt, 
            image_size=(width, height)
        )

        detections = []
        if prompt in parsed_answer:
            results = parsed_answer[prompt]
            # When prompt is "<OD>" or "<DENSE_REGION_CAPTION>", results contain bboxes and labels
            bboxes = results.get("bboxes", [])
            labels = results.get("labels", [])
            
            for bbox, label in zip(bboxes, labels):
                # Florence-2 post_process output coordinates format: [x1, y1, x2, y2]
                detections.append({
                    "bbox": [int(coord) for coord in bbox],
                    "confidence": 1.0,  # Florence-2 output doesn't natively return confidence scores for boxes
                    "class": 2000,       # Custom ID prefix for Florence detections
                    "label": label,
                    "source": "florence"
                })
        
        return detections
