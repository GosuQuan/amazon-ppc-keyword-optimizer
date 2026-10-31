"""Process-local exact-request cache. It never stores API keys or URL queries."""
import hashlib
import json
import os
import threading
import time
from collections import OrderedDict
from urllib.parse import urlsplit

_lock = threading.Lock()
_entries = OrderedDict()
_hits = {}


def hits(user_id):
    return _hits.get(int(user_id), 0)


def clear():
    global _hits
    with _lock:
        _entries.clear()
        _hits = {}


def _ttl():
    raw = os.environ.get('AI_CACHE_SECONDS', '600')
    try:
        return max(0, int(raw))
    except ValueError:
        return 600


def _key(upstream, payload, user_id):
    parts = urlsplit(upstream)
    canonical = {
        'user_id': int(user_id),
        'host': parts.hostname,
        'path': parts.path,
        'model': payload.get('model'),
        'temperature': payload.get('temperature'),
        'max_tokens': payload.get('max_tokens'),
        'messages': payload.get('messages'),
        'thinking': payload.get('thinking'),
    }
    raw = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(raw.encode()).hexdigest()


def get(upstream, payload, user_id):
    ttl = _ttl()
    if ttl == 0:
        return None
    key = _key(upstream, payload, user_id)
    now = time.monotonic()
    with _lock:
        item = _entries.get(key)
        if item is None:
            return None
        if item[0] <= now:
            _entries.pop(key, None)
            return None
        _entries.move_to_end(key)
        _hits[int(user_id)] = _hits.get(int(user_id), 0) + 1
        return json.loads(json.dumps(item[1]))


def put(upstream, payload, result, user_id):
    ttl = _ttl()
    if ttl == 0 or not isinstance(result, dict):
        return
    key = _key(upstream, payload, user_id)
    with _lock:
        _entries[key] = (time.monotonic() + ttl, json.loads(json.dumps(result)))
        _entries.move_to_end(key)
        while len(_entries) > 100:
            _entries.popitem(last=False)
