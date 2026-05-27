# Denodo SQL 生成 Prompt 注入说明

最后更新：2026-05-27 15:47 CST

本文面向 Denodo SQL 生成链路，说明模型在范围选择、SQL 规划、SQL 生成、follow-up 生成和 SQL 纠错中实际接收到的 prompt 内容。文档保留 `system`、`user`、`history` 等消息角色术语，并在每一层标注实现来源，便于复核注入时机和边界。

## 1. `system` 层

**实际注入内容**

Denodo SQL 生成时，`system` 消息把模型设定为 Denodo VQL 专家，并限制最终输出为一个可执行的 Denodo VQL `SELECT` 查询：

```text
You are a Denodo VQL expert.
Convert the user's analytics question into one executable Denodo VQL SELECT query.
Do not generate semantic-layer logical SQL, ANSI-only SQL, or explanatory text.
Use the native Denodo view and column names supplied in the schema/context.

The final answer must be JSON only:
{
  "sql": <DENODO_VQL_QUERY_STRING>
}
```

SQL 纠错时，`system` 消息切换为修复任务：

```text
You are a Denodo VQL expert.
Fix the invalid Denodo VQL query according to the error message and return one executable Denodo VQL SELECT query.
Do not convert the query back to semantic-layer logical SQL or generic ANSI-only SQL.
Use native Denodo view and column names supplied in the schema/context.

The final answer must be JSON only:
{
  "sql": <CORRECTED_DENODO_VQL_QUERY_STRING>
}
```

**注入位置**

- SQL 首次生成：进入 `system`。
- follow-up SQL 生成：进入 `system`，同时历史问答进入 `history`。
- SQL 纠错：进入 `system`，当前错误 SQL 和错误信息进入 `user`。
- 内部子任务草稿生成：复用 Denodo VQL 生成 `system`。

**触发条件**

- 当前请求携带 Denodo 语义上下文标记。
- SQL 生成、follow-up 生成、内部子任务生成或纠错链路识别为 Denodo VQL 路径。

**用途**

- 强制模型输出 Denodo VQL，而不是通用 ANSI SQL。
- 强制最终结果是 JSON，且只包含 `sql` 字段。
- 在纠错时保持 Denodo VQL 方向，不把已生成 SQL 改回通用 SQL。

**边界**

- `system` 层只定义输出身份、格式和全局 Denodo 规则，不决定业务指标口径。
- 可用视图和字段仍由 `user` prompt 中的 schema、selected models 和语义上下文决定。

**风险或注意事项**

- 如果 Denodo 语义上下文标记缺失，生成链路可能使用普通 SQL `system` prompt。
- 如果用户指令要求解释性文字，仍以 `system` 层 JSON-only 输出规则为准。

**实现来源**

- 后端生成服务目录内 `src/pipelines/generation/denodo_prompt_context.py:547-588`：构造 Denodo VQL 生成和纠错 `system` prompt。
- 后端生成服务目录内 `src/pipelines/generation/sql_generation.py:198-214`：SQL 生成时按 Denodo 上下文切换 `system` prompt。
- 后端生成服务目录内 `src/pipelines/generation/sql_correction.py:189-205`：SQL 纠错时按 Denodo 上下文切换 `system` prompt。
- 后端生成服务目录内 `src/pipelines/generation/denodo_subquery_generation.py:154-171`：内部子任务草稿生成时复用 Denodo VQL `system` prompt。

## 2. Denodo 技术规则层

**实际注入内容**

Denodo 技术规则会注入到 `system`，同时在最终 SQL 生成和纠错的 `user` 约束区块中重复关键规则。核心规则如下：

```text
For Denodo VQL generation and correction:
1. Output Denodo-compatible VQL only.
2. Always wrap table names, column names, and alias-qualified columns in double quotes.
3. Do not generate LIMIT, FETCH, TOP, OFFSET, or NULLS FIRST/LAST.
4. Do not use LIMIT or FETCH inside subqueries or CTEs.
5. Prefer semantic date fields such as *_year, *_month, and *_date.
6. Avoid DATE_TRUNC, TO_CHAR, INTERVAL, SUBSTRING, and LENGTH unless the retrieved schema or existing reference proves support.
7. Do not put aggregate expressions in WHERE. Use HAVING after aggregation.
8. Do not use TO_NUMBER in Denodo VQL.
9. Do not introduce a CTE only to compute a casted field, rename fields, or filter one table.
10. Only use views and columns present in retrieved schema and selected models.
```

分区字段、YYYYMM、Top-N 和连续月份会注入更细规则：

```text
Partition fields are view-specific.
Only add ptstart and ptend filters to a view when that exact view's retrieved schema includes both columns.
When ptstart/ptend are used, they must use equality only:
ptstart = '<start_yyyymmdd>' AND ptend = '<end_yyyymmdd>'.
Do not use <, <=, >, >=, or BETWEEN with ptstart or ptend.

Do not add or subtract integers directly from YYYYMM string/month fields.
For relative windows, use concrete YYYYMM lower/upper bounds from the normalized question/current time.
If dynamic month arithmetic is unavoidable, derive month_index first.

For intermediate Top-N populations later joined or filtered, ORDER BY alone is not a filter.
Do not use LIMIT, FETCH, or TOP for intermediate Top-N.
Use a correlated-count self filter with deterministic tie-break fields.

Do not use LAG or LEAD for month-over-month or consecutive-period comparisons.
For continuous two-month decline, compare three consecutive monthly rows with self joins.
```

最终 SQL 生成还会追加 `CRITICAL SQL OUTPUT CONSTRAINTS`：

```text
Treat selected models and retrieved schema as the hard allowed table set.
Do not reference any view that is not present in Primary Model or Secondary Models.
If runtime metric formula instructions are present, use those formulas as the source of truth.
Preserve the expression shape from runtime metric formulas when one is provided.
Do not add casts unless the retrieved schema or runtime metric formula explicitly requires them.
```

**注入位置**

