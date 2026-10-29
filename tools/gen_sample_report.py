# -*- coding: utf-8 -*-
"""
生成「亚马逊搜索词报告」示例 CSV（模拟中文后台导出格式，品类：保温杯）
用法：python gen_sample_report.py   →  输出 亚马逊搜索词报告-示例.csv（UTF-8 带 BOM，Excel 可直接打开）
"""
import csv
import random

random.seed(20261029)
PRICE = [18.99, 21.99, 25.99, 29.99, 32.99]
OUT = '亚马逊搜索词报告-示例.csv'

HEADERS = ['广告活动', '广告组', '匹配类型', '客户搜索词', '关键词', '展示量', '点击量',
           '点击率', '平均每次点击费用(CPC)', '花费', '七天总销售额', '七天总订单数（#）',
           '七天总销量', 'ACOS']

rows = []


def add(camp, adg, kw, mt, st, quality):
    imp = clk = 0
    cpc = spend = sales = orders = 0.0
    if quality == 'good':
        orders = random.randint(1, 4)
        acos = round(random.uniform(0.08, 0.24), 3)
        sales = orders * random.choice(PRICE)
        cvr = random.uniform(0.09, 0.19)
        clk = max(orders, round(orders / cvr))
        spend = sales * acos
        imp = round(clk / random.uniform(0.02, 0.06))
    elif quality == 'mid':
        if random.random() < 0.35:
            orders = 1
            acos = round(random.uniform(0.32, 0.58), 3)
            sales = orders * random.choice(PRICE)
            cvr = random.uniform(0.04, 0.08)
            clk = round(orders / cvr)
            spend = sales * acos
        else:
            clk = random.randint(4, 8)
            spend = clk * random.uniform(0.4, 0.9)
        imp = round(max(1, clk) / random.uniform(0.015, 0.045))
    elif quality == 'waste':
        clk = random.randint(10, 28)
        cpc = round(random.uniform(0.5, 1.3), 2)
        spend = clk * cpc
        imp = round(clk / random.uniform(0.008, 0.028))
    elif quality == 'lowimp':
        imp = random.randint(30, 210)
        clk = random.randint(0, 2)
        spend = clk * random.uniform(0.4, 0.9)
        if random.random() < 0.25:
            orders = 1
            sales = random.choice(PRICE)
            spend = sales * 0.2
    cpc = round(spend / clk, 2) if clk > 0 else 0
    if clk > 0:
        spend = round(cpc * clk, 2)
    else:
        spend = round(spend, 2)
    ctr = (clk / imp * 100) if imp else 0
    acos_pct = (spend / sales * 100) if sales else ''
    rows.append([camp, adg, mt, st, kw, imp, clk, f'{ctr:.2f}%', f'{cpc:.2f}',
                 f'{spend:.2f}', f'{sales:.2f}' if sales else '0.00', orders,
                 orders, f'{acos_pct:.2f}%' if acos_pct != '' else ''])


EX, PH, BR, AU = '精准匹配', '词组匹配', '广泛匹配', '紧密匹配'

# 精准计划：核心词 + 长尾词
core = [('coffee tumbler', 'good'), ('insulated tumbler', 'good'), ('travel coffee mug', 'good'),
        ('stainless steel tumbler', 'mid'), ('coffee cup with lid', 'mid'),
        ('glass tumbler with straw', 'waste'), ('tumbler with handle', 'good'),
        ('40 oz tumbler', 'good'), ('mug warmer', 'waste'), ('water filter pitcher', 'mid')]
for kw, q in core:
    add('SP-保温杯-精准', '核心词', kw, EX, kw, q)

tail = [('insulated coffee tumbler with handle', 'good'), ('coffee tumbler 40 oz with handle', 'good'),
        ('tumbler with handle and straw 30 oz', 'mid'), ('travel mug leak proof', 'good'),
        ('coffee tumbler dishwasher safe', 'mid'), ('insulated tumbler for hot drinks', 'lowimp'),
        ('slim tumbler fits cup holder', 'good'), ('kids water bottle', 'waste')]
for kw, q in tail:
    add('SP-保温杯-精准', '长尾词', kw, EX, kw, q)

# 词组计划：词组关键词 × 修饰词
mods = ['with handle', '40 oz', 'with straw', 'leak proof', 'stainless steel', 'for coffee', '1 pack', 'dishwasher safe']
for kw, q in [('tumbler with handle', 'good'), ('coffee tumbler', 'mid'), ('insulated water bottle', 'waste')]:
    for m in random.sample(mods, random.randint(4, 7)):
        add('SP-保温杯-词组', '词组组', kw, PH, f'{kw} {m}'.strip(), q if q == 'waste' else (random.random() < 0.55 and 'good' or 'mid'))

# 广泛计划：部分无关流量
noise = ['hydro flask accessories', 'yeti lid replacement', 'water bottle stickers',
         'bottle brush cleaner', 'coffee beans whole arabica', 'car cup holder expander',
         'silicone straw tips', 'lunch box ice pack']
for kw, q in [('tumbler insulated', 'good'), ('coffee mug', 'mid'), ('thermos flask', 'waste')]:
    add('SP-保温杯-广泛', '广泛组', kw, BR, kw, q)
    for _ in range(random.randint(4, 8)):
        if random.random() < 0.5:
            st = random.choice(noise)
            qq = 'waste'
        else:
            st = f'{kw} {random.choice(mods)}'
            qq = 'waste' if q == 'waste' else (random.random() < 0.4 and 'good' or (random.random() < 0.7 and 'mid' or 'waste'))
        add('SP-保温杯-广泛', '广泛组', kw, BR, st, qq)

# 自动计划：占位关键词 + 搜索词
auto_terms = [('insulated tumbler with handle', 'good'), ('coffee tumbler leak proof', 'good'),
              ('smoothie blender', 'waste'), ('food jar thermos', 'waste'),
              ('tumbler 20 oz', 'mid'), ('wine tumbler', 'waste')]
for st, q in auto_terms:
    add('SP-保温杯-自动', '自动组', '（自动投放）', AU, st, q)

# 互搏：同一优质搜索词同时出现在精准与词组（词组侧表现差）
add('SP-保温杯-词组', '词组组', 'coffee tumbler', PH, 'insulated coffee tumbler with handle', 'waste')

random.shuffle(rows)
with open(OUT, 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(HEADERS)
    w.writerows(rows)
print(f'OK -> {OUT} ({len(rows)} rows)')
