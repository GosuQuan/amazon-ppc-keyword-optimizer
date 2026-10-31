"""Check the SCNet model endpoint from .env. Never print the key."""
import json
import urllib.error
import urllib.request
from pathlib import Path

env = {}
for line in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8").splitlines():
    if not line.strip() or line.strip().startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    env[key.strip()] = value.strip()

base = env["AI_BASE_URL"].rstrip("/")
if base.endswith("/chat/completions"):
    root = base[: -len("/chat/completions")]
else:
    root = base
headers = {"Authorization": "Bearer " + env["AI_API_KEY"], "Content-Type": "application/json"}


def call(url, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if payload else "GET")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")


status, body = call(root + "/models")
print("models_status=" + str(status))
if status == 200:
    parsed = json.loads(body)
    names = []
    for item in parsed.get("data") or parsed.get("models") or []:
        if isinstance(item, dict):
            names.append(str(item.get("id") or item.get("name") or ""))
        else:
            names.append(str(item))
    interesting = [name for name in names if "glm" in name.lower() or "flash" in name.lower()]
    print("glm_models=" + " | ".join(interesting[:30]))
else:
    print(body[:400].replace("\n", " "))

payload = {
    "model": env["AI_MODEL"],
    "messages": [{"role": "user", "content": "Reply with exactly OK"}],
    "max_tokens": 32,
    "temperature": 0.2,
    "stream": False,
}
status, body = call(env["AI_BASE_URL"], payload)
print("chat_status=" + str(status))
if status == 200:
    message = json.loads(body).get("choices", [{}])[0].get("message", {})
    text = message.get("content") or message.get("reasoning_content") or ""
    print("reply=" + " ".join(text.split())[:160])
else:
    print(body[:500].replace("\n", " "))