- `system`：作为 Denodo VQL 全局规则。
- `user`：在 SQL 生成、follow-up 生成、内部子任务生成、SQL 纠错中作为关键输出约束重复注入。
- 项目默认 instruction：项目初始化或切换到 Denodo 数据源时，写入一份默认 Denodo SQL 指令，后续作为用户/项目指令进入 `USER INSTRUCTIONS`。

**触发条件**

- 当前 SQL 生成路径识别为 Denodo。
- 项目默认 Denodo instruction 已存在，或首次连接 Denodo 项目时被创建。

**用途**

- 避免模型输出 Denodo 不支持或不稳定的语法。
- 把常见校验错误前置成生成约束。
- 明确 selected models 是硬边界，避免 native mapping 中出现的其他视图被误用。
- 降低纠错轮次，尤其是分区字段、Top-N、连续月份和 YYYYMM 处理错误。

**边界**

- 技术规则不提供业务含义，不替代指标计算平台规则。
- 技术规则不能扩大 schema 范围。
- 当技术规则和指标表达式发生张力时，优先保持指标表达式形状，再由 Denodo 语法规则约束不可用写法。

**风险或注意事项**

- 规则过强可能让模型在简单查询中过度保守，例如避免必要 CTE。
- 项目默认 instruction 中的旧规则可能和后端运行时规则不完全一致，最终以运行时注入的 Denodo 技术规则和生成约束为准。

**实现来源**

- 后端生成服务目录内 `src/pipelines/generation/denodo_prompt_context.py:475-544`：Denodo 技术规则主文本。
- 后端生成服务目录内 `src/pipelines/generation/sql_generation.py:130-141`：最终 SQL 生成关键约束。
- 后端生成服务目录内 `src/pipelines/generation/followup_sql_generation.py:128-139`：follow-up SQL 生成关键约束。
- 后端生成服务目录内 `src/pipelines/generation/denodo_subquery_generation.py:101-115`：内部子任务草稿约束。
- 后端生成服务目录内 `src/pipelines/generation/sql_correction.py:139-149`：纠错优先级。
- 应用服务目录内 `src/apollo/server/resolvers/projectResolver.ts:72-84,429-449`：项目默认 Denodo SQL instruction 的创建。

## 3. 指标计算平台规则层

**实际注入内容**

指标计算平台规则先以范围选择摘要进入 scope resolution，再以完整指标指令进入 SQL 生成和纠错。

范围选择前注入轻量摘要：

```text
### CANDIDATE METRIC FORMULA HINTS ###
These formulas are optional business-knowledge hints.
Use them only as evidence when their scope and business domain match the user's request;
do not let a formula override the candidate model whose declared purpose best fits the question.

- name: <metric_rule_name>
  primary_model: <primary_business_view>
  required_models: <required_business_view>
  description: <business_description>
  trigger_phrases: <trigger_phrase_1>, <trigger_phrase_2>
  metrics: <metric_name_1>, <metric_name_2>
```

范围确定后注入完整指标指令：

```text
Denodo metric formula rule `<metric_rule_name>`:
when the user question matches this rule and `<primary_business_view>` is in the retrieved schema or selected models,
treat it as the authoritative scope for these metrics.
Primary model: `<primary_business_view>`.
Required models: `<required_business_view>`.
Use these metric expressions exactly, expanding aliases inline when needed:
- `<metric_name_1>`: `<metric_expression_1>`
- `<metric_name_2>`: `<metric_expression_2>`
Forbidden SQL patterns for this metric rule: `<forbidden_pattern_1>`; `<forbidden_pattern_2>`.
Additional instruction: `<business_specific_instruction>`
Do not invent columns outside the retrieved schema, and do not use this formula for unrelated business concepts.
```

当前启用的 Denodo 指标规则会按下面内容进入 prompt。

### 3.1 智能分配转化指标

```text
Denodo metric formula rule `智能分配转化指标`:
description: 智能分配线索数、订单数、转化率、转化订单金额
Primary model: `dv_assign_total_conversion_core`.
Required models: none.
Trigger phrases:
- 智能分配
- 分配策略
- 智能分配转化
- 转化订单金额
- 线索等级
- 不同等级线索
- 高等级线索
- 产出金额
- 分配给门店
- 门店
- 跨区购车
- 跨区订单
- 跨区比例
- 上牌城市
- 交付城市
- 上牌城市≠交付城市

Use these metric expressions exactly, expanding aliases inline when needed:
- `clew_count`: `COUNT(DISTINCT "clew_id")`
- `order_count`: `COUNT(DISTINCT CASE WHEN "is_conver_order" = 1 THEN "biz_order_no" END)`
- `conversion_rate`: `ROUND(COUNT(DISTINCT CASE WHEN is_conver_order = 1 THEN biz_order_no END)*100.0/ NULLIF(COUNT(DISTINCT clew_id), 0),2)`
- `total_amount`: `COALESCE(SUM(CASE WHEN is_conver_order = 1 THEN actual_price END), 0)`
- `cross_order_count`: `COUNT(DISTINCT CASE WHEN "is_conver_order" = 1 AND "is_cross_order" = 1 THEN "biz_order_no" END)`
- `cross_order_rate`: `ROUND(COUNT(DISTINCT CASE WHEN "is_conver_order" = 1 AND "is_cross_order" = 1 THEN "biz_order_no" END) * 100.0 / NULLIF(COUNT(DISTINCT "clew_id"), 0), 2)`
- `cross_order_amount`: `COALESCE(SUM(CASE WHEN "is_conver_order" = 1 AND "is_cross_order" = 1 THEN "actual_price" END), 0)`

Forbidden SQL patterns for this metric rule:
- `COUNT(*)`
- `is_ord_pay`
- `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`
- `converted_order_count / assigned_clew_count`
- `dv_clew_assign_core`
- `city_name <> delivery_city_name`

Additional instruction:
智能分配转化率不要使用 converted_order_count / assigned_clew_count，也不要改用 dv_clew_ord_conversion_core。线索等级、不同等级线索、高等级线索等问题属于智能分配业务链，默认使用 dv_assign_total_conversion_core 按线索等级维度统计转化率、订单数和产出金额；不要回退到 dv_clew_core + dv_ord_core，除非用户明确说线索大盘、全量线索、来源归因或四级来源目录。线索分配给门店后产生的跨区购车、跨区订单、跨区比例问题也属于智能分配转化域，必须使用 dv_assign_total_conversion_core，不要使用 dv_clew_assign_core。门店维度使用 "fac_name"。跨区购车判断直接使用 "is_cross_order" = 1，不要手工比较上牌城市和交付城市文本。成交订单限定 "is_conver_order" = 1。跨区订单数使用 COUNT(DISTINCT CASE WHEN "is_conver_order" = 1 AND "is_cross_order" = 1 THEN "biz_order_no" END)，跨区金额使用 COALESCE(SUM(CASE WHEN "is_conver_order" = 1 AND "is_cross_order" = 1 THEN "actual_price" END), 0)。按门店找跨区比例 Top 3 时按跨区比例降序、fac_name 升序稳定排序；如果只做最终展示 Top 3，可最终 ORDER BY 后依赖调用方限制结果数。时间过滤优先使用该视图的 assign_year、assign_month，并且 ptstart / ptend 必须使用等值边界。
```

