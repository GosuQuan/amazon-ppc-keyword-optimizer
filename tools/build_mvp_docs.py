"""Build two self-contained review documents and their SVG diagrams."""
from pathlib import Path
import html
import re
import markdown

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'

def diagram(title, subtitle, rows, footer):
    width, height = 1200, 190 + len(rows) * 145
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(title)}">',
           '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10" fill="#5f7b9e"/></marker></defs>',
           f'<rect width="{width}" height="{height}" rx="20" fill="#f3f6fb"/>',
           f'<text x="45" y="52" font-size="30" font-family="Microsoft YaHei, sans-serif" font-weight="700" fill="#163655">{html.escape(title)}</text>',
           f'<text x="45" y="85" font-size="17" font-family="Microsoft YaHei, sans-serif" fill="#53697e">{html.escape(subtitle)}</text>']
    for r, row in enumerate(rows):
        gap = 20
        w = (1110 - (len(row) - 1) * gap) / len(row)
        y = 115 + r * 145
        for i, (heading, detail) in enumerate(row):
            x = 45 + i * (w + gap)
            out.append(f'<rect x="{x}" y="{y}" width="{w}" height="108" rx="12" fill="white" stroke="#b9cde3"/>')
            out.append(f'<rect x="{x}" y="{y}" width="6" height="108" rx="3" fill="#13847c"/>')
            out.append(f'<text x="{x+21}" y="{y+35}" font-size="21" font-family="Microsoft YaHei, sans-serif" font-weight="700" fill="#163655">{html.escape(heading)}</text>')
            for k, line in enumerate(detail.split('|')):
                out.append(f'<text x="{x+21}" y="{y+64+k*24}" font-size="16" font-family="Microsoft YaHei, sans-serif" fill="#53697e">{html.escape(line)}</text>')
        if r < len(rows)-1:
            out.append(f'<path d="M600 {y+111} L600 {y+138}" stroke="#5f7b9e" stroke-width="2" marker-end="url(#arrow)"/>')
    out.append(f'<text x="45" y="{height-25}" font-size="16" font-family="Microsoft YaHei, sans-serif" fill="#53697e">{html.escape(footer)}</text></svg>')
    return ''.join(out)

product = diagram('产品全景图 · 从报表到执行复盘', 'MVP：单账户 × 单站点 × 单币种 × 单 ASIN；以可信动作完成运营闭环', [
 [('数据接入', '搜索词绩效 + Bulk 实体快照|上下文校验 / 去重 / 异常提示'), ('可信诊断', '指标总览 / 规则分级 / 证据|真实 Bid 与估算分开')],
 [('动作中心', '改价 / 暂停 / 否词 / 收割|优先级与阻断原因'), ('人工审核', '待审 / 批准 / 拒绝|审批与执行资格独立')],
 [('执行交付', '批准 + 合格 → 批量操作草稿|保存导出快照 / 核对官方模板'), ('执行留痕', '用户在 Amazon 后台操作|记录实际执行日期与备注')],
 [('周期复盘', '新周期报表 / 前后与日均比较|周期不重叠 / 明确非因果'), ('后续扩展 P1 / P2', '多商品 / 广告位 / 结构与预算|外部词验证 / AI / 业务实验')]
], '反馈路径：复盘 → 下一轮诊断与动作；竞争优势需用同任务实测验证。')
tech = diagram('技术架构图 · 本地模块化单体', 'FastAPI + 原生 JavaScript + SQLite；旧分析工具保留，新执行链路独立校验', [
 [('浏览器工作台', 'workflow.html / workflow.js|导入、审核、导出、执行、复盘'), ('HTTP API', '/api/workflow/plans|同源请求 / 后端最终校验')],
 [('接入与上下文', 'CSV / TSV 类型区分|账户、站点、币种、ASIN 隔离'), ('事实与实体', '搜索词 → 绩效事实|Bulk → 真实 Bid、父 ID、Keyword ID')],
 [('规则与方案服务', '复用七级分级 / 明确动作范围|证据、优先级、预算参考'), ('执行门禁', '审核状态 / 实体 / Bid / 冲突|不允许客户端绕过')],
 [('SQLite 持久化', '方案 / 审核 / 导出快照|执行记录 / 复盘结果'), ('交付与反馈', 'SP TSV 草稿 → 人工后台操作|执行后新周期 → 比较与复盘')]
], '测试贯穿：输入边界 → 规则反例 → 状态/API 集成 → 持久化 → 模板小样与业务试点。')
(DOCS / '产品全景图.svg').write_text(product, encoding='utf-8')
(DOCS / '技术架构图.svg').write_text(tech, encoding='utf-8')
css = '''body{margin:0;background:#eef3f8;color:#233548;font:16px/1.85 "Microsoft YaHei",system-ui,sans-serif}main{max-width:1120px;margin:32px auto;background:white;padding:45px 55px;border-radius:16px;box-shadow:0 8px 36px #17334c12}h1{font-size:32px;color:#123a59;line-height:1.4;border-bottom:4px solid #13847c;padding-bottom:22px}h2{font-size:23px;color:#16496b;margin-top:38px}h3{color:#16496b}a{color:#087e85}table{width:100%;border-collapse:collapse;font-size:14px;margin:20px 0;display:block;overflow:auto}th,td{border:1px solid #d7e2ee;padding:10px 13px;vertical-align:top;min-width:80px}th{background:#eaf2f8;text-align:left}tr:nth-child(even){background:#f8fafc}pre{background:#102b42;color:#e9f4ff;padding:20px;overflow:auto;border-radius:10px;line-height:1.6;font-size:13px}code{font-family:Consolas,monospace}img,svg{max-width:100%;height:auto}blockquote{border-left:4px solid #13847c;background:#eef8f6;margin:18px 0;padding:10px 20px}.meta{color:#65798b;font-size:13px}.diagram-source{display:none}@media(max-width:700px){main{padding:22px 16px;margin:8px}h1{font-size:26px}}@media print{body{background:white}main{box-shadow:none;margin:0;padding:12px}h2{break-after:avoid}tr,svg{break-inside:avoid}pre{white-space:pre-wrap}}'''
for stem in ['MVP-产品方案', 'MVP-项目技术文档']:
    text = (DOCS / f'{stem}.md').read_text(encoding='utf-8')
    text = re.sub(r'```mermaid\n.*?```', '', text, flags=re.S)
    body = markdown.markdown(text, extensions=['tables', 'fenced_code'])
    for name, svg in [('产品全景图.svg', product), ('技术架构图.svg', tech)]:
        body = re.sub(r'<img[^>]*src="' + re.escape(name) + r'"[^>]*>', lambda _: svg, body)
    page = f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{stem}</title><style>{css}</style><main><p class="meta">Amazon PPC Optimizer · MVP 规划交付 · 2026-10-30</p>{body}</main></html>'
    (DOCS / f'{stem}.html').write_text(page, encoding='utf-8')
print('Built two standalone HTML documents and two SVG diagrams.')
