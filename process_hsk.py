import urllib.request
import json
from collections import defaultdict

url = "https://raw.githubusercontent.com/zispace/hanzi-words/main/words/HSK%E8%AF%8D%E6%B1%87%EF%BC%88%E6%96%B0%E7%89%88%E5%85%B1%E4%B9%9D%E7%BA%A7%EF%BC%892021.txt"

print("Downloading...")
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as response:
        content = response.read().decode('utf-8')
except Exception as e:
    print(f"Error downloading: {e}")
    exit(1)

words = content.split()
char_map = defaultdict(set)

for w in words:
    # only consider 2-character words for simplicity
    if len(w) == 2:
        c1, c2 = w[0], w[1]
        char_map[c1].add(c2)
        char_map[c2].add(c1)

valid_banks = []
for center, hidden_set in char_map.items():
    if len(hidden_set) >= 6: # need at least 6 to support 6 players
        valid_banks.append({
            "center": center,
            "hidden": list(hidden_set)
        })

print(f"Found {len(valid_banks)} valid center words.")

with open('words.json', 'w', encoding='utf-8') as f:
    json.dump(valid_banks, f, ensure_ascii=False, indent=2)

print("Saved words.json")
