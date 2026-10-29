"""内置示例数据（与单文件版 Demo 同风格：无线充电器品类，确定性随机）。"""
import random
from typing import Any, Dict, List

from .parser import norm_match

PRICE = [19.99, 24.99, 29.99, 39.99]


def _round2(v: float) -> float:
    return round(v + 1e-12, 2)


def demo_records() -> List[Dict[str, Any]]:
    rnd = random.Random(20261029)
    recs: List[Dict[str, Any]] = []

    def push(camp, adg, kw, mt_raw, st, q):
        imp = clk = 0
        spend = sales = orders = 0.0
        if q == "good":
            orders = 1 + rnd.randint(0, 2)
            acos = 0.08 + rnd.random() * 0.16
            sales = orders * rnd.choice(PRICE)
            cvr = 0.09 + rnd.random() * 0.10
            clk = max(orders, round(orders / cvr))
            spend = sales * acos
            imp = round(clk / (0.02 + rnd.random() * 0.05))
        elif q == "mid":
            if rnd.random() < 0.35:
                orders = 1
                acos = 0.32 + rnd.random() * 0.28
                sales = orders * rnd.choice(PRICE)
                cvr = 0.04 + rnd.random() * 0.04
                clk = round(orders / cvr)
                spend = sales * acos
            else:
                clk = 4 + rnd.randint(0, 3)
                spend = clk * (0.4 + rnd.random() * 0.5)
            imp = round(max(1, clk) / (0.015 + rnd.random() * 0.03))
        elif q == "waste":
            clk = 10 + rnd.randint(0, 17)
            cpc = 0.5 + rnd.random() * 0.8
            spend = clk * cpc
            imp = round(clk / (0.008 + rnd.random() * 0.02))
        elif q == "lowimp":
            imp = 30 + rnd.randint(0, 180)
            clk = rnd.randint(0, 2)
            spend = clk * (0.4 + rnd.random() * 0.6)
            if rnd.random() < 0.25:
                orders = 1
                sales = rnd.choice(PRICE)
                spend = sales * 0.2
        cpc = _round2(spend / clk) if clk > 0 else 0.0
        spend = _round2(cpc * clk) if clk > 0 else _round2(spend)
        recs.append({"camp": camp, "adg": adg, "kw": kw, "mtRaw": mt_raw, "mt": norm_match(mt_raw),
                     "st": st, "imp": imp, "clk": clk, "cpc": cpc, "spend": spend,
                     "sales": _round2(sales), "orders": orders, "units": orders, "date": ""})

    EX, PH, BR = "精准匹配", "词组匹配", "广泛匹配"
    core = [("wireless charger", "good"), ("magsafe charger", "good"), ("iphone 15 charger", "good"),
            ("fast wireless charger", "mid"), ("charging pad", "mid"), ("samsung wireless charger", "waste"),
            ("wireless charging stand", "good"), ("3 in 1 charging station", "good"),
            ("car phone charger mount", "waste"), ("usb c wall charger", "mid")]
    for kw, q in core:
        push("SP-无线充-精准", "核心词", kw, EX, kw, q)
    tail = [("wireless charger for iphone 15 pro max", "good"), ("magsafe charger for iphone 15", "good"),
            ("wireless charger samsung s24 ultra", "mid"), ("fast charging pad for galaxy", "waste"),
            ("wireless charger with adapter", "mid"), ("wireless charging pad white", "lowimp"),
            ("foldable wireless charger travel", "good")]
    for kw, q in tail:
        push("SP-无线充-精准", "长尾词", kw, EX, kw, q)
    mods = ["fast", "15w", "with cable", "slim", "for iphone 15", "for samsung s24", "white", "3 in 1", "magnetic"]
    for kw, q in [("wireless charger iphone", "good"), ("magsafe charger", "mid"), ("wireless pad", "mid")]:
        for m in mods[:4 + rnd.randint(0, 4)]:
            st = f"{kw} {m}".strip()
            push("SP-无线充-词组", "词组组", kw, PH, st, q if q == "waste" else ("good" if rnd.random() < 0.55 else "mid"))
    noise = ["phone case clear", "airpods pro case", "screen protector iphone 15", "usb c cable 6ft",
             "pop socket grip", "car mount magnetic", "watch band 44mm", "ipad case kids"]
    for kw, q in [("charger wireless", "good"), ("phone charger", "mid"), ("charging station", "waste")]:
        push("SP-无线充-广泛", "广泛组", kw, BR, kw, q)
        for _ in range(4 + rnd.randint(0, 3)):
            is_noise = rnd.random() < 0.5
            st = rnd.choice(noise) if is_noise else f"{kw} {rnd.choice(mods)}"
            push("SP-无线充-广泛", "广泛组", kw, BR, st,
                 "waste" if is_noise or q == "waste" else ("good" if rnd.random() < 0.4 else ("mid" if rnd.random() < 0.7 else "waste")))
    autos = ["紧密匹配", "宽泛匹配", "同类商品"]
    for i, mt_raw in enumerate(autos):
        st = ["magsafe wireless charger", "wireless charger 15w fast"][i] if i < 2 else rnd.choice(noise)
        q = "good" if i < 2 else ("waste" if i == 2 else "mid")
        push("SP-无线充-自动", "自动组", "（自动投放）", mt_raw, st, q)
    for i in range(4):
        push("SP-无线充-自动", "自动组", "（自动投放）", autos[1], rnd.choice(noise), "waste" if i < 2 else "mid")
    push("SP-无线充-词组", "词组组", "magsafe charger", PH, "magsafe charger for iphone 15", "waste")
    return recs
