"""Analyze the real YICOPY keyword export against our own filtering rules.
Only aggregate numbers are printed; raw keyword rows never leave this machine."""
import re
from collections import Counter
from pathlib import Path
import openpyxl

PATH = Path(r"C:\Users\admin\Downloads\测试-B089K9L3VY-20261025_2026-10-27.xlsx")
wb = openpyxl.load_workbook(PATH, read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]
rows = [r for r in ws.iter_rows(values_only=True) if r and r[0]]
header = [str(x or '') for x in rows[0]]
print('columns:', header)
print('total rows:', len(rows) - 1)

# Locate columns by header text.
def col(name):
    for i, h in enumerate(header):
        if name in h:
            return i
    return None

word_i = 0
src_i = col('来源') if col('来源') is not None else 1
use_i = col('建议') if col('建议') is not None else 2
print('source col:', src_i, 'usage col:', use_i)

usage = Counter()
usage_values = []
comp_counts = []
words = []
for r in rows[1:]:
    w = str(r[word_i] or '').strip().lower()
    if not w:
        continue
    words.append(w)
    u = str(r[use_i] or '').strip() if use_i is not None and use_i < len(r) else ''
    usage_values.append(u)
    for label in ('必用', '放标题', '放要点', '必用'):
        if label in u:
            usage[label] += 1
            break
    m = re.search(r'(\d+)\s*个竞品使用', str(r[src_i] or '') if src_i is not None and src_i < len(r) else '')
    if m:
        comp_counts.append(int(m.group(1)))

print('usage labels:', dict(usage))
print('rows with 竞品使用数:', len(comp_counts))
if comp_counts:
    print('竞品使用数 min/max/mean:', min(comp_counts), max(comp_counts), round(sum(comp_counts)/len(comp_counts), 2))
    print('>=3 竞品使用:', sum(1 for c in comp_counts if c >= 3))
    print('==1 竞品使用:', sum(1 for c in comp_counts if c == 1))

# Substring coverage: how many words are strict substrings of a longer word.
word_set = set(words)
covered = [w for w in words if any(w != t and len(t) > len(w) and w in t for t in word_set)]
print('words contained in a longer word:', len(covered), f'({round(len(covered)/len(words)*100,1)}%)')

# Of those covered, how many have high competitor usage (>=3)?
hi = [w for w, c in [] ]
covered_hi = 0
for r in rows[1:]:
    w = str(r[word_i] or '').strip().lower()
    if not w or w not in set(covered):
        continue
    m = re.search(r'(\d+)\s*个竞品使用', str(r[src_i] or '') if src_i is not None and src_i < len(r) else '')
    if m and int(m.group(1)) >= 3:
        covered_hi += 1
print('covered words with >=3 competitor usage (would be dropped by our rule):', covered_hi)

brand_tokens = ('omoton', 'samsung', 'google', 'nexus')
brand_rows = [w for w in words if any(b in w for b in brand_tokens)]
print('words containing old hardcoded brand tokens:', len(brand_rows))
print('examples of covered short words:', sorted(covered, key=len)[:12])
