# MetricFlow 语义层外部调研

## Source

- Repo/doc:
  - https://github.com/dbt-labs/metricflow.git
  - https://docs.getdbt.com/docs/build/build-metrics-intro
  - https://docs.getdbt.com/docs/build/about-metricflow
  - https://docs.getdbt.com/docs/build/semantic-models
  - https://docs.getdbt.com/docs/build/entities
  - https://docs.getdbt.com/docs/build/metrics-overview
  - https://docs.getdbt.com/docs/build/join-logic
- Commit/tag/version: `4a36655ee67495b2b3fd71133b1d2119f58d5d22` on `main`
- 本地调研 clone: `.tmp/external-research/metricflow`
- Access date: 2026-05-20 CST
- Research question: MetricFlow 的语义层是怎么构建的？哪些设计可供 WrenAI 的 MDL / Denodo 语义层借鉴？
- Verification: 已阅读源码和官方文档。未运行 MetricFlow runtime 或测试；涉及运行时行为的判断标记为 `not verified / 未验证`。

## Executive Summary

- MetricFlow 的语义层核心是 typed manifest，而不是 prompt 文本。它把语义模型、指标、项目配置和 saved queries 收敛到 `SemanticManifest`。
- `semantic_model` 是物理表/视图之上的模型级语义契约，包含 relation metadata、entities、dimensions、measures、defaults、labels、metadata 和 config。
- `entities` 是带类型的 join key。MetricFlow 用 entity name + entity type 构建 semantic graph，并推导合法 join path，这是规避 fan-out / chasm join 的关键机制。
- `measures` 是基础聚合定义，`metrics` 是面向业务消费的指标对象。两者分离，避免把底层表达式直接暴露为业务指标。
- 运行路径可以概括为：dbt YAML / `semantic_manifest.json` -> `PydanticSemanticManifest` -> transformations -> semantic validations -> `SemanticManifestLookup` -> semantic graph -> query parser -> dataflow plan -> SQL plan -> dialect renderer。
- 对 WrenAI 最有价值的借鉴是：先构建 typed semantic manifest 和 semantic graph，再让 NL/RAG/LLM 在受约束的语义范围内选择模型、字段、指标和 join，而不是直接面对原始 schema 生成 SQL/VQL。

## Relevant Architecture

### 用户配置层

MetricFlow 通常嵌在 dbt 项目里使用。用户在 dbt YAML 中定义：

- `semantic_models`: 数据入口，对应 dbt model 或物理 relation，并附加语义元数据。
- `entities`: join key，类型包括 `primary`、`unique`、`foreign`、`natural`。
- `dimensions`: 可 group by / slice 的属性，分为 categorical 和 time，可由列名或 SQL 表达式定义。
- `measures`: 基础聚合，例如 `sum`、`count_distinct`、`average`、percentile、boolean aggregation。
- `metrics`: 面向业务消费的指标，可由 measure 或其他 metric 构成。
- `project_configuration`: time spine 等项目级配置。

值得阅读的示例：

- `dbt-metricflow/dbt_metricflow/cli/sample_dbt_models/sample_models/transactions.yml`
- `dbt-metricflow/dbt_metricflow/cli/sample_dbt_models/sample_models/metrics.yml`
- `dbt-metricflow/dbt_metricflow/cli/sample_models/project_configuration.yaml`

MetricFlow 内部也支持独立 YAML 文档形式，顶层 key 包括 `semantic_model:`、`metric:`、`project_configuration:`、`saved_query:`。解析逻辑在：

- `metricflow_semantic_interfaces/parsing/dir_to_model.py`

### Manifest 中间表示

核心 IR 是 `SemanticManifest`：

- `metricflow_semantic_interfaces/protocols/semantic_manifest.py`
- `metricflow_semantic_interfaces/implementations/semantic_manifest.py`

它包含：

- `semantic_models`
- `metrics`
- `project_configuration`
- `saved_queries`

`SemanticModel` 定义在：

- `metricflow_semantic_interfaces/protocols/semantic_model.py`
- `metricflow_semantic_interfaces/implementations/semantic_model.py`

关键字段：

