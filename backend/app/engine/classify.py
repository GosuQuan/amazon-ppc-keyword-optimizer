"""分组聚合与七级分级。与 JS 版行为一致（R-T0 边界对齐）。"""
import math
from typing import Any, Dict, List, Tuple

from .parser import is_placeholder_kw, valid_st

Params = Dict[str, float]


def blank(camp="", adg="", kw="", mtRaw="", mt="other", st="") -> Dict[str, Any]:
    return {"camp": camp, "adg": adg, "kw": kw, "mtRaw": mtRaw, "mt": mt, "st": st,
            "imp": 0.0, "clk": 0.0, "spend": 0.0, "sales": 0.0, "orders": 0.0,
            "units": 0.0, "maxCpc": 0.0, "n": 0}


def acc(g: Dict[str, Any], r: Dict[str, Any]) -> None:
    g["imp"] += r["imp"]
    g["clk"] += r["clk"]
    g["spend"] += r["spend"]
    g["sales"] += r["sales"]
    g["orders"] += r["orders"]
    g["units"] += r.get("units") or 0
    g["n"] += 1
    if r["cpc"] > g["maxCpc"]:
        g["maxCpc"] = r["cpc"]


def fin(g: Dict[str, Any], params: Params, aov: float) -> Dict[str, Any]:
    g["ctr"] = g["clk"] / g["imp"] if g["imp"] > 0 else 0.0
    g["cpcAvg"] = g["spend"] / g["clk"] if g["clk"] > 0 else 0.0
    g["acos"] = g["spend"] / g["sales"] if g["sales"] > 0 else math.inf
    g["cvr"] = g["orders"] / g["clk"] if g["clk"] > 0 else 0.0
    g["bidProxy"] = max(g["maxCpc"] * 1.15, 0.1)
    g["cls"] = classify(g, params, aov)
    return g


def classify(g: Dict[str, Any], params: Params, aov: float) -> str:
    t = params["target"] / 100.0
    ec = params["ecvr"] / 100.0
    allowed = g["clk"] * ec * t * aov
    g["allowed"] = allowed
    if g["orders"] > 0 and g["sales"] > 0:
        if g["acos"] <= t * 0.6:
            return "优秀"
        if g["acos"] <= t:
            return "良好"
        if g["acos"] <= t * 1.5:
            return "偏高"
        return "亏损"
    two_spend = 2 * aov * t
    if g["clk"] >= params["minClicks"] and (g["spend"] >= two_spend or g["spend"] >= allowed * 2):
        return "无效"
    if g["clk"] < params["minClicks"] and g["spend"] < allowed * 2:
        return "观察"
    return "潜力"


def compute_aov(records: List[Dict[str, Any]], params: Params) -> Tuple[float, bool]:
    if params.get("aovOverride", 0) > 0:
        return float(params["aovOverride"]), False
    tot_sales = sum(r["sales"] for r in records)
    tot_orders = sum(r["orders"] for r in records)
    if tot_orders > 0:
        return tot_sales / tot_orders, False
    return 25.0, True


def group_and_classify(records: List[Dict[str, Any]], params: Params, aov: float):
    st_map: Dict[Tuple, Dict[str, Any]] = {}
    kw_map: Dict[Tuple, Dict[str, Any]] = {}
    for r in records:
        sk = (r["camp"], r["adg"], r["kw"], r["mt"], r["st"])
        g = st_map.get(sk)
        if g is None:
            g = blank(r["camp"], r["adg"], r["kw"], r["mtRaw"], r["mt"], r["st"])
            st_map[sk] = g
        acc(g, r)
        if r["kw"] and not is_placeholder_kw(r["kw"]):
            kk = (r["camp"], r["adg"], r["kw"], r["mt"])
            k = kw_map.get(kk)
            if k is None:
                k = blank(r["camp"], r["adg"], r["kw"], r["mtRaw"], r["mt"])
                kw_map[kk] = k
            acc(k, r)
    st_rows = [fin(g, params, aov) for g in st_map.values()]
    kw_rows = [fin(g, params, aov) for g in kw_map.values()]
    return st_rows, kw_rows


def kpi_of(records: List[Dict[str, Any]], st_rows: List[Dict[str, Any]], aov: float, aov_assumed: bool):
    tot = {k: sum(r[k] for r in records) for k in ("imp", "clk", "spend", "sales", "orders")}
    kpi = {
        "imp": tot["imp"], "clk": tot["clk"], "spend": tot["spend"],
        "sales": tot["sales"], "orders": tot["orders"],
        "acos": (tot["spend"] / tot["sales"]) if tot["sales"] > 0 else None,
        "cpc": (tot["spend"] / tot["clk"]) if tot["clk"] > 0 else 0.0,
        "rows": len(records),
        "stCount": sum(1 for s in st_rows if valid_st(s["st"])),
    }
    dist: Dict[str, Dict[str, float]] = {}
    for s in st_rows:
        if not valid_st(s["st"]):
            continue
        d = dist.setdefault(s["cls"], {"n": 0, "imp": 0, "clk": 0, "spend": 0, "sales": 0, "orders": 0})
        d["n"] += 1
        for k in ("imp", "clk", "spend", "sales", "orders"):
            d[k] += s[k]
    return {"kpi": kpi, "dist": dist, "aov": aov, "aovAssumed": aov_assumed}
