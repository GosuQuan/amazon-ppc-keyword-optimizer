# 亚马逊投流关键词优化工具 · 前后端工程版

把单文件工具升级为标准前后端工程项目：**引擎逻辑下沉后端（Python/FastAPI），前端为独立 SPA**，测试边界固化为 pytest（R-T0 回归集 31 条）。

## 架构

```
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI 入口（API + 静态托管前端）
│   │   ├── api/routes.py      # /api/analyze /api/demo /api/selftest /api/export /api/ai/chat /api/health
│   │   └── engine/            # 引擎（与 R-T0 测试边界对齐）
│   │       ├── parser.py      # CSV 解析：编码/分隔符/双语表头/脏数据防御
│   │       ├── classify.py    # 分组聚合 + 七级分级 + 允许预算模型
│   │       ├── rules.py       # 调价动作 / 收割 / 互搏 / 否定
│   │       ├── mining.py      # 词根 n-gram 归因 + 组合扩展
│   │       ├── exporter.py    # 5 类清单 CSV（BOM）
│   │       ├── pipeline.py    # 分析流水线（对外唯一入口）
│   │       ├── selftest.py    # R-T0 自检（31 断言，/api/selftest）
│   │       └── demo.py        # 内置示例数据
│   ├── tests/                 # pytest：R-T0 移植 + API 端到端（26 用例）
│   └── requirements.txt
├── frontend/
│   ├── index.html             # SPA 壳
│   ├── app.js                 # 调 REST API + 渲染 + 导出 + AI 导入
│   └── style.css
└── 启动工程.bat                # 一键启动
```

## 运行

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8787
# 打开 http://127.0.0.1:8787/  （API 文档：/docs）
```

或直接双击 `启动工程.bat`。

## 测试

```bash
cd backend
python -m pytest -q        # 26 passed：引擎 25 + API 端到端
```

R-T0 边界（与《落地需求拆解与测试边界》一致）：解析（引号/双语表头/货币千分位/空文件/脏行）、七级分级（含 2 处阈值边界）、六类调价动作、否定（精准/词组/互搏、观察与潜力不否定）、词根（亏损→词组否定、盈利不否定）、收割（含查重与 st==kw 排除）、组合扩展、互搏检出、幂等性。

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/analyze` | multipart 上传报表 + 参数 → 完整分析 JSON |
| GET | `/api/demo` | 内置示例数据分析结果 |
| POST | `/api/selftest` | 运行 R-T0 回归集（31 断言） |
| POST | `/api/export/{kind}` | actions/negatives/newwords/roots/stdetail → CSV |
| POST | `/api/ai/chat` | 可选：在线模型转发（Key 可选/本机 token） |

## AI 能力：无需配置任何模型 Key

内置 **「亚马逊数据挖掘专家」AutoClaw Agent**（按 BOSS直聘同类岗位 JD 提炼：数据采集清洗 → 深度分析挖掘建模 → 发现机会与问题；技能覆盖广告指标体系、搜索词方法论、统计谨慎性）。工作流：

1. 页面点「⬇ 导出优秀关键词（喂给专家）」→ 自动下载/复制关键词清单；
2. 在 AutoClaw 中发给「亚马逊数据挖掘专家」Agent；
3. 专家返回严格 JSON（expansions / intents / negativeHints / insights 契约，已实测验证）；
4. 页面点「⬆ 导入专家结果 JSON」→ 与规则结果合并（查重 + 交叉验证标注置信度）。

在线模式（本机代理/直连 Key）为可选项，默认路径完全不需要 Key。

## 路线图（承接《落地需求拆解与测试边界》）

- P0 剩余：R4.2 词根否定冲突保护增强、R1.2 真实出价接入（关键词报表/批量表解析）、R7.2 亚马逊批量表导出
- P1：日期趋势、商品投放报告、导出勾选
- P2：图表看板、规则配置导入导出