- `node_relation`: 物理表/视图 relation。
- `defaults.agg_time_dimension`: measure 默认聚合时间维度。
- `primary_entity`: 当模型有 dimensions 但没有实体字段可作为 primary key 时，提供虚拟 primary entity。
- `entities`: join key 列表。
- `measures`: 模型内基础聚合。
- `dimensions`: categorical/time group-by 字段。

元素实现文件：

- `metricflow_semantic_interfaces/implementations/elements/entity.py`
- `metricflow_semantic_interfaces/implementations/elements/dimension.py`
- `metricflow_semantic_interfaces/implementations/elements/measure.py`
- `metricflow_semantic_interfaces/implementations/metric.py`

### Transform And Validate

MetricFlow 在查询规划前会把用户友好的配置转换为执行友好的内部形态：

- `metricflow_semantic_interfaces/transformations/semantic_manifest_transformer.py`
- `metricflow_semantic_interfaces/transformations/pydantic_rule_set.py`
- `metricflow_semantic_interfaces/transformations/proxy_measure.py`
- `metricflow_semantic_interfaces/transformations/replace_input_measures_with_simple_metrics_transformation.py`

重要 transformation：

- 统一小写命名。
- 转换旧版 measure 配置。
- 为 `create_metric` 的 measure 生成 proxy simple metric。
- 把 cumulative/conversion 等复杂 metric 中的 measure input 替换为 simple metric input。
- 归一化 count、median、boolean aggregation 等配置。

语义校验是 rule-based：

- `metricflow_semantic_interfaces/validations/semantic_manifest_validator.py`
- `metricflow_semantic_interfaces/validations/primary_entity.py`
- `metricflow_semantic_interfaces/validations/agg_time_dimension.py`
- `metricflow_semantic_interfaces/validations/entities.py`
- `metricflow_semantic_interfaces/validations/unique_valid_name.py`

典型校验：

- 有 dimensions 的 semantic model 必须有 primary entity 或 `primary_entity`。
- 每个 semantic model 最多只能有一个 primary entity。
- measure 的 aggregation time dimension 必须是同一 semantic model 内的合法 time dimension。
- 名称必须符合规则，且不能使用 `metric_time` 等保留字。
- `natural` entity 需要搭配 validity window 维度。

### Semantic Lookup And Graph

`SemanticManifestLookup` 是查询规划使用的语义索引入口：

- `metricflow_semantics/model/semantic_manifest_lookup.py`
- `metricflow_semantics/model/semantics/semantic_model_lookup.py`
- `metricflow_semantics/model/semantics/metric_lookup.py`
- `metricflow_semantics/semantic_graph/lookups/manifest_object_lookup.py`

它会构建：

- `SemanticModelLookup`: 索引 dimensions、entities、semantic models 和 element specs。
- `ManifestObjectLookup`: 构建快速 model/entity/metric lookup。
- `MetricLookup`: 索引 metric 依赖和共同可用 group-by。
- `SemanticGraphBuilder`: 根据 manifest 构建 semantic graph。

semantic graph 由多个 subgraph generator 组成：

- categorical dimensions
- entity keys
- entity joins
- simple metrics
- time dimensions
- metric time
- complex metrics

关键文件：

- `metricflow_semantics/semantic_graph/builder/graph_builder.py`
- `metricflow_semantics/semantic_graph/builder/entity_join_subgraph.py`
- `metricflow_semantics/semantic_graph/lookups/join_lookup.py`
- `metricflow_semantics/semantic_graph/attribute_resolution/sg_linkable_spec_resolver.py`

Join 规则不是自由文本，而是由 entity type 决定。`SemanticModelJoinLookup` 维护合法和非法 join 组合：

- 允许类似 `foreign -> primary`、`foreign -> unique`、`primary -> primary`、`unique -> primary` 的路径。
- 阻止 `foreign -> foreign` 等高风险路径。
- 对 `natural` entity 更保守。
- 避免两个都有 validity window 的 semantic models 互相 join，降低 fan-out 风险。

### Query Compilation

查询引擎路径：

- `metricflow/engine/metricflow_engine.py`
- `metricflow/dataflow/builder/dataflow_plan_builder.py`
- `metricflow/dataset/convert_semantic_model.py`
- `metricflow/dataflow/builder/source_node.py`
- `metricflow/plan_conversion/to_sql_plan/dataflow_to_sql.py`

