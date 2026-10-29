"""分析流水线：解析后的记录 → 完整分析结果（引擎对外唯一入口）。"""
import math
from typing import Any, Dict, List

from .classify import compute_aov, group_and_classify, kpi_of
from .mining import build_combos, build_roots
from .parser import canon, valid_st
from .rules import build_actions, build_conflicts, build_harvest, build_negatives

DEFAULT_PARAMS: Dict[str, float] = {
    "target": 25.0, "ecvr": 10.0, "minClicks": 8.0, "aovOverride": 0.0,
    "upCap": 30.0, "downCap": 50.0, "floor": 0.05, "impFloor": 500.0,
}


def normalize_params(params: Dict[str, Any]) -> Dict[str, float]:
    out = dict(DEFAULT_PARAMS)
    for k in out:
        if k in params and params[k] is not None:
            try:
                out[k] = float(params[k])
            except (TypeError, ValueError):
                pass
    out["target"] = max(1.0, out["target"])
    out["ecvr"] = max(1.0, out["ecvr"])
    out["minClicks"] = max(1.0, out["minClicks"])
    out["downCap"] = max(1.0, out["downCap"])
    out["upCap"] = max(1.0, out["upCap"])
    out["floor"] = max(0.01, out["floor"])
    out["impFloor"] = max(0.0, out["impFloor"])
    out["aovOverride"] = max(0.0, out["aovOverride"])
    return out


def run_analysis(records: List[Dict[str, Any]], params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    p = normalize_params(params or {})
    aov, aov_assumed = compute_aov(records, p)
    st_rows, kw_rows = group_and_classify(records, p, aov)
    kw_exact = {canon(k["kw"]) for k in kw_rows if k["mt"] == "exact"}
    waste_st = {canon(s["st"]) for s in st_rows if s["cls"] == "无效" and valid_st(s["st"])}
    actions = build_actions(kw_rows, p, aov)
    harvest = build_harvest(st_rows, kw_exact)
    roots, _loss_roots = build_roots(st_rows, p, aov)
    combos = build_combos(st_rows, kw_exact, waste_st)
    conflicts = build_conflicts(st_rows, p, aov)
    negatives = build_negatives(st_rows, roots, conflicts, p, aov)
    base = kpi_of(records, st_rows, aov, aov_assumed)
    return {
        "kpi": base["kpi"], "dist": base["dist"], "aov": base["aov"],
        "aovAssumed": base["aovAssumed"],
        "st": st_rows, "actions": actions, "harvest": harvest,
        "roots": roots, "combos": combos, "conflicts": conflicts, "negatives": negatives,
    }


def sanitize(obj: Any) -> Any:
    """把 float('inf') 转为 None，保证 JSON 合法。"""
    if isinstance(obj, float):
        return None if not math.isfinite(obj) else obj
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    return obj
