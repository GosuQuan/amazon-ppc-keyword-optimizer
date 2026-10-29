"""词根挖掘（n-gram 盈亏归因）与长尾组合扩展。与 JS 版行为一致（R-T0 对齐）。"""
import re
from typing import Any, Dict, List, Set

from .parser import canon, valid_st

STOP = {"the", "a", "an", "and", "or", "of", "to", "for", "with", "in", "on", "by", "is", "are",
        "be", "it", "its", "this", "that", "your", "you", "my", "our", "we", "from", "at", "as",
        "not", "no", "s", "will", "can", "up", "out", "about", "into", "over", "than", "then",
        "so", "such", "very", "more", "most", "me", "i"}

WORD_RE = re.compile(r"[a-z0-9]+")
CJK_RE = re.compile(r"[\u4e00-\u9fff]+")
SMALL_NUM_RE = re.compile(r"^\d{1,2}$")


def latin_words(s: str) -> List[str]:
    return [w for w in WORD_RE.findall(str(s or "").lower())]


def build_roots(st_rows: List[Dict[str, Any]], params: Dict[str, float], aov: float):
    roots: Dict[str, Dict[str, Any]] = {}

    def get(tok: str) -> Dict[str, Any]:
        r = roots.get(tok)
        if r is None:
            r = {"tok": tok, "terms": 0, "imp": 0.0, "clk": 0.0, "spend": 0.0, "sales": 0.0,
                 "orders": 0.0, "gT": 0, "gSpend": 0.0, "gSales": 0.0, "bT": 0, "bSpend": 0.0}
            roots[tok] = r
        return r

    for s in st_rows:
        if not valid_st(s["st"]):
            continue
        words = [w for w in latin_words(s["st"]) if len(w) >= 2 and w not in STOP and not SMALL_NUM_RE.match(w)]
        toks: Set[str] = set(words)
        for seq in CJK_RE.findall(s["st"]):
            ch = list(seq)
            for i in range(len(ch)):
                toks.add(ch[i])
                if i < len(ch) - 1:
                    toks.add(ch[i] + ch[i + 1])
        for i in range(len(words) - 1):
            a, b = words[i], words[i + 1]
            if len(a) >= 2 and len(b) >= 2:
                toks.add(a + " " + b)
        for tok in toks:
            r = get(tok)
            r["terms"] += 1
            for k in ("imp", "clk", "spend", "sales", "orders"):
                r[k] += s[k]
            if s["cls"] in ("优秀", "良好"):
                r["gT"] += 1
                r["gSpend"] += s["spend"]
                r["gSales"] += s["sales"]
            if s["cls"] == "无效":
                r["bT"] += 1
                r["bSpend"] += s["spend"]

    t = params["target"] / 100.0
    root_waste = max(3 * aov * t, 10)
    out = []
    for r in roots.values():
        if r["clk"] <= 0:
            continue
        r["acos"] = r["spend"] / r["sales"] if r["sales"] > 0 else float("inf")
        if r["sales"] > 0 and r["acos"] <= t and r["terms"] >= 2 and r["gSales"] > 0:
            r["type"] = "盈利"
        elif r["terms"] >= 3 and r["sales"] <= 0.01 and r["spend"] >= root_waste:
            r["type"] = "亏损"
        elif r["gT"] >= 2 and r["gSales"] > 0:
            r["type"] = "加分"
        elif r["bT"] >= 2 and r["bSpend"] >= root_waste * 0.6:
            r["type"] = "减分"
        else:
            continue
        r["sug"] = ("围绕词根扩词 / 加精准投放" if r["type"] == "盈利"
                    else "建议词组否定，阻止同类流量" if r["type"] == "亏损"
                    else "可用于组合扩展（见新词候选）" if r["type"] == "加分"
                    else "仅出现在无效词中，关注")
        out.append(r)
    order = {"盈利": 0, "加分": 1, "减分": 2, "亏损": 3}
    out.sort(key=lambda r: (order[r["type"]], -(r["spend"] if r["type"] in ("亏损", "减分") else r["sales"])))
    loss_roots = {canon(r["tok"]) for r in out if r["type"] == "亏损"}
    return out, loss_roots


def build_combos(st_rows: List[Dict[str, Any]], kw_exact: Set[str], waste_st: Set[str]) -> List[Dict[str, Any]]:
    combos: Dict[str, Dict[str, Any]] = {}
    for s in st_rows:
        if s["cls"] != "优秀" or not valid_st(s["st"]):
            continue
        words = [w for w in latin_words(s["st"]) if len(w) >= 2 and w not in STOP and not SMALL_NUM_RE.match(w)]
        for i in range(len(words) - 1):
            a, b = words[i], words[i + 1]
            if len(a) < 2 or len(b) < 2:
                continue
            pair = a + " " + b
            key = canon(pair)
            c = combos.get(key)
            if c is None:
                c = {"pair": pair, "n": 0, "sales": 0.0, "orders": 0.0, "from": []}
                combos[key] = c
            c["n"] += 1
            c["sales"] += s["sales"]
            c["orders"] += s["orders"]
            if len(c["from"]) < 3 and s["st"] not in c["from"]:
                c["from"].append(s["st"])
    rows = [c for c in combos.values()
            if c["n"] >= 2 and canon(c["pair"]) not in kw_exact and canon(c["pair"]) not in waste_st]
    rows.sort(key=lambda c: (-c["sales"], -c["n"]))
    rows = rows[:60]
    for c in rows:
        c["acos"] = float("inf")
        c["evidence"] = f"来自 {c['n']:.0f} 个优秀搜索词，如「{c['from'][0]}」"
    return rows