大致流程：

1. `MetricFlowQueryRequest` 接收 metrics、group-bys、filters、order、limit、time constraints。
2. `MetricFlowQueryParser` 基于 `SemanticManifestLookup` 解析并校验 query。
3. `DataflowPlanBuilder` 生成 `DataflowPlan`。
4. dataflow optimizer 对 plan 做优化。
5. `DataflowToSqlPlanConverter` 把 dataflow nodes 转为 SQL plan。
6. SQL client renderer 输出具体引擎方言的 SQL。

这个路径在 semantic intent 已确定后是确定性的，不依赖 LLM。

## Reusable Patterns

- 使用 stable semantic manifest IR：先把所有建模输入转换成 typed manifest，再进入检索、路由、规划或生成。
- 把 entities 建模为带类型 join keys：至少区分 `primary`、`unique`、`foreign`，必要时再扩展 `natural` 或业务自定义类型。
- 用 semantic graph 替代 raw schema：由 models、metrics、entities、dimensions、time nodes 决定哪些路径可查询。
- 分离 measures 和 metrics：measure 是底层聚合表达式，metric 是业务消费指标。
- 时间语义一等化：measure 应明确 aggregation time dimension，time spine 可用于时间序列完整性。
- 分层 transformation：允许用户配置简单，但进入规划前归一化到执行友好的结构。
- rule-based validation：在 SQL 生成前发现缺 primary entity、非法 aggregation time dimension、重复命名、非法 join、保留字等问题。
- query spec before SQL：先解析成 metric/group-by/filter specs，再由 spec 生成 dataflow plan 和 SQL。

## Implementation Implications For WrenAI

- WrenAI 的 MDL 可以借鉴 MetricFlow 的 IR 结构，但不需要复制代码：`model -> entities + dimensions + measures`，并把 `metrics` 作为独立业务指标层。
- Denodo selected views 不应长期停留在“原始 schema + prompt 说明”。更稳的方式是转成 typed semantic manifest：
  - selected Denodo views -> semantic models
  - 业务 ID / 主外键 -> typed entities
  - flags/enums/status 字段 -> categorical dimensions + dictionary metadata
  - date/month/partition 字段 -> time dimensions + explicit granularity
  - 经业务确认的指标公式 -> metrics
- 当前 WrenAI prompt context 可以通过 semantic graph 先裁剪：
  - 候选 metrics
  - 可用 group-bys
  - 必需 join path
  - 不允许的路径，触发澄清或 fallback
- Text-to-SQL 应让 LLM 先选择受约束 semantic intent，而不是任意表/列。对已覆盖的 metric query，可以考虑 deterministic compiler；对未覆盖的探索式问题，再用更小的 schema/context 生成 SQL/VQL。
- MetricFlow 对 Denodo Q20 类问题尤其有参考价值：typed time dimensions 和 relation-specific fields 可以提前阻止 prompt-only 错误，例如把 `ptstart`/`ptend` 套到不含这些字段的 view，或对 `YYYYMM` 字符串做非法算术。
- 近期可落地方式：先做 validation + semantic routing，不必马上实现完整 deterministic SQL compiler。

## Risks / Constraints

- MetricFlow 是 metric-centric，更擅长治理过的指标查询，不直接覆盖任意探索式 SQL。
- MetricFlow 假设 dbt artifacts 和 adapter 生态。WrenAI 应把它作为架构参考，不应直接作为 drop-in dependency。
- Entity typing 依赖可靠 cardinality / key 认知。Denodo view 如果缺少可靠主外键元数据，需要人工建模或 profiling。
- semantic graph 增加前置建模成本。客户 PoC 应从高价值窄域开始，不要一次性覆盖全部 Denodo schema。
- MetricFlow 的 SQL 生成是 deterministic 且非 LLM。WrenAI 对未覆盖问题仍需要 prompt、retrieval、correction 和 dialect guard。
- Runtime performance 和实际生成 SQL 示例本轮没有本地执行，标记为 `not verified / 未验证`。

## Files Or APIs Worth Studying

