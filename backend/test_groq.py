import os
import csv
from dotenv import load_dotenv
from groq import Groq

# Load environment variables from .env file
load_dotenv()

def get_csv_labels(filepath):
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
            print(f"[*] Error reading {filepath}: {e}")
    return labels

def run_analysis():
    # Load dynamically from split files
    hazards = get_csv_labels("detected_hazards.csv")
    non_hazards = get_csv_labels("non_hazards.csv")
    
    # Fallback to defaults if files are empty or don't exist yet
    if not hazards:
        hazards = ["fire", "smoke"]
    if not non_hazards:
        non_hazards = ["fire_extinguisher", "door", "person"]

    print("=" * 60)
    print(f"[*] Active Hazards: {hazards}")
    print(f"[*] Active Non-Hazards: {non_hazards}")
    print("=" * 60)

    # Initialize Groq client
    api_key = os.environ.get("GROQ_API_KEY", "YOUR_GROQ_API_KEY")
    if api_key == "YOUR_GROQ_API_KEY" or not api_key:
        print("[!] Warning: GROQ_API_KEY not found in environment or .env file.")
        print("[!] Please set your GROQ_API_KEY in a .env file: GROQ_API_KEY=gsk_xxxx...")
        return

    client = Groq(api_key=api_key)

    prompt = f"""
You are an emergency response assistant.

Hazards:
{hazards}

Available Objects:
{non_hazards}

Tell me how to use the available objects to mitigate the hazard. 

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

    print("[*] Sending request to Groq API...")
    try:
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
        print("\n" + "=" * 60)
        print("[+] GROQ JSON SAFETY ACTIONS REPORT:")
        print("=" * 60)
        print(response.choices[0].message.content)
        print("=" * 60)
    except Exception as e:
        print(f"[!] Error calling Groq API: {e}")

if __name__ == "__main__":
    run_analysis()
