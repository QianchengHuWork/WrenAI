# Denodo Prompt 实际注入内容分层

最后更新：2026-05-26 16:05 CST

本文整理 Denodo Ask / SQL 生成链路里模型实际会收到的 prompt 内容。

## 阅读边界

- `system`：作为系统消息进入模型，决定模型身份、输出格式和全局规则。
- `user`：作为当前用户消息的一部分进入模型，通常由多个上下文区块拼接。
- `history`：作为历史对话消息进入模型，只在 follow-up 问题中出现；客户版只展示为脱敏历史上下文。

## 1. Denodo SQL 规则层

**实际注入内容**

系统层会把模型设定为 Denodo VQL 专家，并要求只输出一个可执行的 Denodo VQL `SELECT` 查询：

```text
You are a Denodo VQL expert.
Convert the user's analytics question into one executable Denodo VQL SELECT query.
Do not generate semantic-layer logical SQL, ANSI-only SQL, or explanatory text.
Use the native Denodo view and column names supplied in the schema/context.
The final answer must be JSON only: { "sql": <DENODO_VQL_QUERY_STRING> }
```

纠错场景会换成修复语气：

```text
Fix the invalid Denodo VQL query according to the error message.
Do not convert the query back to semantic-layer logical SQL or generic ANSI-only SQL.
```

技术规则层会继续注入这些约束：

```text
Output Denodo-compatible VQL only.
Always wrap table names, column names, and alias-qualified columns in double quotes.
Do not generate LIMIT, FETCH, TOP, OFFSET, or NULLS FIRST/LAST.
Do not use LIMIT or FETCH inside subqueries or CTEs.
Prefer semantic date fields such as *_year, *_month, and *_date.
Do not put aggregate expressions in WHERE. Use HAVING after aggregation.
Do not use TO_NUMBER in Denodo VQL.
Do not introduce a CTE just to compute a casted field, rename fields, or filter one table.
```

Denodo 分区、时间和 Top-N 规则会作为更强约束注入：

```text
Partition fields are view-specific.
Only add ptstart and ptend filters to a view when that exact view's retrieved schema includes both columns.
ptstart / ptend must use equality only.
Do not add or subtract integers directly from YYYYMM string/month fields.
For intermediate Top-N populations, ORDER BY alone is not a filter.
Do not use LAG or LEAD for month-over-month or consecutive-period comparisons.
For continuous two-month decline, compare three consecutive months with self joins.
Do not default to DENSE_RANK or other window ranking functions.
Only use views and columns present in the retrieved schema context and selected models.
```

**注入位置**

- SQL 生成：进入 `system`，同时在 `user` 的关键约束区块中重复一部分 Denodo 输出约束。
- SQL 纠错：进入 `system`，并在 `user` 的纠错优先级区块中补充错误类型对应的修复指令。
- 子查询草稿生成：同样使用 Denodo VQL 的系统层规则。

**触发条件**

- 当前语义上下文中带有 Denodo context marker。
- Ask 或纠错链路识别为 Denodo VQL 路径。

**用途**

- 强制模型输出 Denodo VQL，而不是语义层逻辑 SQL 或通用 ANSI SQL。
- 避免 Denodo 不支持的语法和函数。
- 限制模型只能使用已检索/已选择的视图和字段。
- 把验证阶段常见错误提前变成生成约束。

**边界**

- 这层是 SQL 技术规则，不决定业务指标口径。
- 这层不扩展可用表范围；native schema mapping 只是已选视图的物理命名参考。

**风险或注意事项**

- 如果 Denodo marker 丢失，链路可能退回通用 SQL 规则，导致生成非 VQL 或触发错误验证路径。
- 技术规则里有少量业务无关但强约束的 Denodo 经验规则，后续修改要确认不会和 runtime metric formula 冲突。

## 2. 业务语境 Prompt 层

**实际注入内容**

业务公式会作为 `USER INSTRUCTIONS` 注入。命中文件化业务公式时，注入格式大致是：

```text
Denodo metric formula rule `<metric_rule_name>`:
when the user question matches this rule and `<primary_business_view>` is in the retrieved schema or selected models,
treat it as the authoritative scope for these metrics.
Primary model: `<primary_business_view>`.
Required models: `<required_business_view_1>`, ...
Use these metric expressions exactly, expanding aliases inline when needed:
- `<metric_name_1>`: `<metric_expression_1>`
- `<metric_name_2>`: `<metric_expression_2>`
Forbidden SQL patterns for this metric rule: `<forbidden_pattern_1>`; `<forbidden_pattern_2>`.
Additional instruction: `<business_specific_instruction>`
Do not invent columns outside the retrieved schema, and do not use this formula for unrelated business concepts.
```

