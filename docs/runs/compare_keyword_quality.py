import json, re
from pathlib import Path
root = Path(__file__).resolve().parents[2] / 'docs/runs'
def result(name):
    d = json.loads((root / name).read_text(encoding='utf-8'))
    return json.loads(d['choices'][0]['message']['content'])
a = result('real-model-response.json')
b = result('real-keyword-no-thinking-response.json')
def terms(obj, name):
    return {re.sub(r'\s+', ' ', str(v.get('word', '')).strip().lower()) for v in obj.get(name, []) if v.get('word')}
for field in ('expansions', 'negativeHints'):
    x, y = terms(a, field), terms(b, field)
    print(field, 'old_count', len(x), 'new_count', len(y), 'exact_overlap', len(x & y))
for label, data in [('reasoning', a), ('no_thinking', b)]:
    neg = terms(data, 'negativeHints')
    generic = {'cell phone', 'samsung galaxy', 'samsung tab', 'google nexus', 'and tablet'}
    print(label, 'sample_known_negatives', len(neg & generic), 'distinct_negatives', len(neg))
