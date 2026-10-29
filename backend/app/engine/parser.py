"""CSV 解析：编码自适应（UTF-8/GB18030）、分隔符嗅探、中英/双语表头映射、脏数据防御。

移植自单文件版引擎（parser 函数族），行为与 R-T0 测试边界一致。
"""
import csv
import io
import re
from typing import Any, Dict, List, Tuple

CANON_STRIP = re.compile(r"[()（）#％%：:，,。·'\"“”\-—–_/\\]")

FIELDS: List[Tuple[str, List[str]]] = [
    ("mt", ["匹配类型", "匹配方式", "投放方式", "matchtype"]),
    ("ctr", ["点击率", "ctr"]),
    ("cpc", ["cpc", "costperclick", "平均每次点击费用", "平均点击费用", "每次点击费用", "平均单次点击费用"]),
    ("acos", ["acos", "广告投入产出比", "广告销售成本比"]),
    ("st", ["搜索词", "searchterm", "customersearchterm", "查询词"]),
    ("kw", ["关键词", "keyword", "targeting", "投放词", "投放关键词", "定向"]),
    ("camp", ["广告活动", "campaign", "广告系列", "活动名称"]),
    ("adg", ["广告组", "adgroup"]),
    ("sales", ["销售额", "totalsales", "7daytotalsales", "七天总销售额", "7天总销售额", "广告销售额", "sales"]),
    ("orders", ["订单", "orders", "totalorders", "七天内总订单数", "7天总订单数", "七天总订单"]),
    ("spend", ["花费", "spend", "cost", "广告花费", "总花费", "成本", "消费"]),
    ("clk", ["点击量", "点击次数", "clicks", "点击", "click"]),
    ("imp", ["展示量", "impressions", "曝光", "展示次数", "曝光量"]),
    ("units", ["销量", "units", "unitssold", "七天总销量", "7天总销量", "销售数量"]),
    ("cur", ["币种", "currency"]),
    ("date", ["日期", "date", "周", "week", "开始日期", "结束日期", "startdate", "enddate"]),
]

AUTO_KW_RE = re.compile(
    r"closematch|loosematch|substitutes|complements|紧密匹配|宽泛匹配|同类商品|关联商品|自动投放|自动广告"
)


def canon(s: Any) -> str:
    if s is None:
        return ""
    s = str(s).lower()
    s = re.sub(r"[\s\u3000]+", "", s)
    return CANON_STRIP.sub("", s)


def norm_match(s: Any) -> str:
    c = canon(s)
    if not c:
        return "other"
    if re.search(r"broad|广泛", c):
        return "broad"
    if re.search(r"phrase|词组", c):
        return "phrase"
    if re.search(r"exact|精准", c):
        return "exact"
    if re.search(r"close|loose|substitut|complement|紧密|宽泛|同类|关联", c):
        return "auto"
    return "other"


MT_LABEL = {"broad": "广泛", "phrase": "词组", "exact": "精准", "auto": "自动", "other": "-"}


def parse_num(v: Any) -> float:
    s = re.sub(r"[^0-9.\-]", "", str(v if v is not None else ""))
    if not s or s == "-" or s == ".":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def is_placeholder_kw(k: Any) -> bool:
    if not k:
        return True
    c = canon(k)
    if not c or c in ("—", "-"):
        return True
    return bool(AUTO_KW_RE.search(c))


def valid_st(st: Any) -> bool:
    if not st:
        return False
    c = str(st).strip()
    return bool(c) and c not in ("—", "-")


def detect_delim(first_line: str) -> str:
    def cnt(ch: str) -> int:
        return first_line.count(ch)

    tab, com, sem = cnt("\t"), cnt(","), cnt(";")
    if tab >= com and tab >= sem and tab > 0:
        return "\t"
    if sem > com:
        return ";"
    return ","


def decode_bytes(raw: bytes) -> str:
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("gb18030", errors="replace")


def map_headers(header: List[str]) -> Dict[str, int]:
    hs = [canon(c) for c in header]
    idx: Dict[str, int] = {}
    taken = set()
    for field, aliases in FIELDS:
        for i, h in enumerate(hs):
            if i in taken:
                continue
            if not h:
                continue
            hit = False
            for a in aliases:
                if h == a or a in h:
                    idx[field] = i
                    taken.add(i)
                    hit = True
                    break
            if hit:
                break
    return idx


def row_to_record(cells: List[str], idx: Dict[str, int]) -> Dict[str, Any]:
    def get(f: str) -> str:
        j = idx.get(f)
        if j is None or j >= len(cells):
            return ""
        v = cells[j]
        return "" if v is None else str(v).strip()

    def num(f: str) -> float:
        return parse_num(get(f))

    rec: Dict[str, Any] = {
        "camp": get("camp") or "(未命名广告活动)",
        "adg": get("adg") or "(未命名广告组)",
        "kw": get("kw"),
        "mtRaw": get("mt"),
        "st": get("st"),
        "imp": num("imp"),
        "clk": num("clk"),
        "spend": num("spend"),
        "sales": num("sales"),
        "orders": num("orders"),
        "units": num("units"),
        "cpc": num("cpc"),
        "date": get("date"),
    }
    rec["mt"] = norm_match(rec["mtRaw"])
    if rec["clk"] > 0 and rec["cpc"] <= 0:
        rec["cpc"] = rec["spend"] / rec["clk"]
    if rec["spend"] <= 0 and rec["clk"] > 0 and rec["cpc"] > 0:
        rec["spend"] = round(rec["cpc"] * rec["clk"], 2)
    return rec


def valid_record(r: Dict[str, Any]) -> bool:
    has_metric = r["imp"] > 0 or r["clk"] > 0 or r["spend"] > 0
    has_target = valid_st(r["st"]) or (r["kw"] and not is_placeholder_kw(r["kw"]))
    return bool(has_metric and has_target)


def parse_text(text: str, name: str = "文件") -> List[Dict[str, Any]]:
    """解析单文件文本 → 记录列表；表头不可识别或无数据行时抛 ValueError。"""
    first = text.split("\n", 1)[0] if text else ""
    delim = detect_delim(first)
    rows = [r for r in csv.reader(io.StringIO(text), delimiter=delim) if any(str(c).strip() for c in r)]
    if len(rows) < 2:
        raise ValueError(f"{name}：没有数据行")
    idx = map_headers(rows[0])
    if not any(k in idx for k in ("clk", "imp", "spend", "st", "kw")):
        raise ValueError(f"{name}：无法识别表头，请确认是广告绩效/搜索词报表")
    out: List[Dict[str, Any]] = []
    for cells in rows[1:]:
        rec = row_to_record(cells, idx)
        if valid_record(rec):
            out.append(rec)
    return out


def parse_upload(raw: bytes, name: str) -> List[Dict[str, Any]]:
    return parse_text(decode_bytes(raw), name)