如果没有命中文件化公式，会注入内置 fallback 业务公式。例如：

```text
Denodo business formula: for assignment success rate, calculate `<success_numerator> / <success_denominator>` with NULLIF on the denominator.
Denodo business formula: for smart-assignment coverage rate, calculate `<assigned_leads> / <total_leads>` with NULLIF on the denominator.
Denodo business formula: for generic order conversion rate, lead-to-order conversion rate, or overall conversion rate, calculate `<converted_orders> / <total_leads>` with NULLIF on the denominator.
Do not use `<assigned_leads>` as the generic conversion-rate denominator.
```

复杂趋势问题还会注入专项业务/结构规则：

```text
For city conversion-rate consecutive-decline questions after Top-N order amount filtering,
use one monthly order-amount population to build the true Top-N set,
and use one monthly conversion-rate population for trend rows.
Use concrete YYYYMM bounds.
The Top-N CTE must actually filter the population before downstream joins.
Detect continuous two-month decline with three self-joined monthly rows.
Do not use LAG, LEAD, or a single previous-month comparison.
```

**注入位置**

- 作为 `USER INSTRUCTIONS` 进入 reasoning、最终 SQL 生成、follow-up SQL 生成、子查询草稿生成和 SQL 纠错。
- scope 选择阶段只把公式摘要作为候选范围证据，不注入完整 SQL 表达式。

**触发条件**

- 必须是 Denodo 上下文。
- 文件化公式必须启用、数据源匹配、主视图/必需视图在当前检索或已选范围内。
- 内置 fallback 只在没有命中文件化公式时使用。
- 专项趋势规则只在问题语义和所需视图集合都匹配时使用。

**用途**

- 把客户或项目确认过的指标口径传给模型。
- 禁止模型使用错误字段、错误分母、错误业务视图或错误计数方式。
- 对复杂业务问题给出结构性约束，减少模型自由发挥。

**边界**

- 文件化业务公式是 SQL 生成/纠错中的权威口径。
- scope 选择阶段不能被公式强行覆盖，只能把公式当证据；最终可用视图仍由 selected models 限定。
- 本文中的指标表达式均已占位/示例化；真实业务配置不在本文展开。

**风险或注意事项**

- 业务公式如果和 SQL 技术规则冲突，当前策略是保留公式表达式形状，不额外添加 cast，最后由 Denodo 校验/纠错兜底。
- 如果公式触发词过宽，可能把不相关问题带入错误业务域；因此 scope 选择和 selected models 是重要边界。

### 2.1 指标计算平台规则的视图选择、SQL 优化和注入时机

**实际注入内容**

指标计算平台中启用的规则会分两段进入 prompt。范围选择前只注入轻量摘要，帮助模型判断用户问题应该落到哪些业务视图：

```text
Metric rule summary for scope selection:
- rule: <metric_rule_name>
- business domain: <business_description>
- preferred primary view: <primary_business_view>
- required companion views: <required_business_view>
- trigger phrases: <trigger_phrase_1>, <trigger_phrase_2>
- metrics: <metric_name_1>, <metric_name_2>
```

范围确定后，命中的规则会作为更完整的指标指令进入 SQL 生成：

```text
Use this metric rule as the authoritative business definition when the selected views contain `<primary_business_view>`.
Primary view: `<primary_business_view>`.
Required companion views: `<required_business_view>`.
Metric expression:
- `<metric_name>` = `<metric_expression>`
Forbidden SQL patterns:
- `<forbidden_pattern>`
Additional SQL generation guidance:
- `<business_specific_instruction>`
```

**注入位置**

- 范围选择前：进入候选视图选择 prompt，通常只包含规则名、业务域、主视图、必需视图、触发词和指标名。
- 范围确定后：进入 `USER INSTRUCTIONS`，影响 reasoning、最终 SQL 生成、follow-up SQL 生成、内部子查询生成和 SQL 纠错。
- 纠错阶段：和错误 SQL、错误信息一起再次注入，避免修复时丢失指标口径。

**触发条件**

