"""规则引擎：调价动作、收割、互搏检测、否定清单。与 JS 版行为一致（R-T0 对齐）。"""
import math
from typing import Any, Dict, List

from .parser import MT_LABEL, canon, valid_st

PRIO_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _round2(v):
    return round(v + 1e-12, 2)


def build_actions(kw_rows: List[Dict[str, Any]], params: Dict[str, float], aov: float) -> List[Dict[str, Any]]:
    t = params["target"] / 100.0
    out: List[Dict[str, Any]] = []
    for k in kw_rows:
        if not k["clk"] and not k["imp"]:
            continue
        ceiling = t * aov * (k["orders"] / k["clk"]) if (k["orders"] > 0 and k["clk"] > 0) else None
        proxy = k["bidProxy"]
        cls = k["cls"]
        act, delta, new_bid, reason, prio = "", 0, None, "", "P3"
        if cls == "无效":
            prio = "P0"
            new_bid = _round2(proxy * (1 - params["downCap"] / 100.0))
            if new_bid < params["floor"]:
                act = "暂停该关键词"
                new_bid = None
                reason = f"花费 {_m(k['spend'])} 仍 0 订单，出价已到下限，建议暂停"
            else:
                act = "暂停/大幅降价" if k["mt"] == "exact" else "降价并否定该搜索词"
                reason = (f"点击 {_n(k['clk'])} 次 0 订单，花费 {_m(k['spend'])}"
                          f"（允许预算 {_m(k['allowed'])}），建议止损"
                          + ("；该词下无效搜索词见否定清单" if k["mt"] != "exact" else ""))
            delta = -params["downCap"]
        elif cls == "亏损":
            prio = "P0"
            if ceiling is not None and ceiling < params["floor"]:
                act = "暂停/否定（无法盈利出价）"
                reason = (f"ACOS {_p(k['acos'])} 为目标 {_p(t, 0)} 的 {_n(k['acos'] / t, 1)} 倍，"
                          f"盈利出价上限 {_m(ceiling)} 已低于最低出价")
            else:
                act = "降价"
                if ceiling is not None:
                    delta = int(_clamp(round((ceiling / proxy - 1) * 100), -params["downCap"], -1))
                    new_bid = _round2(max(params["floor"], min(proxy, ceiling)))
                else:
                    delta = -int(round(params["downCap"] / 2))
                    new_bid = _round2(proxy * (1 + delta / 100.0))
                reason = (f"ACOS {_p(k['acos'])} 超出目标 {_p(t, 0)}（{_n(k['acos'] / t, 1)} 倍）"
                          + (f"，盈利出价上限 {_m(ceiling)}" if ceiling is not None else "，按降幅上限收缩"))
        elif cls == "偏高":
            prio = "P1"
            act = "小幅降价"
            if ceiling is not None:
                delta = int(round(_clamp((ceiling / proxy - 1) * 100, -params["downCap"], 0)))
                new_bid = _round2(min(proxy, ceiling))
            else:
                delta = -12
                new_bid = _round2(proxy * (1 + delta / 100.0))
            reason = f"ACOS {_p(k['acos'])} 略超目标 {_p(t, 0)}，有订单，先小幅回调"
        elif cls == "优秀":
            prio = "P1"
            up = int(_clamp(round((ceiling / proxy - 1) * 100), 0, params["upCap"])) if ceiling is not None else min(params["upCap"], 25)
            if up >= 3:
                act = "提价抢量"
                delta = up
                new_bid = _round2(proxy * (1 + up / 100.0))
                reason = (f"ACOS {_p(k['acos'])} 优于目标 {_p(t, 0)}，转化率 {_p(k['cvr'])}，"
                          f"盈利出价上限 {_m(ceiling) if ceiling is not None else '更高'}，建议提价抢曝光")
            else:
                act = "维持"
                delta = 0
                reason = f"ACOS {_p(k['acos'])} 远低于目标，出价已接近盈利上限"
            if k["mt"] != "exact":
                reason += "；该词下的优质搜索词建议收割为精准投放（见新词候选）"
        elif cls == "良好":
            prio = "P2"
            up = int(_clamp(round((ceiling / proxy - 1) * 100), 0, min(params["upCap"], 15))) if (ceiling is not None and ceiling > proxy) else 0
            if up >= 3:
                act = "小幅提价"
                delta = up
                new_bid = _round2(proxy * (1 + up / 100.0))
                reason = f"ACOS {_p(k['acos'])} 达标且低于盈利上限 {_m(ceiling)}，小幅提价"
            else:
                act = "维持"
                delta = 0
                reason = f"ACOS {_p(k['acos'])} 达标，维持现状"
        elif cls == "观察":
            act = "维持观察"
            reason = (f"点击 {_n(k['clk'])} 次未达判断阈值 {params['minClicks']:.0f}，继续积累数据"
                      if k["clk"] < params["minClicks"]
                      else f"花费 {_m(k['spend'])} 尚在允许预算 {_m(k['allowed'])} 内，暂不动")
        else:  # 潜力
            act = "维持观察"
            reason = (f"点击 {_n(k['clk'])} 次暂无订单，但花费 {_m(k['spend'])} "
                      f"低于止损线 {_m(2 * aov * t)}，再给些曝光")
        if k["imp"] < params["impFloor"] and cls not in ("无效", "亏损"):
            reason += "；曝光偏低（可提价或放宽匹配）"
        out.append({"prio": prio, "cls": cls, "act": act, "camp": k["camp"], "adg": k["adg"],
                    "kw": k["kw"], "mt": k["mt"], "mtRaw": k["mtRaw"], "delta": delta,
                    "newBid": new_bid, "curBid": proxy, "clk": k["clk"], "spend": k["spend"],
                    "sales": k["sales"], "orders": k["orders"], "acos": k["acos"], "cvr": k["cvr"],
                    "reason": reason})
    out.sort(key=lambda a: (PRIO_ORDER[a["prio"]], -a["spend"]))
    return out


