"""内置自检（R-T0 回归测试集）：与单文件版 JS 引擎同一组构造数据与断言。"""
from typing import Any, Callable, Dict, List

from .parser import parse_text
from .pipeline import run_analysis

FIXED_PARAMS: Dict[str, float] = {"target": 25.0, "ecvr": 10.0, "minClicks": 8.0, "aovOverride": 20.0,
                                  "upCap": 30.0, "downCap": 50.0, "floor": 0.05, "impFloor": 500.0}


def tr(camp, adg, kw, mt_raw, st, imp, clk, cpc, spend, sales, orders):
    from .parser import norm_match
    return {"camp": camp, "adg": adg, "kw": kw, "mtRaw": mt_raw, "mt": norm_match(mt_raw), "st": st,
            "imp": imp, "clk": clk, "cpc": cpc, "spend": spend, "sales": sales, "orders": orders,
            "units": orders, "date": ""}


def build_test_records() -> List[Dict[str, Any]]:
    return [
        tr('T1', 'G1', 'exc a', '精准匹配', 'exc a', 500, 10, 0.6, 6, 60, 2),
        tr('T1', 'G1', 'exc b', '精准匹配', 'exc b', 800, 20, 0.25, 5, 50, 1),
        tr('T1', 'G1', 'good a', '精准匹配', 'good a', 400, 10, 0.8, 8, 40, 1),
        tr('T1', 'G1', 'high a', '精准匹配', 'high a', 600, 20, 0.45, 9, 30, 1),
        tr('T1', 'G1', 'loss a', '精准匹配', 'loss a', 700, 20, 0.5, 10, 20, 1),
        tr('T1', 'G2', 'waste a', '广泛匹配', 'waste term a', 1500, 20, 1, 20, 0, 0),
        tr('T1', 'G2', 'waste b', '广泛匹配', 'waste term b', 600, 8, 1.25, 10, 0, 0),
        tr('T1', 'G2', 'waste exact', '精准匹配', 'waste exact term', 500, 10, 1.5, 15, 0, 0),
        tr('T1', 'G3', 'obs a', '精准匹配', 'obs a', 300, 7, 0.43, 3, 0, 0),
        tr('T1', 'G3', 'obs b', '精准匹配', 'obs b', 150, 3, 0.33, 1, 0, 0),
        tr('T1', 'G3', 'pot a', '精准匹配', 'pot a', 350, 10, 0.5, 5, 0, 0),
        tr('T1', 'G3', 'pot b', '精准匹配', 'pot b', 350, 8, 0.99, 7.9, 0, 0),
        tr('T1', 'G4', 'broad kw', '广泛匹配', 'harvest winner', 900, 12, 0.83, 10, 80, 2),
        tr('T1', 'G4', 'broad kw2', '广泛匹配', 'harvest dup', 400, 8, 0.75, 6, 30, 1),
        tr('T1', 'G4', 'harvest dup', '精准匹配', 'harvest dup', 500, 10, 0.6, 6, 30, 1),
        tr('T1', 'G5', 'conflict kw', '精准匹配', 'conflict term', 500, 10, 0.6, 6, 60, 2),
        tr('T1', 'G6', 'other kw', '广泛匹配', 'conflict term', 1200, 12, 1.08, 13, 0, 0),
        tr('T1', 'G7', 'combo kw1', '广泛匹配', 'alpha beta gamma', 500, 10, 0.6, 6, 40, 1),
        tr('T1', 'G7', 'combo kw2', '广泛匹配', 'alpha beta delta', 500, 10, 0.6, 6, 40, 1),
        tr('T1', 'G8', 'junk kw1', '广泛匹配', 'junk red', 700, 10, 1.1, 11, 0, 0),
        tr('T1', 'G8', 'junk kw2', '广泛匹配', 'junk blue', 700, 10, 1.1, 11, 0, 0),
        tr('T1', 'G8', 'junk kw3', '广泛匹配', 'junk green', 700, 10, 1.1, 11, 0, 0),
    ]