- 当前项目启用了指标计算平台规则。
- 用户问题命中规则的触发词、业务描述或指标名称。
- 规则声明的主视图或必需视图出现在当前检索候选、已选视图或可用 schema 范围内。
- 如果没有命中平台规则，才使用内置 fallback 业务公式。

**用途**

- 视图选择：把“这个指标通常应该从哪个主视图、哪些配套视图计算”作为强证据，减少模型选到相邻但口径不同的视图。
- SQL 生成优化：提前告诉模型权威指标表达式、分子/分母、计数粒度、过滤条件和禁用写法，降低生成后再纠错的概率。
- 结构优化：让模型围绕主视图和必需视图组织 JOIN、聚合粒度、Top-N 中间集合和趋势判断，避免为了凑指标引入无关视图。
- 纠错稳定性：验证失败后仍保留同一套指标规则，避免修复 SQL 时把业务公式改成通用写法。

**边界**

- 指标平台规则能影响视图选择，但不能单独突破 selected models 和 retrieved schema 的硬边界。
- 范围选择前不会注入完整 SQL 表达式，避免模型在视图未确定时过早绑定字段组合。
- 进入 SQL 生成后，指标表达式是该业务指标的权威口径；但字段和视图仍必须来自当前已选范围。
- 禁用写法只约束该规则命中的业务问题，不应扩散到无关业务域。

**风险或注意事项**

- 规则触发词太宽会造成视图选择偏移；因此平台规则只作为范围选择证据，最终仍要结合用户问题、schema 检索和 selected models。
- 指标表达式过细时，可能和 Denodo 技术限制发生张力；当前策略是保留业务表达式形状，再由 Denodo 规则约束不可用语法。
- 规则未覆盖的新指标会回落到 fallback 公式或通用 SQL 生成，准确性依赖现有 schema 描述和业务指令质量。

## 3. 语义上下文层

**实际注入内容**

请求入口会构造 Denodo 语义上下文，进入后端生成链路后作为 `SEMANTIC DICTIONARY` 区块注入。基础形态如下：

```text
Denodo context marker: [[DENODO_CONTEXT_MARKER]]
This project executes against Denodo VQL through the configured Denodo execution environment.
Apply Denodo technical rules and the scoped business formula instructions supplied by the system.
```

native VQL schema mapping 会以占位结构进入：

```text
Native Denodo VQL schema mapping.
Generate VQL against these native views and columns directly;
do not generate logical semantic-layer SQL that requires later conversion.
Use the quoted native view name in FROM/JOIN and quoted native column names in SELECT/WHERE/GROUP BY/HAVING/ORDER BY.
- model <semantic_model> -> native view "<native_view>"; native columns: "<native_column_1>", "<native_column_2>", ...
```

如果语义字典启用，还会追加：

```text
Semantic dictionary entries:
<scoped canonical dictionary entries>
```

匹配到规范值改写时，SQL 生成和纠错 prompt 里还会出现：

```text
### MATCHED REWRITES ###
- scope: <model>.<column> | user_phrase: <phrase_from_user> | canonical_value: <canonical_value> | reason: <rewrite_reason>
```

**注入位置**

- native mapping、Denodo marker、语义字典进入当前 `user` prompt 的 semantic context / dictionary 区块。
- matched rewrites 进入 SQL 生成、reasoning、纠错、子查询规划等 user prompt 区块。

**触发条件**

- 项目使用 Denodo 执行/校验环境。
- 存在可读的 Denodo manifest 时注入 native mapping。
- 语义字典开关启用且存在字典文件时注入 dictionary entries。
- scope normalization 命中字典映射时注入 matched rewrites。

**用途**

- Denodo marker 决定后端生成链路使用 Denodo VQL prompt，而不是普通 SQL prompt。
- native mapping 告诉模型使用物理 Denodo view/column 名称。
- semantic dictionary 把业务口语映射到规范值。
- matched rewrites 显式告诉模型哪些用户词已被改写为业务规范值。

**边界**

- native mapping 不能扩大 selected models 的允许表集合。
- semantic dictionary 只提供业务词义和值映射，不提供 join 或指标口径。
- scope narrowing 时必须保留 marker 和 native mapping；只能收窄字典条目。

**风险或注意事项**

- 丢失 marker 会导致 Denodo 路径失效。
- native mapping 太大可能稀释检索上下文，因此实际应尽量按 selected/retrieved models 收窄。