def build_harvest(st_rows: List[Dict[str, Any]], kw_exact: set) -> List[Dict[str, Any]]:
    best: Dict[str, Dict[str, Any]] = {}
    for s in st_rows:
        if not valid_st(s["st"]):
            continue
        if s["mt"] not in ("broad", "phrase", "auto"):
            continue
        if s["cls"] not in ("优秀", "良好"):
            continue
        if canon(s["st"]) == canon(s["kw"] or ""):
            continue
        key = canon(s["st"])
        old = best.get(key)
        item = {"st": s["st"], "camp": s["camp"], "adg": s["adg"], "srcMt": s["mt"], "cls": s["cls"],
                "clk": s["clk"], "spend": s["spend"], "sales": s["sales"], "orders": s["orders"],
                "acos": s["acos"]}
        if old is None or item["orders"] > old["orders"] or (
                item["orders"] == old["orders"] and item["acos"] < old["acos"]):
            best[key] = item
    rows = []
    for h in best.values():
        h["exists"] = canon(h["st"]) in kw_exact
        h["sug"] = "已有精准词：核对出价与预算" if h["exists"] else "新增精准词"
        rows.append(h)
    rows.sort(key=lambda h: (-h["sales"], -h["orders"]))
    return rows


def build_conflicts(st_rows: List[Dict[str, Any]], params: Dict[str, float], aov: float) -> List[Dict[str, Any]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for s in st_rows:
        if not valid_st(s["st"]) or s["clk"] <= 0:
            continue
        groups.setdefault(canon(s["st"]), []).append(s)
    t = params["target"] / 100.0
    out = []
    for arr in groups.values():
        locs = {f"{s['camp']}|{s['adg']}|{s['kw']}|{s['mt']}" for s in arr}
        tot_clk = sum(s["clk"] for s in arr)
        if len(locs) < 2 or tot_clk < params["minClicks"]:
            continue
        w = sorted(arr, key=lambda s: (-s["orders"], s["acos"], -s["sales"]))[0]
        losers = []
        for s in arr:
            if s is w:
                continue
            if s["orders"] == 0 and s["spend"] >= aov * t:
                sug = "否定（精准）"
            elif math.isfinite(s["acos"]) and math.isfinite(w["acos"]) and s["acos"] > w["acos"] * 1.5:
                sug = "降价或否定，流量让给最优位"
            else:
                sug = "观察"
            losers.append({"camp": s["camp"], "adg": s["adg"], "kw": s["kw"], "mt": s["mt"],
                           "cls": s["cls"], "clk": s["clk"], "spend": s["spend"],
                           "orders": s["orders"], "acos": s["acos"], "sug": sug})
        out.append({"st": arr[0]["st"], "locs": len(locs), "totClk": tot_clk,
                    "winner": f"{w['camp']} / {w['adg']}（{MT_LABEL[w['mt']]}，订单 {_n(w['orders'])}，ACOS {_p(w['acos'])}, 花费 {_m(w['spend'])}）",
                    "losers": losers})
    out.sort(key=lambda c: -c["totClk"])
    return out


def build_negatives(st_rows: List[Dict[str, Any]], roots: List[Dict[str, Any]],
                    conflicts: List[Dict[str, Any]], params: Dict[str, float], aov: float) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()

    def push(o: Dict[str, Any]) -> None:
        key = (o["type"], canon(o["word"]), o["camp"], o["adg"])
        if key in seen:
            return
        seen.add(key)
        out.append(o)

    for s in st_rows:
        if s["cls"] == "无效" and valid_st(s["st"]) and s["clk"] >= params["minClicks"] and s["mt"] != "exact":
            push({"type": "精准否定", "word": s["st"], "camp": s["camp"], "adg": s["adg"],
                  "source": "规则", "clk": s["clk"], "spend": s["spend"],
                  "reason": f"点击 {_n(s['clk'])} 次 0 订单，花费 {_m(s['spend'])}（允许预算 {_m(s['allowed'])}）"})
    for r in roots:
        if r["type"] == "亏损":
            push({"type": "词组否定", "word": r["tok"], "camp": "", "adg": "", "source": "规则",
                  "clk": r["clk"], "spend": r["spend"],
                  "reason": f"出现在 {r['terms']:.0f} 个无效搜索词中，累计花费 {_m(r['spend'])} 仍 0 销售额"})
    for c in conflicts:
        for l in c["losers"]:
            if l["sug"] != "否定（精准）":
                continue
            push({"type": "精准否定", "word": c["st"], "camp": l["camp"], "adg": l["adg"],
                  "source": "互搏检测", "clk": l["clk"], "spend": l["spend"],
                  "reason": "同词多组投放，流量已集中到更优位置"
                            + (f"，此处 0 订单却花费 {_m(l['spend'])}" if l["orders"] == 0 else "")})
    return out


def _m(v) -> str:
    return f"{v:,.2f}" if v is not None and math.isfinite(v) else "-"


def _n(v, d=0) -> str:
    return f"{v:,.{d}f}" if v is not None and math.isfinite(v) else "-"


def _p(x, d=1) -> str:
    return "-" if x is None or not math.isfinite(x) else f"{x * 100:.{d}f}%"
