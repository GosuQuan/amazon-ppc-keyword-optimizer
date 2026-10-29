"""R-T0 测试边界的 pytest 移植：与前端自检集同一构造数据与断言。"""
import pytest

from app.engine.parser import parse_text
from app.engine.pipeline import run_analysis
from app.engine.selftest import FIXED_PARAMS, build_test_records


@pytest.fixture(scope="module")
def R():
    return run_analysis(build_test_records(), FIXED_PARAMS)


def st_of(R, st):
    s = [x for x in R["st"] if x["st"] == st]
    assert s, f"搜索词 {st} 不存在"
    return s[0]


def act_of(R, kw):
    a = [x for x in R["actions"] if x["kw"] == kw]
    assert a, f"关键词 {kw} 无动作"
    return a[0]


def neg_has(R, word, typ=None):
    return any(n["word"] == word and (typ is None or n["type"] == typ) for n in R["negatives"])


# ---------- 解析 ----------
def test_parse_quoted_comma():
    r = parse_text('广告活动,广告组,关键词,匹配类型,客户搜索词,展示量,点击量,花费,七天总销售额,七天总订单数（#）\r\n'
                   '"计划A,带逗号",组1,"词,带逗号",精准匹配,"词,带逗号",100,10,5,20,2', 't1')
    assert len(r) == 1
    assert r[0]["camp"] == "计划A,带逗号"
    assert r[0]["kw"] == "词,带逗号"
    assert r[0]["clk"] == 10 and r[0]["sales"] == 20 and r[0]["orders"] == 2
    assert r[0]["mt"] == "exact"


def test_parse_bilingual_headers():
    r = parse_text('广告活动,广告组,匹配类型,客户搜索词,关键词,展示量,点击量,点击率,平均每次点击费用(CPC),花费,'
                   '七天总销售额(7 Day Total Sales),七天总订单数(#)\r\nC,G,广泛匹配,S,K,1000,20,2%,0.5,10,40.00,2', 't2')
    assert r[0]["clk"] == 20 and r[0]["sales"] == 40 and r[0]["orders"] == 2
    assert r[0]["cpc"] == 0.5 and r[0]["spend"] == 10


def test_parse_money_thousands():
    r = parse_text('广告活动,广告组,关键词,匹配类型,客户搜索词,展示量,点击量,花费\r\n'
                   'C,G,K,精准匹配,S,10,5,"$1,234.56"', 't3')
    assert r[0]["spend"] == 1234.56


def test_parse_empty_raises():
    with pytest.raises(ValueError, match="empty"):
        parse_text("", "empty.csv")


def test_parse_header_only_raises():
    with pytest.raises(ValueError, match="hdronly"):
        parse_text("广告活动,点击量\r\n", "hdronly.csv")


def test_parse_dirty_row_filtered():
    r = parse_text('广告活动,广告组,关键词,匹配类型,客户搜索词,展示量,点击量,花费\r\n'
                   'A,G,K,精准匹配,S,abc,-,—', 't4')
    assert len(r) == 0


# ---------- 分级 ----------
def test_levels(R):
    assert st_of(R, "exc a")["cls"] == "优秀"
    assert st_of(R, "exc b")["cls"] == "优秀"
    assert st_of(R, "good a")["cls"] == "良好"
    assert st_of(R, "high a")["cls"] == "偏高"
    assert st_of(R, "loss a")["cls"] == "亏损"
    assert st_of(R, "waste term a")["cls"] == "无效"
    assert st_of(R, "waste term b")["cls"] == "无效"  # spend=10 边界
    assert st_of(R, "waste exact term")["cls"] == "无效"
    assert st_of(R, "obs a")["cls"] == "观察"
    assert st_of(R, "obs b")["cls"] == "观察"
    assert st_of(R, "pot a")["cls"] == "潜力"
    assert st_of(R, "pot b")["cls"] == "潜力"  # 7.9 < 2×允许预算=8 边界


def test_allowed_budget(R):
    assert abs(st_of(R, "pot a")["allowed"] - 5) < 1e-9


# ---------- 调价 ----------
def test_action_excellent(R):
    a = act_of(R, "exc a")
    assert a["act"] == "提价抢量" and a["delta"] == 30
    assert abs(a["newBid"] - 0.9) < 0.011


def test_action_good(R):
    assert act_of(R, "good a")["act"] == "维持"


def test_action_high(R):
    a = act_of(R, "high a")
    assert a["act"] == "小幅降价"
    assert abs(a["newBid"] - 0.25) < 0.011


def test_action_loss(R):
    a = act_of(R, "loss a")
    assert a["act"] == "降价" and a["delta"] == -50
    assert abs(a["newBid"] - 0.25) < 0.011


def test_action_waste_broad(R):
    a = act_of(R, "waste a")
    assert a["act"] == "降价并否定该搜索词"
    assert abs(a["newBid"] - 0.575) < 0.011


def test_action_waste_exact(R):
    a = act_of(R, "waste exact")
    assert "暂停" in a["act"]
    assert not neg_has(R, "waste exact term")


def test_action_observe(R):
    a = act_of(R, "obs a")
    assert a["act"] == "维持观察" and a["delta"] == 0 and a["newBid"] is None


# ---------- 否定 ----------
def test_negatives(R):
    assert neg_has(R, "waste term a", "精准否定")
    assert neg_has(R, "waste term b", "精准否定")
    assert not neg_has(R, "obs a") and not neg_has(R, "pot a")


def test_roots(R):
    junk = [x for x in R["roots"] if x["tok"] == "junk"]
    assert junk and junk[0]["type"] == "亏损"
    assert neg_has(R, "junk", "词组否定")
    exc = [x for x in R["roots"] if x["tok"] == "exc"]
    assert exc and exc[0]["type"] == "盈利"
    assert not neg_has(R, "exc")


# ---------- 收割 / 组合 / 互搏 ----------
def test_harvest(R):
    h = [x for x in R["harvest"] if x["st"] == "harvest winner"]
    assert h and not h[0]["exists"] and h[0]["sug"] == "新增精准词"
    d = [x for x in R["harvest"] if x["st"] == "harvest dup"]
    assert d and d[0]["exists"]
    assert not any(x["st"] == "exc a" for x in R["harvest"])


def test_combos(R):
    c = [x for x in R["combos"] if x["pair"] == "alpha beta"]
    assert c and c[0]["n"] == 2


def test_conflicts(R):
    c = [x for x in R["conflicts"] if x["st"] == "conflict term"]
    assert c and c[0]["locs"] == 2
    assert c[0]["losers"][0]["adg"] == "G6"
    assert c[0]["losers"][0]["sug"] == "否定（精准）"


def test_idempotent(R):
    n1 = len(R["actions"])
    R2 = run_analysis(build_test_records(), FIXED_PARAMS)
    assert n1 == len(R2["actions"])