## 4. SQL 生成输入层

**实际注入内容**

最终 SQL 生成的 `user` prompt 是多个区块拼接，核心结构如下：

```text
### DATABASE SCHEMA ###
<retrieved_schema_or_selected_schema>

### SQL FUNCTIONS ###
<supported_sql_functions>

### <HISTORICAL EXAMPLES> ###
Question:
<historical_question>
SQL:
<historical_sql_sample>

### USER INSTRUCTIONS ###
1. <project_or_runtime_instruction>

### SEMANTIC DICTIONARY ###
<denodo_semantic_context>

### SELECTED MODELS ###
Primary Model: <primary_model>
Secondary Models: <secondary_models>
Needs Join: <true_or_false>
Selection Reasoning:
- <scope_reason>

### MATCHED REWRITES ###
<matched_rewrite_items>

### QUESTION ###
Original User Question: <original_question>
Normalized User Question: <normalized_question>

### REASONING PLAN ###
<reasoning_plan>

### CRITICAL SQL OUTPUT CONSTRAINTS ###
<denodo_output_constraints>
```

关键 Denodo 输出约束包括：

```text
Treat selected models and retrieved schema as the hard allowed table set.
Do not reference any view that is not present in Primary Model or Secondary Models.
If runtime metric formula instructions are present, use those formulas as the source of truth.
ptstart and ptend are view-specific partition parameter fields.
Never add/subtract integers directly from YYYYMM fields.
For intermediate Top-N populations, ORDER BY alone is not a filter.
For consecutive month logic, do not use LAG or LEAD.
Preserve the expression shape from runtime metric formulas when one is provided.
Do not add casts unless the retrieved schema or runtime metric formula explicitly requires them.
```

**注入位置**

- 全部进入当前 `user` message。
- system message 负责 Denodo 身份和输出格式，user message 提供数据、业务、语义和问题上下文。

**触发条件**

- Ask 的 intent 进入 text-to-SQL 路径。
- 检索、scope resolution、normalization、reasoning 等前置阶段完成后，把结果拼入 SQL 生成 prompt。

**用途**

- 给模型完整生成 SQL 所需的 schema、函数、样例、业务规则、语义映射、问题和规划。
- 把 selected models 固化为硬边界。
- 把 normalized question 与 original question 同时保留，便于模型既理解用户表达又使用规范值。

**边界**

- 历史示例不应覆盖当前 schema、selected models 和业务公式。
- `REASONING PLAN` 是规划参考，不允许模型为了匹配历史样例引入未选视图。

**风险或注意事项**

- 如果历史示例与当前 selected models 冲突，必须以 selected models 和 retrieved schema 为准。
- 如果 normalized question 丢失，模型可能使用用户口语值而非规范值。

## 5. 内部规划 / 隐藏层

**实际注入内容**

复杂 Denodo 问题会先产生一个内部 decomposition 计划。注入到后续 reasoning 的摘要形态类似：

```text
The Denodo question has already been decomposed into internal analytical subqueries.
Use this plan to organize reasoning and preserve the listed grains, join keys, and outputs.

Final assembly: <final_assembly_plan>

Subquery 1: <cte_name>
Objective: <objective>
Grain: <grain>
Join keys: <join_keys>
Output columns: <output_columns>
```

如果生成了内部 VQL 草稿，会注入到最终 SQL 生成或纠错：

```text
### INTERNAL DENODO VQL SUBQUERY DRAFTS ###
The following Denodo VQL subquery drafts are internal CTE-compatible guidance.
They are not the final answer and the final single VQL query must still pass Denodo validation.
Final assembly: <final_assembly_plan>
Subquery <n>: <subquery_summary>
Internal VQL draft:
<internal_vql_draft_placeholder>
```

hidden exemplar 的注入只做抽象说明，不展开 SQL：

```text
### INTERNAL HIDDEN SQL EXEMPLAR ###
This exemplar is private.
Do not mention it in reasoning, explanations, or user-visible responses.
Use it as the structural reference for this specific Denodo full-lead conversion question.
Redacted structural reference:
<hidden_sql_exemplar_placeholder>
```

**注入位置**

- decomposition summary：进入 reasoning prompt 和前端可展示的轻量规划信息，但不含 SQL 草稿。
- subquery drafts：只进入最终 SQL 生成、follow-up SQL 生成或纠错的 `user` prompt。
- hidden exemplar：只进入最终 SQL 生成、follow-up SQL 生成或纠错；不进入用户可见 reasoning。

