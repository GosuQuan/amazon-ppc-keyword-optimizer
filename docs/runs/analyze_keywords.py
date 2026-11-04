import re
import openpyxl

path = r"C:\Users\admin\Downloads\测试-B089K9L3VY-20261025_2026-10-27.xlsx"
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]
rows = list(ws.iter_rows(values_only=True))[2:]
items = []
for row in rows:
    if not row or not row[0]:
        continue
    word = str(row[0]).strip().lower()
    source = str(row[1] or "")
    match = re.search(r"(\d+)", source)
    items.append((word, int(match.group(1)) if match else 0))
print("rows", len(items))
print("used_by_5", sum(1 for word, count in items if count >= 5))
print("used_by_1", sum(1 for word, count in items if count == 1))
brands = ("omoton", "samsung", "google", "nexus", "c4")
print("brand_rows", sum(1 for word, count in items if any(brand in word for brand in brands)))
words = [word for word, count in items]
top = words[:40]
contained = 0
for word in words:
    if len(word) < 4:
        continue
    for good in top:
        if word != good and len(good) >= 4 and (word in good or good in word):
            contained += 1
            break
print("contained_in_top40", contained)
