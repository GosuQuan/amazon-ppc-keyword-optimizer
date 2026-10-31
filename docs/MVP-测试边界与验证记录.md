# MVP 测试边界与验证记录

## 实施前约定

新 workflow API 与 legacy 引擎隔离；只复用 legacy 解析与分析，不更改旧接口。测试使用独立 FastAPI 实例挂载 workflow router，SQLite 由 tmp_path / PPC_DB_PATH 隔离。父 agent 负责 main.py 注册。

计划覆盖：上传→上下文校验→计划持久化→人工批准→草稿 TSV 导出快照→执行登记→同上下文复盘；重建客户端后仍可读取。失败边界包括缺字段、非有限/负指标、非正目标/预算、多 ASIN/币种或上下文不符、重复实体歧义、缺 IDs/真实 bid、未批准导出、执行前复盘及周期重叠。重复原始行去重并警告；不同指标但同维度/日期行拒绝。

## 产品边界

search_terms 是唯一绩效来源；bulk 仅提供 Keyword 实体真实 Bid 和 IDs。无 ASIN 列接受显式 ASIN 并警告未验证；有上下文列必须每行一致。关键词匹配保留词边界及标点。导出是待 Amazon 当前模板校验的 SP TSV 草稿，未获模板认证。所有父 IDs 必须具备；更新还要求 Keyword ID；新增词必须明确正出价。亏损词根无范围及重复覆盖只提示，否词保护同组优质词。预算仅建议；执行为用户手工登记。复盘要求执行后、同上下文且不重叠基线日期，输出指标差及非因果说明；无可信基线日期拒绝复盘。

## 实际 API 契约

- `POST /api/workflow/plans`：multipart：search_terms 必填文件；bulk 可选文件；account/marketplace/currency/asin 必填非空；target_acos 默认25、daily_budget 默认50，均要求正有限数。成功200完整 plan。
- `GET /api/workflow/plans`：200 summary 数组（id/created_at/context/status/metrics/action_count/approved_count），按创建时间倒序。`GET /api/workflow/plans/{id}` 返回完整 plan；不存在404。
- `PATCH /api/workflow/plans/{id}/actions/{action_id}`：JSON `{status: approved|rejected|pending}`，200完整 plan；非法状态422、未知动作404。首次导出后审核冻结，变更状态409；原状态重放允许。
- `POST /api/workflow/plans/{id}/export`：无 body；成功返回 UTF-8 BOM TSV、附件名 `sp-draft-{id}.tsv`、`X-Template-Validation: draft-unverified`。无批准动作或任一批准动作不可导出422。首次保存完整批准快照，重放返回相同字节，不新增快照或改变 executed/reviewed 状态。
- `POST /api/workflow/plans/{id}/execution`：JSON `{executed_at: YYYY-MM-DD, notes: string}`，必须已导出且日期晚于基线结束、不在未来；200 plan。首次记录后只允许相同内容重放，覆盖409。
- `POST /api/workflow/plans/{id}/review`：multipart search_terms、period_start、period_end；必须已执行，周期严格晚于执行日期及基线结束。复盘报告必须 ASIN/Currency 列及完整日期，报告日期须在所给周期内，全部上下文列必须匹配；200 plan，delta 的 acos 单位为百分点，其他为原指标绝对差；非因果说明字段 non_causal_note。无效422，覆盖既有不同复盘409。

plan 基础字段按任务契约，额外包含 exports（冻结TSV、审核动作快照、上下文、template_validated=false）、audit（审核轨迹）、baseline_period、target_acos；action 额外 entity_ids。status 流转 pending→approved→exported→executed→reviewed。DB 每次按 PPC_DB_PATH 解析，默认 backend/data/workflow.sqlite3，每次写操作同一 SQLite 事务。

## 已知缩减与输入边界

搜索词报告要求 Campaign、Ad Group、Keyword、Match Type、Customer Search Term/Search Term、Clicks、Spend、Sales、Orders 及其中英文别名；不猜测无关键词实体报告。CSV 支持 UTF-8/GB18030 与逗号/分号/制表符。日期只支持 ISO 日期，日期缺失可创建计划但不允许复盘。bulk 要求 Entity，只有 Keyword 行提供元数据；Keyword 需名称及可识别匹配类型，ID 如填写须为数字字符串。额外 ASIN 列无法分配时拒绝；同一维度同日期不允许指标冲突。

调价不沿用 legacy 基于 CPC 代理计算的百分比。有订单时按“目标 ACOS × 客单价 × 转化率”得到盈利上限，再从真实 Bid 向该上限移动，单次最多 +30% 或 -50%；上限低于 0.02 时改为暂停。无真实 Bid 的改价仅供参考且不可导出。无订单的暂停仍沿用 legacy 止损判断。新增精准词直接采用来源实体真实 Bid，不生成估算执行价。亏损词根和跨组竞争不自动否定；只生成明确广告组范围的精准否词，有同组订单词保护。重复动作目标存在来源歧义时阻止导出。预算只均分建议，不做投放优化或更新。未连接 Amazon API、未认证模板、未验证用户执行、无身份认证/多用户权限，不用于直接公开部署。

## M09 三份报表分别建模（实施前边界）

推广商品报告和广告位报告都是可选文件。搜索词报告仍是唯一用于生成动作和 `plan.metrics` 的绩效来源。另外两份只进入 `plan.reports`，`included_in_plan_metrics` 必须为 false，三份花费不得相加。

归因窗口从 7/14/30 天列名识别。同一文件或三份文件之间出现两个已标注窗口时返回 422。某一份未标注时只警告，不把未标注当成 7 天。推广商品报告允许出现多个 ASIN，用于判断广告组能否分配；同一广告组有多个 ASIN，或组内没有当前 ASIN 时，该组动作不可导出。广告组未出现在推广商品报告时只警告，因为缺少证据不等于已经证明无法分配。广告位只按活动汇总，不生成调价动作。

## 验证记录

语法：bundled Python `-m compileall -q backend/app/workflow backend/app/api/workflow.py backend/tests/test_workflow.py` 已通过。

2026-10-30，在 `backend` 目录使用 Python 3.11 运行：

`PYTHONPATH=<项目>/.deps python -m pytest -q`

结果：46 passed，1 条 Starlette/httpx 弃用警告。新增覆盖三份报表花费不相加、归因窗口不一致被拒绝，以及多 ASIN 广告组不可导出。原引擎、闭环和主应用挂载继续通过。

尚未验证：真实 Amazon 批量模板上传、浏览器人工操作、10 万行性能，以及任何广告效果提升。