### 3.2 线索大盘转化指标

```text
Denodo metric formula rule `线索大盘转化指标`:
description: 线索大盘线索量、订单数、订单转化率、转化订单金额，按商机 niche_id 做线索到订单归因。
Primary model: `dv_clew_core`.
Required models: `dv_ord_core`.
Trigger phrases:
- 线索大盘
- 全量线索
- 线索转化效果
- 线索订单转化
- 大定支付转化率
- 商机转化分析
- 线索转化归因
- 转化订单金额
- 线索四级来源目录
- 来源渠道转化率

Use these metric expressions exactly, expanding aliases inline when needed:
- `clew_count`: `COUNT(DISTINCT "clew_id")`
- `order_count_with_refund`: `COUNT(DISTINCT CASE WHEN "has_ord_pay" = 1 AND "order_date" >= "min_clew_date" THEN "niche_id" END)`
- `order_count`: `COUNT(DISTINCT CASE WHEN "has_ord_fdpay" = 1 AND "order_date" >= "min_clew_date" THEN "niche_id" END)`
- `conversion_rate_with_refund`: `ROUND(COUNT(DISTINCT CASE WHEN has_ord_pay = 1 AND order_date >= min_clew_date THEN niche_id END) * 100.0/NULLIF(SUM(lead_count), 0),2)`
- `conversion_rate`: `ROUND(COUNT(DISTINCT CASE WHEN has_ord_fdpay = 1 AND order_date >= min_clew_date THEN niche_id END) * 100.0 / NULLIF(SUM(lead_count), 0),2)`
- `total_amount_with_refund`: `COALESCE(SUM(CASE WHEN is_ord_pay = 1 AND order_date >= min_clew_date THEN actual_price END), 0)`
- `total_amount`: `COALESCE(SUM(CASE WHEN "is_ord_fdpay" = 1 AND "order_date" >= "min_clew_date" THEN "actual_price" END), 0)`
- `refund_impact_pct`: `ROUND((COUNT(DISTINCT CASE WHEN has_ord_pay = 1 AND order_date >= min_clew_date THEN niche_id END) - COUNT(DISTINCT CASE WHEN has_ord_fdpay = 1 AND order_date >= min_clew_date THEN niche_id END)) * 100.0 / NULLIF(SUM(lead_count), 0),2)`

Forbidden SQL patterns for this metric rule:
- `COUNT(*) AS clew_count`
- `COUNT(*) AS lead_count`
- `converted_order_count / total_clew_count`
- `assigned_clew_count`
- `mobile_md5 = phone_no_md5`
- `paid_flag`
- `INNER JOIN "dv_ord_core"`

Additional instruction:
线索大盘转化指标计算步骤指南
当用户查询涉及“四级线索来源、城市、渠道、转化率、退款影响、成交金额”等复合指标时，必须采用 CTE（公用表表达式）分层解耦架构动态编排以下三个步骤：

步骤一：线索层原子级聚合（建立线索基准 CTE: leads_per_niche）
目标：锁定基准线索包，计算每个商机的最早留资时间。
数据源：使用线索核心视图 dv_clew_core。
核心过滤：显式卡死时间边界（如 create_date >= '20260101'），并且必须剔除 niche_id IS NOT NULL 的物理脏数据。
聚合粒度：必须保留商机 ID（niche_id）。如果用户按四级来源、城市、渠道、时间等维度分析，线索侧 CTE 必须 SELECT 并 GROUP BY niche_id + 所有展示/分组维度；不要只按展示维度提前聚合后再 join 订单，否则后续 l.niche_id 不存在。无展示维度时至少按 niche_id 分组。
输出字段：
lead_count: 利用 COUNT(DISTINCT clew_id) 计算线索总量。
min_clue_date: 利用 MIN(create_date) 锁定该商机在当前维度的最早留资日期（作为后续时序归因的基准桩）。

步骤二：订单层状态坍塌与时序归因（建立订单过滤 CTE: orders_per_niche）
目标：挂载订单数据，利用“强时序校验”过滤无效单，并将行级流水坍塌为商机级的支付状态。
数据源：订单核心视图 dv_ord_core。
关联与时序校验：将订单表与步骤一的线索基准表进行 INNER JOIN，关联键为 niche_id。必须在 WHERE 子句中强控时序条件：订单日期必须大于等于线索最早留资日期（order_date_key >= l.min_clue_date）。订单侧聚合必须继续保留 niche_id + 同一组展示/分组维度。
状态二值化坍塌（MAX+CASE WHEN）：
has_ord_pay: 利用 MAX(CASE WHEN o.is_ord_pay = 1 THEN 1 ELSE 0 END) 判定该商机后续是否产生过支付。
has_ord_fdpay: 利用 MAX(CASE WHEN o.is_ord_fdpay = 1 THEN 1 ELSE 0 END) 判定该商机后续是否产生过大定未退款支付。
金额聚合：利用 COALESCE(SUM(CASE WHEN... END), 0) 分别计算包含退款和剔除退款的订单总额 total_amt_pay 和 total_amt_fdpay。

步骤三：主视图多维拼装与公式计算（最终 SELECT 漏斗输出）
目标：以线索基准为主表进行 LEFT JOIN 拼接，计算多口径漏斗转化率。
多维关联：FROM leads_per_niche l LEFT JOIN orders_per_niche o，必须按 niche_id + 同一组展示/分组维度做等值关联。最终 SELECT 才按展示维度 GROUP BY 汇总。
最终指标公式计算规范（拒绝过度强转）：
总量指标：SUM(l.lead_count)、COALESCE(SUM(o.total_amt_xxx), 0)。
漏斗转化计数：利用条件计数锁定转化商机数，如 COUNT(DISTINCT CASE WHEN o.has_ord_fdpay = 1 THEN l.niche_id END)。
柔性转化率公式：不允许使用多层冗余的 CAST。分子乘以 100.0 引入隐式浮点提升，分母必须包裹 NULLIF(..., 0) 以防除零错误。外层统一使用 ROUND(..., 2) 保留两位小数。
退款影响率公式：分子的两个转化计数直接相减，乘以 100.0 后除以 NULLIF(分母, 0)。

注意：线索等级、不同等级线索、高等级线索的转化率或产出金额属于智能分配业务链，不属于线索大盘口径，应使用 dv_assign_total_conversion_core。
```

