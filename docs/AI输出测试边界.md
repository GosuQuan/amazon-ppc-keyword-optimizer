# 首轮 AI 输出测试边界

## 范围与执行约束

覆盖首页首轮在线 AI 返回及专家 JSON 导入，不改 workflow 页面或后端代理。不调用真实模型、不读取 `.env`，不引入依赖。使用 Node 内置 `node:test`、`assert`、`vm` 在隔离 DOM/网络替身中执行真实 `frontend/app.js`，验证入口行为和状态变化。

## 输出契约（先定义后实现）

- 在线仅读取 `choices[0].message.content` 的非空字符串；`reasoning_content` 永不作为答案，也不与最终内容拼接。缺失 choices/message/content、非字符串或空白 content 清楚报错，旧结果保持不变。
- `choices[0].finish_reason === "length"` 优先拒绝，即使 content 是合法完整 JSON 也不合并。提示输出已截断、未合并，建议减少输出量或提高输出 token 上限后重试。为兼容已有代理，缺少 finish_reason 仍允许结构有效的最终正文。
- 支持纯 JSON、Markdown JSON 代码围栏、说明文字包裹一个 JSON 对象；不修补残缺 JSON、不从推理文本寻找 JSON。完整 JSON 数组/标量必须按其真实类型拒绝，不截取其中的对象冒充结果。
- 根必须为非 null 对象，至少含 `expansions`、`intents`、`negativeHints`、`insights` 中一个已知字段；允许未知扩展字段。省略的集合按空数组处理，明确提供的集合必须为数组（null、字符串、对象不接受）。允许全部已提供集合为空数组，不以 prompt 中建议的数量作为硬性条件。
- expansions/negativeHints 每项必须为对象，word 必须为非空字符串；expansions 的可选 type/reason、negativeHints 的可选 reason 若提供必须为字符串，空字符串沿用既有默认值。
- intents 每项必须为对象，intent 必须为非空字符串，keywords 必须为字符串数组，每个关键词非空；允许空 keywords 数组，保持原先支持形式。
- insights 每项必须为对象，可选 title/detail 若提供必须为字符串，至少一项去除空白后非空；保留仅 title 或仅 detail 的既有格式。
- 任一集合或条目非法必须整批拒绝，错误指出字段路径；不得静默过滤坏条目，不得部分更新旧扩词、分组、否定词、洞察或 done 标记。
- 通过完整校验后一次性替换 AI 状态；继续保留精准词查重、规则一致/优质词冲突提示、渲染和导出数据结构。

## 验证矩阵

1. final 与 reasoning 同时存在：只采用 final；只有 reasoning、final 非 JSON 或不完整时失败。
2. length + 合法 JSON、length + 空 content 均拒绝并提示截断。
3. 裸 JSON / 围栏 / 说明包裹、缺少 finish_reason、部分集合、空集合、仅标题/详情洞察均兼容。
4. 非对象根、无已知字段、集合类型错误、null/原始值条目、字段类型错误、空白词和坏关键词列表均整批拒绝。
5. 有效 expansions 后出现非法后续集合时，旧 state.ai 对象引用和完整内容不变；在线及导入入口失败时均展示错误。
6. 成功后验证查重、规则一致、冲突标记和既有状态字段。

## 执行记录

执行命令：`node --test frontend/tests/ai-output.test.cjs`。

结果：58 项测试全部通过（0 失败，0 跳过）。覆盖真实脚本的在线调用与专家导入入口、完整结构拒绝和原子状态保持，另补充围栏内数组与残缺 JSON 的拒绝用例。

这里的网络与文件读取对象均为替身，渲染函数在测试中替换为空操作；不验证供应商可用性、真实浏览器布局或模型建议的业务质量。此次没有修改后端代码，因此不以后端 pytest 替代前端行为验证。
