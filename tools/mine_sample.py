"""Mine the shipped sample search-term report. Numbers come only from that file."""
import json
from collections import defaultdict
from pathlib import Path

from app.engine.parser import parse_upload
from app.engine.pipeline import run_analysis, sanitize

ROOT = Path(__file__).resolve().parents[1]
raw = (ROOT / "examples" / "亚马逊搜索词报告-示例.csv").read_bytes()
records = parse_upload(raw, "示例")
result = sanitize(run_analysis(records, {"target": 25}))


def add(bucket, row):
    for key in ("imp", "clk", "spend", "sales", "orders"):
        bucket[key] += row[key]
    bucket["n"] += 1


def finish(bucket):
    bucket["acos"] = bucket["spend"] / bucket["sales"] * 100 if bucket["sales"] else None
    for key in ("spend", "sales"):
        bucket[key] = round(bucket[key], 2)
    return bucket


def blank():
    return {"n": 0, "imp": 0.0, "clk": 0.0, "spend": 0.0, "sales": 0.0, "orders": 0.0}


campaigns, matches = defaultdict(blank), defaultdict(blank)
for row in records:
    add(campaigns[row["camp"]], row)
    add(matches[row["mt"]], row)

classes = {}
for name, dist in result["dist"].items():
    classes[name] = {
        "terms": dist["n"],
        "clicks": dist["clk"],
        "spend": round(dist["spend"], 2),
        "sales": round(dist["sales"], 2),
        "orders": dist["orders"],
        "acos": round(dist["spend"] / dist["sales"] * 100, 2) if dist["sales"] else None,
    }

roots = [{
    "token": row["tok"], "type": row["type"], "terms": row["terms"],
    "clicks": row["clk"], "spend": round(row["spend"], 2), "sales": round(row["sales"], 2),
    "orders": row["orders"], "suggestion": row["sug"],
} for row in result["roots"]]

out = {
    "rows": len(records),
    "aov": round(result["aov"], 2),
    "campaigns": {name: finish(dict(value)) for name, value in campaigns.items()},
    "matches": {name: finish(dict(value)) for name, value in matches.items()},
    "classes": classes,
    "roots": roots,
    "combos": [{
        "pair": row["pair"], "count": row["n"], "orders": row["orders"], "sales": round(row["sales"], 2),
    } for row in result["combos"][:15]],
    "conflicts": [{
        "term": row["st"], "locations": row["locs"], "clicks": row["totClk"], "winner": row["winner"],
        "losers": row["losers"],
    } for row in result["conflicts"]],
}
path = ROOT / "docs" / "runs" / "sample-mining.json"
path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"rows": out["rows"], "campaigns": list(out["campaigns"]), "classes": list(out["classes"]), "roots": len(out["roots"]), "conflicts": len(out["conflicts"])}, ensure_ascii=False))