### 3.3 智能分配试驾转化指标

```text
Denodo metric formula rule `智能分配试驾转化指标`:
description: 智能分配线索后试驾情况，以及相关转化订单数、转化金额和转化率。
Primary model: `dv_niche_ord_conversion_core`.
Required models: none.
Trigger phrases:
- 智能分配试驾
- 智能分配完成试驾
- 通过智能分配完成试驾
- 试驾转化率
- 试驾线索转化
- 智能分配试驾转化
- 试驾量
- 成单数

Use these metric expressions exactly, expanding aliases inline when needed:
- `drive_clew_count`: `COUNT(DISTINCT CASE WHEN "ai_assign_drive_cnt" > 0 THEN "clew_id" END)`
- `order_count`: `COUNT(DISTINCT CASE WHEN "ai_assign_drive_cnt" > 0 AND "is_conver_order" = 1 THEN "biz_order_no" END)`
- `drive_conversion_rate`: `ROUND(COUNT(DISTINCT CASE WHEN ai_assign_drive_cnt > 0 AND is_conver_order = 1 THEN biz_order_no END) * 100.0 / NULLIF(COUNT(DISTINCT CASE WHEN ai_assign_drive_cnt > 0 THEN clew_id END), 0),2)`
- `total_amount`: `COALESCE(SUM(CASE WHEN "ai_assign_drive_cnt" > 0 AND "is_conver_order" = 1 THEN "actual_price" END), 0)`

Forbidden SQL patterns for this metric rule:
- `mobile_md5 = phone_no_md5`
- `ROW_NUMBER() OVER`
- `COUNT(*) AS drive_clew_count`
- `COUNT(*) AS order_count`

Additional instruction:
智能分配试驾相关转化率必须使用 admin.dv_niche_ord_conversion_core（或检索上下文中同名不带 schema 的 dv_niche_ord_conversion_core）作为权威视图。该视图是在明细视图基础上加入试驾相关信息的 niche 转化辅助分析视图，适合统计智能分配线索后的试驾情况，以及相关转化订单数、转化金额和转化率。试驾样本必须限定 "ai_assign_drive_cnt" > 0。默认转化订单数、转化率和转化金额使用 "is_ord_fdpay" = 1 的不含退订有效订单口径。不要回退到 dv_assign_total_conversion_core，也不要重新拼接 dv_clew_core / dv_ord_core 或使用 mobile_md5 = phone_no_md5 自行归因。如果按城市、门店、时间、策略等维度分析，直接在该视图中按对应维度 GROUP BY，并保持同一试驾样本和有效订单口径。时间字段依赖clew_date_key, clew_year, clew_month, cleart_year_month.
```

### 3.4 选装包订单热度和价格增幅

```text
Denodo metric formula rule `选装包订单热度和价格增幅`:
description: 选装包订单数排名、平均选装包价格、选装包总收入。
Primary model: `dv_package_order_core`.
Required models: none.
Trigger phrases:
- 选装包
- 选配包
- 配置包
- 最受欢迎选装包
- 平均额外车价增幅
- 选装包订单数量

Use these metric expressions exactly, expanding aliases inline when needed:
- `order_count`: `COUNT(DISTINCT "biz_order_no")`
- `avg_package_price`: `ROUND(AVG("package_price"), 2)`
- `total_package_revenue`: `ROUND(SUM("package_price"), 2)`

Forbidden SQL patterns for this metric rule:
- `dv_ord_core`
- `city_name`
- `option_amount`
- `SUM("order_count")`
- `COUNT("biz_order_no") AS "order_count"`

Additional instruction:
选装包热度、最受欢迎选装包、选装包销量/订单数排名、平均额外车价增幅必须使用 dv_package_order_core。按 "package_name" 分组，不要按城市、车系或订单主表维度替代。订单数量使用 COUNT(DISTINCT "biz_order_no")，不要使用 SUM("order_count") 或普通 COUNT("biz_order_no")。平均额外车价增幅直接使用 package_price 金额口径；如用户要求收入贡献，可同时给出 SUM("package_price")。时间过滤优先使用该视图的 "order_year_month"。Top N 选装包按 order_count 降序、package_name 升序稳定排序；如果 Top N 结果还要继续参与下游 join/filter，使用 Denodo correlated-count 过滤，不要改查 dv_ord_core。
```

**注入位置**

