"""Run the real 1,685-word YICOPY export through our placement & char checks.
Reads the local xlsx; prints aggregate numbers only, never the raw word list."""
import json
import re
import sys
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'node_modules' / '.bin'))  # not used; keep import side effect free

XLSX = Path(r"C:\Users\admin\Downloads\测试-B089K9L3VY-20261025_2026-10-27.xlsx")

def canon(v):
    s = str(v or '').lower()
    s = re.sub(r'[\s\u3000]+', '', s)
    s = re.sub(r"[()（）#％%：:，,。·'\"“”\-—–_/\\]", '', s)
    return s

def char_issues(word):
    value = str(word or '')
    issues = []
    if any(ord(c) > 127 for c in value):
        issues.append('非英文')
    if re.search(r'[";|\\<>“”‘’「」『』]', value):
        issues.append('特殊标点')
    if value != value.strip() or re.search(r'\s{2,}', value):
        issues.append('多余空格')
    return issues

wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]
rows = [r for r in ws.iter_rows(values_only=True) if r and r[0]]
words = [str(r[0]).strip() for r in rows[1:] if r[0]]
print('total words:', len(words))

# Report rows used as the placement evidence base (a small synthetic-but-realistic store:
# the store itself has no real report; we reuse the top-frequency words as "our report").
from collections import Counter
freq = Counter(canon(w) for w in words)
top40 = [w for w, _ in freq.most_common(40)]
print('evidence base (top40 words as stand-in report rows):', len(top40))

def suggest_placement(word, report_terms):
    key = canon(word)
    if not key or len(key) < 4:
        return None
    best = None
    for term in report_terms:
        t = canon(term)
        if not t or len(t) < 4:
            continue
        if t not in key and key not in t:
            continue
        orders = 1  # stand-in: every evidence row counts as ordered
        if best is None or orders > best:
            best = orders
    return best

placed = sum(1 for w in words if suggest_placement(w, top40))
char_flagged = [w for w in words if char_issues(w)]
print('placement matchable (against top40):', placed, f'({round(placed/len(words)*100,1)}%)')
print('char issues found:', len(char_flagged))
from collections import Counter as C
print('issue kinds:', dict(C(i for w in char_flagged for i in char_issues(w))))
print('sample flagged:', [w[:30] for w in char_flagged[:5]])
