# MVP 前端测试边界

## 本次范围

新增 `frontend/workflow.html`、`frontend/workflow.js`、`frontend/workflow.css` 和本文。随后仅在旧工具首页增加指向 `/workflow.html` 的链接。页面提供返回旧工具 `/` 的链接。

闭环为：填写账户、站点、币种和显式 ASIN 上下文 → 上传搜索词 CSV（可选批量 CSV/TSV）→ 分析方案 → 逐项批准或拒绝 → 导出已批准且可执行的批量草稿 → 手动记录广告后台执行 → 上传执行后周期搜索词 CSV 复盘。支持历史方案加载与重新获取。

商品选择仅按用户填写的 ASIN 上下文；搜索词报告必须先由用户筛选为该商品。前端不会声称能从任意搜索词报告可靠识别商品。预算为建议，不会自动修改广告后台。估算出价、阻断原因、警告和导出错误须可见。批量上传草稿尚未与实际站点模板完成对标验证，上传前必须核对。

## API 固定契约

- `POST /api/workflow/plans`：multipart，必填搜索词 CSV `search_terms`，可选 `bulk` CSV/TSV，非空 `account`、`marketplace`、`currency`、`asin`，以及 `target_acos`、`daily_budget`；返回 plan。
- `GET /api/workflow/plans`：返回 summary 数组，也兼容 `{plans: []}`。
- `GET /api/workflow/plans/{id}`：返回 plan。
- `PATCH /api/workflow/plans/{id}/actions/{aid}`：JSON `{status: approved|rejected|pending}`；返回 plan。
- `POST /api/workflow/plans/{id}/export`：返回 TSV，或 422 JSON 错误。
- `POST /api/workflow/plans/{id}/execution`：JSON `{executed_at: YYYY-MM-DD, notes}`；返回 plan。日期输入不做时区转换。
- `POST /api/workflow/plans/{id}/review`：multipart `search_terms`、`period_start`、`period_end`；返回 plan。

## 自动验证与边界

已运行 `node --check frontend/workflow.js`，退出码 0（无输出），JavaScript 语法检查通过。该命令仅验证语法，不验证 DOM、浏览器下载、视觉布局、实际网络请求、接口兼容性或用户操作路径。静态复核已确认外部数据通过 `textContent` / DOM 节点呈现，不使用 `innerHTML`；上传数据在禁用表单前采集，请求使用 `finally` 恢复按钮状态。

本次未进行真实浏览器交互、端到端联调、跨浏览器/移动设备兼容测试、真实账户广告执行或实际站点批量模板上传验证。不能把语法检查通过解释为上述验证通过。

## 浏览器待测清单

1. 必填上下文及 CSV/TSV 文件扩展名校验；报告已按显式 ASIN 筛选的提示。
2. 新建方案、空列表、数组和 `{plans: []}` 历史列表、历史加载和重新获取。
3. 指标缺省、零值、警告、长文本、恶意 HTML 文本、估算出价、动作状态、逐项批准/拒绝/待审。
4. 方案操作期间禁用按钮，成功/失败后恢复；请求失败、非 JSON 错误、网络中断和服务端字段错误的可见反馈。
5. 存在任一已批准但受阻的动作时，整份导出禁用；不能只下载合格子集。导出端点 422 JSON 具体错误显示；全部合格时下载 TSV。
6. 执行时间与备注提交、已有执行记录展示；执行后复盘日期范围、CSV 上传和复盘结果展示。
7. 窄屏布局、键盘焦点、表单标签、状态消息、返回旧工具链接。