- 范围选择前：进入 scope resolution 的 `user` prompt，只作为候选视图选择证据。
- 范围确定后：进入 `USER INSTRUCTIONS`，参与 reasoning、最终 SQL 生成、follow-up SQL 生成、内部子任务草稿生成和 SQL 纠错。
- SQL 纠错：随 invalid SQL 和 error message 再次注入，保证修复时不丢失指标口径。

**触发条件**

- 项目启用了 Denodo 指标计算平台规则。
- 规则处于 enabled 状态，且数据源为 Denodo。
- 范围选择阶段：规则摘要会被传入模型，但只能影响候选视图判断。
- SQL 生成阶段：规则主视图和必需视图出现在当前检索范围或 selected models 中时，完整指标规则才会注入。

**用途**

- 视图选择：通过规则的主视图、必需视图、业务描述和触发词，帮助模型在相邻业务视图中选择正确范围。
- SQL 生成优化：直接提供权威表达式、禁用写法、计数粒度、分子/分母、过滤条件和额外业务约束。
- JOIN 与聚合优化：让模型围绕主视图和必需视图组织 JOIN、聚合粒度和中间集合，减少无关视图和错误字段。
- 纠错稳定性：修复 SQL 时继续保留同一业务口径，避免改成通用公式。

**边界**

- 范围选择阶段，指标规则是证据，不是强制覆盖。
- selected models 和 retrieved schema 是 SQL 生成硬边界。
- 完整指标表达式只在范围确定后注入，避免未选视图提前绑定字段组合。
- 命中的平台规则优先于 fallback 业务公式。

**风险或注意事项**

- 触发词过宽会造成视图选择偏移，因此范围选择 prompt 明确要求先看业务域和候选模型用途。
- 指标表达式如果引用当前 schema 中不存在的字段，模型仍不得发明字段。
- 禁用写法只适用于命中的业务规则，不应扩散到其他业务域。

**实现来源**

- 应用服务目录内 `src/apollo/server/services/metricFormulaService.ts:1-23,347-365`：指标规则存储、读取和 enabled 过滤。
- 应用服务目录内 `src/apollo/server/services/askingService.ts:625-645`：Ask 请求读取 enabled 指标规则并传入后端生成服务。
- 后端生成服务目录内 `src/web/v1/services/ask.py:257-327`：请求模型定义中接收指标规则。
- 后端生成服务目录内 `src/pipelines/generation/scope_resolution.py:88-100,112-162`：范围选择前的指标规则摘要注入。
- 后端生成服务目录内 `src/web/v1/services/ask.py:1079-1086,1122-1132,1275-1302`：先注入技术规则，范围确定后再注入完整指标规则。
- 后端生成服务目录内 `src/pipelines/generation/denodo_prompt_context.py:677-700,746-806,1032-1098`：匹配指标规则并格式化完整 `USER INSTRUCTIONS`。

## 4. 业务语境层

**实际注入内容**

当没有命中指标计算平台规则时，系统会注入 fallback 业务公式。例如：

```text
Denodo business formula: for assignment success rate, calculate
`assigned_clew_count / assign_count` with NULLIF on the denominator.

Denodo business formula: for smart-assignment coverage rate, calculate
`assigned_clew_count / total_clew_count` with NULLIF on the denominator.

Denodo business formula: for generic order conversion rate, lead-to-order conversion rate, or overall conversion rate,
calculate `<converted_orders> / <total_leads>` with NULLIF on the denominator.
Do not use `<assigned_leads>` as the generic conversion-rate denominator.
```

部分复杂业务问题会注入专项结构规则：

```text
For city conversion-rate consecutive-decline questions after Top-N order amount filtering,
use one recent-period city order-amount population to build the true Top-N city set,
and use one monthly city conversion-rate population for trend rows.
Use concrete YYYYMM bounds.
The Top-N population must actually filter before downstream joins.
Detect continuous two-month decline with three self-joined monthly rows.
Do not use LAG, LEAD, or a single previous-month comparison.
```

**注入位置**

- 作为 `USER INSTRUCTIONS` 进入 reasoning、最终 SQL 生成、follow-up 生成、内部子任务草稿生成和 SQL 纠错。
- 专项结构规则与 Denodo 技术规则一起进入运行时 instruction。

**触发条件**

- 当前请求是 Denodo SQL 生成路径。
- 未命中完整指标计算平台规则时，才尝试注入 fallback 业务公式。
- 专项趋势/Top-N/连续下降规则只在用户问题语义和必需视图集合同时匹配时注入。

**用途**

- 在平台指标规则没有覆盖时，提供基础业务口径。
- 为高风险趋势类问题提供结构化约束，避免模型使用不稳定窗口函数或只做单月对比。
- 保持生成和纠错阶段的业务口径一致。

**边界**

- fallback 业务公式不是平台规则的替代品；平台规则命中后不再注入对应 fallback。
- 专项结构规则只对特定语义问题生效，不改变普通查询的生成方式。
- 所有业务公式仍受 selected models 和 retrieved schema 限制。

**风险或注意事项**

- fallback 公式覆盖面较宽，可能不如客户配置的指标规则精确。
- 如果问题同时包含多个业务域，模型可能需要依赖 scope resolution 先确定主视图。

**实现来源**

- 后端生成服务目录内 `src/pipelines/generation/denodo_prompt_context.py:609-675`：fallback 业务公式。
- 后端生成服务目录内 `src/pipelines/generation/denodo_prompt_context.py:703-743`：专项趋势、Top-N、连续下降结构规则。
- 后端生成服务目录内 `src/pipelines/generation/denodo_prompt_context.py:781-804`：平台规则未命中时注入 fallback，并追加专项结构规则。

## 5. 语义上下文层

**实际注入内容**

Denodo 语义上下文进入 `SEMANTIC DICTIONARY` 或 `SEMANTIC CONTEXT` 区块。基础结构如下：

```text
Denodo context marker: <DENODO_CONTEXT_MARKER>
This project executes against Denodo VQL through the configured Denodo execution environment.
Apply Denodo technical rules and the scoped business formula instructions supplied by the system.
```

