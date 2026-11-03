"""导出器：五类清单 CSV（带 BOM、Excel 兼容）。"""
import csv
import io
import math
from typing import Any, Dict, List

from .parser import MT_LABEL, canon


def _m(v) -> str:
    return f"{v:,.2f}" if isinstance(v, (int, float)) and math.isfinite(v) else ""


def _n(v, d=0) -> str:
    return f"{v:,.{d}f}" if isinstance(v, (int, float)) and math.isfinite(v) else ""


def _p(x, d=1) -> str:
    if x is None or (isinstance(x, float) and not math.isfinite(x)):
        return ""
    return f"{x * 100:.{d}f}%"


def _fd(v) -> str:
    return f"{v:+.0f}%" if isinstance(v, (int, float)) and math.isfinite(v) else ""


def csv_string(headers: List[str], rows: List[List[Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(headers)
    for r in rows:
        w.writerow(["" if c is None else c for c in r])
    return "\ufeff" + buf.getvalue()


def new_word_rows(harvest: List[Dict[str, Any]], combos: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    seen = set()

    def add(row: Dict[str, Any]) -> None:
        key = canon(row["word"])
        if not key or key in seen:
            return
        seen.add(key)
        rows.append(row)

    for h in harvest:
        if h.get("exists"):
            continue
        add({"src": "搜索词收割", "word": h["st"], "type": h["sug"], "camp": h["camp"],
             "adg": h["adg"], "sales": h["sales"], "orders": h["orders"], "acos": h["acos"],
             "advice": "优先新增" if (h.get("orders") or 0) > 0 else "先观察",
             "note": f"来自{MT_LABEL[h['srcMt']]}匹配，ACOS {_p(h['acos'])}"})
    for c in combos:
        add({"src": "组合挖掘", "word": c["pair"], "type": "组合新词", "camp": "", "adg": "",
             "sales": c["sales"], "orders": c["orders"], "acos": None,
             "advice": "优先新增" if (c.get("orders") or 0) > 0 else "先观察",
             "note": c["evidence"]})
    return rows


def export_actions(actions: List[Dict[str, Any]]) -> str:
    return csv_string(
        ["优先级", "级别", "建议动作", "广告活动", "广告组", "关键词", "匹配类型", "当前出价(估算)",
         "建议出价(估算)", "调整幅度%", "点击", "花费", "销售额", "订单", "ACOS", "理由"],
        [[a["prio"], a["cls"], a["act"], a["camp"], a["adg"], a["kw"], MT_LABEL[a["mt"]] or a["mtRaw"],
          _m(a["curBid"]), _m(a["newBid"]), _fd(a["delta"]), _n(a["clk"]), _m(a["spend"]),
          _m(a["sales"]), _n(a["orders"]), _p(a["acos"]), a["reason"]] for a in actions])


def _suggest_placement(word: str, st_rows: List[Dict[str, Any]]) -> tuple:
    """Root-match a suggested term to the most-ordered report row (advisory)."""
    key = canon(word)
    if not key or len(key) < 4 or not st_rows:
        return ("", "", "")
    best = None
    for s in st_rows:
        term = canon(s.get("st"))
        if not term or len(term) < 4:
            continue
        if term not in key and key not in term:
            continue
        orders = s.get("orders") or 0
        if orders <= 0:
            continue
        if best is None or orders > best[0]:
            best = (orders, s.get("camp") or "", s.get("adg") or "")
    if not best:
        return ("", "", "")
    return (best[1], best[2], f"按词根匹配 {best[1]} / {best[2]}，需人工确认")


def export_negatives(negatives: List[Dict[str, Any]], ai_negatives: List[Dict[str, Any]] | None = None,
                     st_rows: List[Dict[str, Any]] | None = None) -> str:
    rows = [[n["type"], n["word"], n["camp"], n["adg"], n["source"], _n(n["clk"]), _m(n["spend"]),
             n.get("review", "规则命中"), n["reason"]]
            for n in negatives]
    seen = {canon(n["word"]) for n in negatives}
    for e in (ai_negatives or []):
        cross = e.get("cross", "")
        if "不建议否定" in cross:
            continue
        key = canon(e.get("word"))
        if not key or key in seen:
            continue
        seen.add(key)
        source = "AI预判"
        match = "待复核勿上传"
        if "一致" in cross:
            source += "（与规则一致）"
        elif "竞品品牌" in cross:
            source += "（竞品品牌候选）"
            match = "待复核勿上传"
        camp, adg, via = _suggest_placement(e.get("word"), st_rows or [])
        rows.append([match, e["word"], camp, adg, source, "", "", cross or "仅 AI 建议，需人工复核",
                     (via + "　" if via else "") + e.get("reason", "")])
    return csv_string(["否定方式", "否定词", "建议活动", "建议组", "来源", "点击", "花费", "复核提示", "理由"], rows)


def export_newwords(new_rows: List[Dict[str, Any]], ai_expansions: List[Dict[str, Any]] | None = None) -> str:
    rows = [[r["word"], "精准", r.get("advice") or "待验证", r["camp"], r["adg"], r["src"], r["type"], r["note"]]
            for r in new_rows]
    seen = {canon(r["word"]) for r in new_rows}
    for e in (ai_expansions or []):
        if e.get("competitorBrand") or e.get("coveredByGood") or e.get("exists"):
            continue
        key = canon(e["word"])
        if not key or key in seen:
            continue
        seen.add(key)
        orders = e.get("reportOrders") or 0
        appearances = e.get("reportRows") or 0
        advice = "优先新增" if orders > 0 else ("先观察" if appearances > 0 else "待验证")
        rows.append([e["word"], "精准", advice, "", "", "AI扩词", e.get("type", "AI"), e.get("reason", "")])
    return csv_string(["建议关键词", "建议匹配类型", "建议", "建议放入广告活动", "建议放入广告组", "来源", "类型", "说明"], rows)


def export_roots(roots: List[Dict[str, Any]]) -> str:
    return csv_string(["词根", "类型", "出现词数", "点击", "花费", "销售额", "订单", "ACOS", "建议"],
                      [[r["tok"], r["type"], _n(r["terms"]), _n(r["clk"]), _m(r["spend"]), _m(r["sales"]),
                        _n(r["orders"]), _p(r["acos"]), r["sug"]] for r in roots])


def export_st_detail(st_rows: List[Dict[str, Any]]) -> str:
    from .parser import valid_st
    rows = []
    for s in st_rows:
        if not valid_st(s["st"]):
            continue
        rows.append([s["cls"], s["st"], s["camp"], s["adg"], s["kw"], MT_LABEL[s["mt"]] or s["mtRaw"],
                     _n(s["imp"]), _n(s["clk"]), _p(s["ctr"], 2), _m(s["spend"]), _m(s["sales"]),
                     _n(s["orders"]), _p(s["acos"]), _m(s["allowed"])])
    return csv_string(["级别", "搜索词", "广告活动", "广告组", "关键词", "匹配类型", "展示", "点击", "CTR",
                       "花费", "销售额", "订单", "ACOS", "允许预算"], rows)


EXPORTERS = {
    "actions": lambda r: export_actions(r["actions"]),
    "negatives": lambda r: export_negatives(r["negatives"], r.get("aiNegatives"), r.get("st")),
    "newwords": lambda r: export_newwords(new_word_rows(r["harvest"], r["combos"]), r.get("aiExpansions")),
    "roots": lambda r: export_roots(r["roots"]),
    "stdetail": lambda r: export_st_detail(r["st"]),
}