def _tests() -> List[Dict[str, Any]]:
    R = run_analysis(build_test_records(), FIXED_PARAMS)
    state = R
    st_by = {s["st"]: s for s in R["st"]}
    acts = R["actions"]
    negs = R["negatives"]
    harvest = R["harvest"]
    combos = R["combos"]
    conflicts = R["conflicts"]
    roots = R["roots"]

    def A(cond, msg="断言失败"):
        if not cond:
            raise AssertionError(msg)

    def anear(v, exp, label="数值"):
        A(isinstance(v, (int, float)) and abs(v - exp) < 0.011, f"{label} 应≈{exp}，实际 {v}")

    def act_of(kw):
        a = [x for x in acts if x["kw"] == kw]
        A(a, f"关键词 {kw} 无动作")
        return a[0]

    def neg_has(word, typ=None):
        return any(n["word"] == word and (typ is None or n["type"] == typ) for n in negs)

    T: List[Dict[str, Any]] = []

    def t(name: str, fn: Callable[[], str]):
        try:
            msg = fn()
            T.append({"name": name, "passed": True, "msg": msg or ""})
        except AssertionError as e:
            T.append({"name": name, "passed": False, "msg": str(e)})
        except Exception as e:  # noqa: BLE001
            T.append({"name": name, "passed": False, "msg": f"异常：{e}"})

    def cls_of(st):
        s = st_by.get(st)
        A(s is not None, f"搜索词 {st} 不存在")
        return s["cls"]

    t("解析：引号内逗号", lambda: (lambda r: (A(len(r) == 1, "应1行"),
        A(r[0]["camp"] == "计划A,带逗号", "活动名"), A(r[0]["kw"] == "词,带逗号", "关键词"),
        A(r[0]["clk"] == 10 and r[0]["sales"] == 20 and r[0]["orders"] == 2, "数值"),
        A(r[0]["mt"] == "exact", "匹配类型"), "OK")[5])(
        parse_text('广告活动,广告组,关键词,匹配类型,客户搜索词,展示量,点击量,花费,七天总销售额,七天总订单数（#）\r\n'
                   '"计划A,带逗号",组1,"词,带逗号",精准匹配,"词,带逗号",100,10,5,20,2', 't1')))

    t("解析：双语表头映射", lambda: (lambda r: (A(len(r) == 1, "行数"), A(r[0]["clk"] == 20, "点击量应=20"),
        A(r[0]["sales"] == 40, "双语销售额应=40"), A(r[0]["orders"] == 2, "订单(#)=2"),
        A(r[0]["cpc"] == 0.5, "CPC列"), A(r[0]["spend"] == 10, "花费"), "OK")[6])(
        parse_text('广告活动,广告组,匹配类型,客户搜索词,关键词,展示量,点击量,点击率,平均每次点击费用(CPC),花费,'
                   '七天总销售额(7 Day Total Sales),七天总订单数(#)\r\nC,G,广泛匹配,S,K,1000,20,2%,0.5,10,40.00,2', 't2')))

    t("解析：货币符与千分位", lambda: (lambda r: (A(len(r) == 1 and r[0]["spend"] == 1234.56,
        f"花费应=1234.56 实际{r[0]['spend']}"), "OK")[1])(
        parse_text('广告活动,广告组,关键词,匹配类型,客户搜索词,展示量,点击量,花费\r\nC,G,K,精准匹配,S,10,5,"$1,234.56"', 't3')))

    def _empty():
        try:
            parse_text("", "empty.csv")
        except ValueError as e:
            A("empty" in str(e), "错误应含文件名")
            return "OK"
        A(False, "应抛错")

    t("解析：空文件报错", _empty)

    def _hdronly():
        try:
            parse_text("广告活动,点击量\r\n", "hdronly.csv")
        except ValueError as e:
            A("hdronly" in str(e), "错误应含文件名")
            return "OK"
        A(False, "应抛错")

    t("解析：仅表头报错", _hdronly)

    t("解析：脏数值行被安全过滤", lambda: (lambda r: (A(len(r) == 0, "全空脏行应被过滤"), "OK")[1])(
        parse_text('广告活动,广告组,关键词,匹配类型,客户搜索词,展示量,点击量,花费\r\nA,G,K,精准匹配,S,abc,-,—', 't4')))

    t("分级：优秀", lambda: (A(cls_of("exc a") == "优秀"), A(cls_of("exc b") == "优秀"), "OK")[2])
    t("分级：良好", lambda: (A(cls_of("good a") == "良好"), "OK")[1])
    t("分级：偏高", lambda: (A(cls_of("high a") == "偏高"), "OK")[1])
    t("分级：亏损", lambda: (A(cls_of("loss a") == "亏损"), "OK")[1])
    t("分级：无效（含=边界）", lambda: (A(cls_of("waste term a") == "无效"), A(cls_of("waste term b") == "无效", "spend10边界"),
        A(cls_of("waste exact term") == "无效", "精准投放也分级"), "OK")[3])
    t("分级：观察", lambda: (A(cls_of("obs a") == "观察"), A(cls_of("obs b") == "观察"), "OK")[2])
    t("分级：潜力（含边界）", lambda: (A(cls_of("pot a") == "潜力"), A(cls_of("pot b") == "潜力", "7.9<8边界"), "OK")[2])

    def _allowed():
        s = st_by.get("pot a")
        A(s is not None and abs(s["allowed"] - 5) < 1e-9, f"allowed 应=5 实际 {s['allowed'] if s else '?'}")
        return "OK"

    t("允许预算公式", _allowed)

    def _a1():
        a = act_of("exc a")
        A(a["act"] == "提价抢量", a["act"])
        A(a["delta"] == 30, f"幅度应+30 实际{a['delta']}")
        anear(a["newBid"], 0.9, "建议出价")
        return "OK"

    t("调价：优秀→提价抢量+30%", _a1)
    t("调价：良好→维持", lambda: (A(act_of("good a")["act"] == "维持"), "OK")[1])

    def _a3():
        a = act_of("high a")
        A(a["act"] == "小幅降价", a["act"])
        anear(a["newBid"], 0.25, "应=盈利上限0.25")
        return "OK"

    t("调价：偏高→降价至盈利上限", _a3)

    def _a4():
        a = act_of("loss a")
        A(a["act"] == "降价", a["act"])
        anear(a["newBid"], 0.25, "newBid")
        A(a["delta"] == -50, f"幅度截断-50 实际{a['delta']}")
        return "OK"

    t("调价：亏损→降价", _a4)

    def _a5():
        a = act_of("waste a")
        A(a["act"] == "降价并否定该搜索词", a["act"])
        anear(a["newBid"], 0.575, "newBid≈proxy半价")
        return "OK"

    t("调价：无效广泛→降价并否定", _a5)

    def _a6():
        a = act_of("waste exact")
        A("暂停" in a["act"], a["act"])
        A(not neg_has("waste exact term"), "精准投放无效词不得进否定清单")
        return "OK"

    t("调价：无效精准→暂停且不入否定", _a6)

    def _a7():
        a = act_of("obs a")
        A(a["act"] == "维持观察" and a["delta"] == 0 and a["newBid"] is None, "应维持观察")
        return "OK"

    t("调价：观察→维持观察", _a7)
    t("否定：无效词精准否定", lambda: (A(neg_has("waste term a", "精准否定")), A(neg_has("waste term b", "精准否定")), "OK")[2])
    t("否定：观察/潜力不否定", lambda: (A(not neg_has("obs a") and not neg_has("pot a")), "OK")[1])

    def _root_loss():
        r = [x for x in roots if x["tok"] == "junk"]
        A(r and r[0]["type"] == "亏损", "junk 应为亏损根")
        A(neg_has("junk", "词组否定"), "应有 junk 词组否定")
        return "OK"

    t("词根：亏损根→词组否定", _root_loss)

    def _root_profit():
        r = [x for x in roots if x["tok"] == "exc"]
        A(r and r[0]["type"] == "盈利", "exc 应为盈利根")
        A(not neg_has("exc"), "盈利根不得否定")
        return "OK"

    t("词根：盈利根不否定", _root_profit)

    def _h1():
        h = [x for x in harvest if x["st"] == "harvest winner"]
        A(h and not h[0]["exists"] and h[0]["sug"] == "新增精准词", "应新增精准词")
        return "OK"

    t("收割：优质搜索词建议新增精准", _h1)

    def _h2():
        h = [x for x in harvest if x["st"] == "harvest dup"]
        A(h and h[0]["exists"], "应标记已有精准词")
        return "OK"

    t("收割：已是精准词的提示", _h2)
    t("收割：st==kw 不收割", lambda: (A(not any(x["st"] == "exc a" for x in harvest)), "OK")[1])

    def _combo():
        s = st_by.get("alpha beta gamma")
        A(s is not None and s["cls"] == "优秀", "组合源词应优秀")
        c = [x for x in combos if x["pair"] == "alpha beta"]
        A(c and c[0]["n"] == 2, "alpha beta 应出现2次")
        return "OK"

    t("组合：相邻二元组扩展", _combo)

    def _conflict():
        c = [x for x in conflicts if x["st"] == "conflict term"]
        A(c, "应检出互搏")
        A(c[0]["locs"] == 2 and len(c[0]["losers"]) == 1, "输家1个")
        A(c[0]["losers"][0]["adg"] == "G6", "输家在G6")
        A(c[0]["losers"][0]["sug"] == "否定（精准）", "建议否定")
        return "OK"

    t("互搏：检出并建议否定输家", _conflict)

    def _idem():
        n1 = len(state["actions"])
        R2 = run_analysis(build_test_records(), FIXED_PARAMS)
        A(n1 == len(R2["actions"]), "动作数应一致")
        return "OK"

    t("幂等：重复分析结果一致", _idem)
    return T


def run_selftest() -> Dict[str, Any]:
    results = _tests()
    passed = sum(1 for r in results if r["passed"])
    return {"total": len(results), "passed": passed, "results": results}