native view / column mapping 会追加为：

```text
Native Denodo VQL schema mapping.
Generate VQL against these native views and columns directly;
do not generate semantic-layer logical SQL that requires later conversion.
Use the quoted native view name in FROM/JOIN and quoted native column names in SELECT/WHERE/GROUP BY/HAVING/ORDER BY.
- model <semantic_model> -> native view "<native_view>"; native columns: "<native_column_1>", "<native_column_2>", ...
```

语义字典条目会追加为：

```text
Semantic dictionary entries:
- scope: <model>.<column> | canonical: <canonical_value> | aliases: <alias_1>, <alias_2> | description: <description>
```

规范值改写命中时，SQL 规划、生成和纠错会收到：

```text
### MATCHED REWRITES ###
- scope: <model>.<column> | user_phrase: <phrase_from_user> | canonical_value: <canonical_value> | reason: <rewrite_reason>
```

**注入位置**

- `user` prompt 的 `SEMANTIC DICTIONARY` 或 `SEMANTIC CONTEXT` 区块。
- 范围选择后，语义上下文会按 selected models 收窄字典条目，但保留 Denodo 标记和 native mapping。
- matched rewrites 会进入 reasoning、最终 SQL 生成、follow-up 生成、内部子任务草稿生成和 SQL 纠错。

**触发条件**

- 项目使用 Denodo 执行/校验环境。
- 存在 Denodo manifest 时注入 native mapping。
- 语义字典启用且存在可用条目时注入 dictionary entries。
- 用户问题中的业务词命中字典规范化时注入 matched rewrites。

**用途**

- Denodo context marker 决定后端生成链路使用 Denodo VQL prompt。
- native mapping 告诉模型使用物理 Denodo view/column。
- semantic dictionary 把用户口语值映射为规范值。
- matched rewrites 显式告诉模型当前问题中哪些词已经被规范化。

**边界**

- native mapping 是命名参考，不扩大 selected models。
- semantic dictionary 提供词义和值映射，不提供指标公式。
- matched rewrites 不得让模型引用未选视图。

**风险或注意事项**

- 丢失 Denodo context marker 会导致系统 prompt 选择错误。
- native mapping 太大可能稀释当前 schema 上下文，因此应尽量按 selected models 收窄。

**实现来源**

- 应用服务目录内 `src/apollo/server/utils/denodo*.ts:231-294`：构造 native mapping 和 Denodo 语义上下文。
- 应用服务目录内 `src/apollo/server/utils/denodo*.ts:296-332`：Ask 前构造 Denodo 语义增强上下文。
- 应用服务目录内 `src/apollo/server/utils/denodo*.ts:1183-1215`：语义字典条目格式化。
- 后端生成服务目录内 `src/web/v1/services/ask.py:184-208`：scope 收窄后保留 Denodo 标记和 native mapping，只替换字典条目。

## 6. 范围选择与 SQL 生成输入层

**实际注入内容**

范围选择阶段会先让模型在候选视图中选择最小有效业务范围：

```text
You are resolving the most likely semantic scope for a text-to-SQL request.

Rules:
1. Pick exactly one `primary_model`.
2. Only return `secondary_models` when the question clearly needs a join.
3. Prefer the smallest valid scope.
4. Use canonical mappings only as evidence for scope selection, not as SQL.
5. Decide the business domain from the user's words, then choose the model whose declared purpose and fields fit that domain.
6. Metric formulas and canonical mappings are evidence only; they must not override the business domain.
7. The final selected scope is a hard SQL boundary.
8. Return JSON only.
```

范围选择 prompt 输入包括：

```text
### USER QUESTION ###
<original_or_rephrased_question>

Language: <language>
Current Time: <current_time>

### CANDIDATE MODELS ###
- model: <candidate_model>
  description: <model_description>
  key_fields: <key_fields>
  normalizable_fields: <normalizable_fields>
  canonical_mappings:
  - <canonical_mapping>
  field_descriptions:
  - <field_description>

### CANDIDATE METRIC FORMULA HINTS ###
<metric_rule_summary>
```

最终 SQL 生成 `user` prompt 的核心结构是：

```text
### DATABASE SCHEMA ###
<retrieved_or_selected_schema>

### SQL FUNCTIONS ###
<supported_sql_functions>

### HISTORICAL REFERENCES ###
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

**注入位置**

- 范围选择：全部进入 `user` prompt。
- SQL 生成：全部进入 `user` prompt。
- follow-up SQL 生成：同样进入当前 `user` prompt，历史问答另进入 `history`。

**触发条件**

- Ask intent 进入 text-to-SQL 路径。
- 检索返回候选 schema / candidate models。
- Denodo scope normalization 可用时执行范围选择和规范值改写。
- 范围选择完成后，schema 文档按 selected models 收窄，再进入最终 SQL 生成。

**用途**

- 先用业务范围选择减少错误视图。
- 把 selected models 固化为 SQL 生成硬边界。
- 同时保留 original question 和 normalized question，兼顾用户表达和规范值。
- 把 reasoning plan 作为 SQL 生成参考，减少单轮自由生成的不稳定性。

**边界**

- 历史参考示例不能覆盖当前 schema、selected models、业务规则和 Denodo 技术规则。
- `REASONING PLAN` 是规划参考，不得引入未选视图。
- 范围选择失败时，链路会回退到不收窄 schema 的生成路径。

**风险或注意事项**

- 候选 schema 如果未包含正确业务视图，范围选择无法凭空选择该视图。
- 过大的候选 schema 会增加错误视图风险。
- normalized question 丢失时，模型可能使用用户口语值而不是规范值。

**实现来源**

- 后端生成服务目录内 `src/pipelines/generation/scope_resolution.py:44-101,147-162,196-232`：范围选择 prompt、指标摘要注入和输出处理。
- 后端生成服务目录内 `src/web/v1/services/ask.py:1035-1086,1122-1155,1275-1302`：检索、scope resolution、schema narrowing 和范围确定后 runtime instructions 注入。
- 后端生成服务目录内 `src/pipelines/generation/sql_generation.py:40-113,119-141,147-195`：最终 SQL 生成 `user` prompt 模板。
- 后端生成服务目录内 `src/pipelines/generation/followup_sql_generation.py:42-113,119-139,196-216`：follow-up SQL 生成 prompt 与 `history` 注入。

## 7. 内部复杂规划层

**实际注入内容**

复杂问题会先进入结构化拆解。拆解阶段的 `system` prompt 要求模型只输出 JSON，并判断问题是 simple 还是 complex：

```text
You are a senior analytics planner for Denodo text-to-SQL.
Return JSON only.
Decide whether the user's question is simple or complex.