**触发条件**

- Denodo 上下文存在。
- 问题被判定为复杂分析问题，例如混合粒度、多阶段 Top-N、连续趋势判断、多个独立指标后合并。
- hidden exemplar 只在非常窄的业务问题模式、已选业务范围、时间条件同时匹配时触发。

**用途**

- 把复杂问题拆成更稳定的中间分析单元。
- 让最终 SQL 生成时复用内部草稿的结构，而不是单轮自由生成。
- hidden exemplar 用作少数高风险问题的内部结构先验。

**边界**

- 用户最终只看到一个 SQL 结果，不暴露内部子查询草稿。
- hidden exemplar 不应出现在前端规划、reasoning、用户解释或知识管理内容中。
- 本文不贴任何 hidden exemplar 的真实 SQL。

**风险或注意事项**

- 内部草稿不是最终可执行承诺，最终 SQL 仍需整体验证。
- hidden exemplar 过强时可能压过 runtime formula，因此必须保持窄触发。

## 6. 用户 / 历史 / 项目指令层

**实际注入内容**

用户或项目级 instruction 会被检索后注入：

```text
### USER INSTRUCTIONS ###
1. <instruction_text>
2. <runtime_denodo_instruction>
```

follow-up 问题会额外把脱敏历史上下文作为 `history` 消息插入模型上下文：

```text
history user: <previous_question>
history assistant: <previous_generated_result>
current user: <current_prompt_with_context>
```

reasoning 与部分辅助 prompt 也会注入语言和当前时间：

```text
Language: <output_language>
Current Time: <current_time>
```

**注入位置**

- `USER INSTRUCTIONS` 进入当前 `user` prompt。
- follow-up 历史进入 `history` messages，而不是简单拼在当前 prompt 文本里。
- language/current time 进入当前 `user` prompt 的输入区块。

**触发条件**

- 项目有默认 instruction，或当前问题检索到相似 instruction。
- follow-up 问题带有历史上下文。
- 配置中提供输出语言和当前时间。

**用途**

- 让项目级偏好、用户补充规则和 Denodo runtime rules 共同影响 SQL 生成。
- 让 follow-up 问题继承上一轮问题和 SQL。
- 让相对时间表达可以结合当前时间解析。

**边界**

- 用户 instruction 不能允许模型越过 selected models、retrieved schema 或 Denodo 技术规则。
- 历史生成结果只是上下文，不应让模型引用当前 schema 中不存在的表或字段。

**风险或注意事项**

- 历史上下文或用户 instruction 与当前业务公式冲突时，应以 runtime metric formula、selected models 和当前 schema 为准。
- 默认 instruction 影响面较大，需要谨慎管理。

## 7. 一次 Denodo Ask 的最终注入顺序

一次 Denodo text-to-SQL 请求进入模型时，可以抽象成下面的顺序：

```text
pre-generation scope selection:
  metric platform rule summaries for view selection
  retrieved schema candidates
  normalized question signals

system:
  Denodo VQL expert identity
  Denodo VQL output format
  Denodo technical SQL/VQL rules

history:
  previous user question / assistant generated result context, only for follow-up

user:
  retrieved database schema
  optional SQL functions
  historical examples with <historical_question> and <historical_sql_sample>
  USER INSTRUCTIONS:
    project instructions
    Denodo technical runtime instruction
    matched metric platform rule instruction or fallback business formula
    optional temporal / Top-N / decline instruction
  SEMANTIC DICTIONARY:
    Denodo context marker
    native VQL schema mapping
    semantic dictionary entries
  selected models
  matched rewrites
  optional internal decomposition / subquery drafts
  optional hidden exemplar placeholder
  original and normalized question
  reasoning plan
  critical SQL output constraints
```

纠错请求结构类似，但 `user` prompt 会额外包含：

```text
SQL: <invalid_sql>
Error Message: <validation_error>
DENODO-SPECIFIC FIX PRIORITIES:
  <error_type_specific_rewrite_rules>
```

## 8. 不展开内容清单

- 不把客户业务配置全文转储到本文；需要表达时只使用占位符或脱敏示例。
- 不展开指标计算平台规则的后台配置全文；这里只说明其进入 prompt 的结构、边界和时机。