- Manifest objects:
  - `metricflow_semantic_interfaces/protocols/semantic_manifest.py`
  - `metricflow_semantic_interfaces/protocols/semantic_model.py`
  - `metricflow_semantic_interfaces/implementations/semantic_manifest.py`
  - `metricflow_semantic_interfaces/implementations/semantic_model.py`
  - `metricflow_semantic_interfaces/implementations/metric.py`
  - `metricflow_semantic_interfaces/implementations/elements/entity.py`
  - `metricflow_semantic_interfaces/implementations/elements/dimension.py`
  - `metricflow_semantic_interfaces/implementations/elements/measure.py`
- Parsing / dbt artifact loading:
  - `dbt-metricflow/dbt_metricflow/cli/dbt_connectors/dbt_config_accessor.py`
  - `metricflow_semantics/model/dbt_manifest_parser.py`
  - `metricflow_semantic_interfaces/parsing/dir_to_model.py`
- Transformations and validations:
  - `metricflow_semantic_interfaces/transformations/pydantic_rule_set.py`
  - `metricflow_semantic_interfaces/validations/semantic_manifest_validator.py`
  - `metricflow_semantic_interfaces/validations/primary_entity.py`
  - `metricflow_semantic_interfaces/validations/agg_time_dimension.py`
  - `metricflow_semantic_interfaces/validations/entities.py`
- Semantic graph:
  - `metricflow_semantics/model/semantic_manifest_lookup.py`
  - `metricflow_semantics/semantic_graph/builder/graph_builder.py`
  - `metricflow_semantics/semantic_graph/builder/entity_join_subgraph.py`
  - `metricflow_semantics/semantic_graph/lookups/join_lookup.py`
  - `metricflow_semantics/semantic_graph/attribute_resolution/sg_linkable_spec_resolver.py`
- Query planning:
  - `metricflow/engine/metricflow_engine.py`
  - `metricflow/dataflow/builder/dataflow_plan_builder.py`
  - `metricflow/dataset/convert_semantic_model.py`
  - `metricflow/dataflow/builder/source_node.py`
  - `metricflow/plan_conversion/to_sql_plan/dataflow_to_sql.py`
- Example YAML:
  - `dbt-metricflow/dbt_metricflow/cli/sample_dbt_models/sample_models/transactions.yml`
  - `dbt-metricflow/dbt_metricflow/cli/sample_dbt_models/sample_models/metrics.yml`
  - `metricflow_semantics/test_helpers/semantic_manifest_yamls/sg_02_single_join/manifest.yaml`

## Recommended Next Steps

- 给 WrenAI / Denodo selected views 设计一个 typed semantic manifest 草案：
  - model relation
  - typed entities
  - dimensions with type/granularity/dictionary metadata
  - measures
  - metrics
  - allowed joins
- 在 prompt construction 之前增加 validation pass：
  - 有 dimensions 的 model 必须有 primary entity 或等价业务主键。
  - measure aggregation time dimension 必须存在于同一 model。
  - 同一 model 内 element name 不重复。
  - join 只允许发生在安全 entity type 组合上。
  - filter field 必须存在于被选择的精确 view 上。
- 增加 semantic-graph resolver 用于 question scope：
  - input: metric candidates + group-by/filter phrases
  - output: allowed models、join path、dimensions、measures、需要澄清的原因
- Denodo PoC 建议从订单、支付、退款、交付、转化、城市聚合等窄域开始，不要一开始覆盖所有 view。
- 不要直接复制 MetricFlow 代码到 WrenAI，除非后续明确完成 license、attribution 和 dependency fit 审查。本次价值主要是架构借鉴。

## Open Questions

- WrenAI 是否要在 MDL 中引入一等 `metric` 定义，还是继续把客户指标公式放在独立业务配置中？
- Denodo selected-view relationships 能否从元数据可靠推断为 primary/unique/foreign，还是需要人工建模？
- WrenAI 是否应为覆盖范围内的 metric query 编译 deterministic SQL/VQL，还是只把 graph 用作 LLM SQL 生成前的 routing/context？
- 业务 dictionary 应落在 manifest 的哪个层级：dimension metadata、enum dictionary，还是独立 semantic-normalization rules？
- MetricFlow time spine 思路对客户 Denodo 场景有多大价值，尤其是月度 `YYYYMM` 字段和缺失周期补齐？