A question is complex when it requires multiple analytical grains,
multiple independent metrics that later need to be joined,
top-N-per-group logic,
ranking combined with attributes,
or multi-step intermediate aggregation.

For complex questions, decompose the work into a small number of CTE-compatible subqueries.
Each subquery must be independently meaningful and have stable output columns.
Do not write SQL here.
```

拆解结果会以结构化摘要进入 reasoning：

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

随后每个目标子任务会单独生成一个 VQL 草稿：

```text
### TARGET SUBQUERY ###
cte_name: <cte_name>
objective: <objective>
grain: <grain>
join_keys: <join_keys>
output_columns: <output_columns>

### SUBQUERY RULES ###
- Generate only the target subquery VQL, not the final combined query.
- Keep output aliases stable and aligned with `output_columns`.
- Preserve the target grain exactly.
- Do not depend on temporary tables, previous subquery result rows, or user-visible intermediate data.
- If runtime metric formula instructions are present, use those formulas as the source of truth.
- Only use views and columns from the database schema and selected models above.
```

通过校验的子任务草稿会进入最终 SQL 生成或纠错：

```text
### INTERNAL DENODO VQL SUBQUERY DRAFTS ###
The following Denodo VQL subquery drafts are internal CTE-compatible guidance.
They are not the final answer and the final single VQL query must still pass Denodo validation.

Final assembly: <final_assembly_plan>

Subquery 1: <cte_name>
Objective: <objective>
Grain: <grain>
Join keys: <join_keys>
Output columns: <output_columns>
Internal VQL draft:
<internal_vql_draft>
```

可复原 CTE 结构示例：

```sql
WITH "<top_n_population>" AS (
    SELECT
        "<city_key>",
        "<city_name>",
        SUM("<order_amount>") AS "<total_order_amount>"
    FROM "<city_order_month_view>" base
    WHERE "<order_month>" >= '<lower_yyyymm>'
      AND "<order_month>" <= '<upper_yyyymm>'
      AND (
          SELECT COUNT(*)
          FROM "<city_order_month_view>" peer
          WHERE peer."<order_month>" >= '<lower_yyyymm>'
            AND peer."<order_month>" <= '<upper_yyyymm>'
            AND (
                peer."<order_amount>" > base."<order_amount>"
                OR (
                    peer."<order_amount>" = base."<order_amount>"
                    AND peer."<city_key>" < base."<city_key>"
                )
            )
      ) < <top_n>
    GROUP BY "<city_key>", "<city_name>"
),
"<monthly_metric>" AS (
    SELECT
        "<city_key>",
        "<month_field>",
        CAST(SUBSTR("<month_field>", 1, 4) AS INTEGER) * 12
          + CAST(SUBSTR("<month_field>", 5, 2) AS INTEGER) AS "<month_index>",
        <metric_expression> AS "<metric_value>"
    FROM "<monthly_conversion_view>"
    WHERE "<month_field>" >= '<lower_yyyymm>'
      AND "<month_field>" <= '<upper_yyyymm>'
    GROUP BY "<city_key>", "<month_field>"
)
SELECT
    m1."<city_key>",
    m1."<month_field>" AS "<month_1>",
    m2."<month_field>" AS "<month_2>",
    m3."<month_field>" AS "<month_3>",
    m1."<metric_value>" AS "<metric_1>",
    m2."<metric_value>" AS "<metric_2>",
    m3."<metric_value>" AS "<metric_3>"
FROM "<monthly_metric>" m1
JOIN "<monthly_metric>" m2
  ON m2."<city_key>" = m1."<city_key>"
 AND m2."<month_index>" = m1."<month_index>" + 1
JOIN "<monthly_metric>" m3
  ON m3."<city_key>" = m2."<city_key>"
 AND m3."<month_index>" = m2."<month_index>" + 1
JOIN "<top_n_population>" t
  ON t."<city_key>" = m1."<city_key>"
WHERE m2."<metric_value>" < m1."<metric_value>"
  AND m3."<metric_value>" < m2."<metric_value>"
```

**注入位置**

- 拆解结果摘要：进入 reasoning 的 `user` prompt。
- 子任务 VQL 草稿：进入最终 SQL 生成、follow-up SQL 生成和 SQL 纠错的 `user` prompt。
- 子任务生成本身：使用 Denodo VQL `system` prompt，目标子任务内容在 `user` prompt。

**触发条件**

- 当前请求是 Denodo SQL 生成路径。
- 问题被判断为复杂问题，例如混合粒度、多指标合并、Top-N 后继续分析、连续月份趋势或多阶段聚合。
- 对应功能开关启用，且拆解和子任务草稿生成没有失败。

**用途**

- 把复杂问题拆成可控的中间分析单元。
- 让最终 SQL 生成复用已规划的 grain、join keys、output columns 和 VQL 草稿。
- 在纠错阶段继续保留结构约束，避免修复时丢失原始分析计划。

**边界**

- 子任务草稿不是最终答案，最终仍必须生成一个完整 Denodo VQL 查询。
- 子任务草稿只能使用当前 selected models 和 retrieved schema。
- 拆解失败、子任务生成失败或校验失败时，链路回退到单次 SQL 生成。

**风险或注意事项**

- 子任务草稿如果过度具体，可能压过后续指标规则；因此最终生成仍会注入指标规则和 Denodo 技术规则。
- 子任务草稿中的 CTE 名、字段别名必须和最终 SQL 兼容，否则纠错阶段需要重写。
- 对简单查询不应启用复杂拆解，否则会增加 token 和延迟。

**实现来源**

- 后端生成服务目录内 `src/pipelines/generation/denodo_query_decomposition.py:19-75`：拆解输出 schema 和 `system` prompt。
- 后端生成服务目录内 `src/pipelines/generation/denodo_query_decomposition.py:78-132,276-314`：拆解 `user` prompt 和结果规范化。
- 后端生成服务目录内 `src/pipelines/generation/denodo_query_decomposition.py:203-258`：格式化子任务草稿和 reasoning 用拆解摘要。
- 后端生成服务目录内 `src/pipelines/generation/denodo_subquery_generation.py:32-116,119-151`：子任务 VQL 草稿生成 prompt。
- 后端生成服务目录内 `src/web/v1/services/ask.py:1410-1455,1473-1535,1589-1695,1833-1863`：拆解、reasoning、最终生成和纠错阶段的注入时机。

## 8. 用户、历史和项目指令层

**实际注入内容**

项目级、用户级和运行时 instruction 会汇总为：

```text
### USER INSTRUCTIONS ###
1. <project_instruction>
2. <runtime_denodo_technical_instruction>
3. <matched_metric_rule_or_business_formula>
4. <optional_temporal_or_topn_instruction>
```

follow-up 问题会把历史问答作为历史上下文传给模型：

```text
history user: <previous_question>
history assistant: <previous_generated_result>
current user: <current_prompt_with_context>
```

reasoning 和范围选择会注入语言与当前时间：

```text
Language: <language>
Current Time: <current_time>
```

**注入位置**

- `USER INSTRUCTIONS`：进入当前 `user` prompt。
- follow-up history：进入 `history` messages。
- `Language` / `Current Time`：进入 scope resolution、reasoning 和 follow-up reasoning 的 `user` prompt。

**触发条件**

- 项目有默认 instruction 或用户设置了自定义 instruction。
- 当前请求是 Denodo 路径时，运行时 Denodo 技术规则自动追加。
- 当前请求是 follow-up 时，注入上一轮历史上下文。
- 需要解析相对时间或按语言输出 reasoning 时，注入语言和当前时间。

**用途**

- 让项目级偏好、用户规则、Denodo 规则和业务规则共同影响生成。
- 让 follow-up 问题继承上一轮上下文。
- 让“上个月”“最近 12 个月”等相对时间有确定参照。

**边界**

- 用户 instruction 不能突破 selected models、retrieved schema 或 Denodo 技术规则。
- follow-up history 是上下文，不是当前 schema 的扩展。
- 历史参考不能覆盖当前问题的 normalized question 和 matched rewrites。

**风险或注意事项**

- 历史 SQL 如果和当前 selected models 冲突，应以当前 selected models 为准。
- 默认 instruction 影响范围大，需要与运行时 Denodo 规则保持一致。

**实现来源**

- 后端生成服务目录内 `src/web/v1/services/ask.py:114-133,1079-1086,1296-1302`：运行时 SQL 指令构建和注入。
- 后端生成服务目录内 `src/pipelines/generation/sql_generation.py:75-85,167-195`：当前 SQL 生成 `USER INSTRUCTIONS` 注入。
- 后端生成服务目录内 `src/pipelines/generation/followup_sql_generation.py:196-216`：follow-up 生成时注入 `history` messages。
- 后端生成服务目录内 `src/pipelines/generation/scope_resolution.py:62-67,147-162`：范围选择阶段注入 language/current time。
- 后端生成服务目录内 `src/pipelines/generation/sql_generation_reasoning.py:76-92,112-128`：reasoning 阶段注入 language/current time。

## 9. 最终注入顺序

一次 Denodo text-to-SQL 请求可以抽象为以下顺序：

```text
pre-generation scope selection:
  user:
    user question
    language/current time
    candidate models
    canonical mapping evidence
    metric platform rule summaries

system:
  Denodo VQL expert identity
  Denodo VQL output format
  Denodo technical rules

history:
  previous user question / previous generated result, only for follow-up

user:
  database schema narrowed by selected models
  optional SQL functions
  historical reference examples with <historical_question> and <historical_sql_sample>
  USER INSTRUCTIONS:
    project instructions
    Denodo runtime technical rules
    matched metric platform rule or fallback business formula
    optional temporal / Top-N / decline instruction
  SEMANTIC DICTIONARY / SEMANTIC CONTEXT:
    Denodo context marker
    native VQL schema mapping
    semantic dictionary entries
  SELECTED MODELS:
    primary model
    secondary models
    needs join
    selection reasoning
  MATCHED REWRITES:
    scoped canonical value rewrites
  optional query decomposition summary
  optional internal VQL subquery drafts
  original and normalized question
  reasoning plan
  critical SQL output constraints

correction request:
  system:
    Denodo VQL correction identity
    Denodo technical correction rules
  user:
    database schema
    USER INSTRUCTIONS
    semantic context
    selected models
    matched rewrites
    optional internal VQL subquery drafts
    original question
    normalized question
    invalid SQL
    validation error or diagnosis
    Denodo-specific fix priorities
```

**实现来源**

- 后端生成服务目录内 `src/web/v1/services/ask.py:1035-1155`：检索、范围选择、候选模型和规则摘要。
- 后端生成服务目录内 `src/web/v1/services/ask.py:1275-1302`：按 selected models 收窄 schema 并注入完整运行时规则。
- 后端生成服务目录内 `src/web/v1/services/ask.py:1410-1695`：reasoning、内部复杂规划和最终 SQL 生成。
- 后端生成服务目录内 `src/web/v1/services/ask.py:1763-1863`：SQL 纠错请求构造。
- 后端生成服务目录内 `src/pipelines/generation/sql_correction.py:64-149,153-186`：纠错 `user` prompt 模板。
