# 当前项目语义层设计说明

本文说明当前项目的语义层设计，重点回答三个问题：

- 它的语义层到底建模了什么
- 它和普通 `NL2SQL` 有什么本质区别
- 语义层是如何进入问答、SQL、图表和部署链路的

本文基于仓库当前实现整理，主要参考：

- [modeling.tsx](/Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui/src/pages/modeling.tsx)
- [schema.ts](/Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui/src/apollo/server/schema.ts)
- [mdlBuilder.ts](/Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui/src/apollo/server/mdl/mdlBuilder.ts)
- [type.ts](/Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui/src/apollo/server/mdl/type.ts)
- [deployService.ts](/Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui/src/apollo/server/services/deployService.ts)

## 1. 总体定位

这个项目不是“让大模型直接看数据库表结构然后写 SQL”的简单 `NL2SQL`。

它的核心是：

`数据源 -> 业务语义模型 -> Manifest/MDL -> Deploy -> AI 问答 -> SQL 执行 -> 表格/图表/总结`

也就是说，大模型并不是直接面对原始数据库裸表，而是先面对一层已经整理过的业务语义模型。

这层语义模型负责把数据库技术结构翻译成业务可理解的结构，例如：

- 哪些表代表业务实体
- 哪些字段应该用业务名称展示
- 哪些字段是主键
- 哪些表之间存在关系
- 哪些字段是计算字段
- 哪些逻辑视图代表预定义分析视角

所以它更准确地说是：

- `Semantic BI + LLM`

而不是：

- `Text to SQL demo`

## 2. 语义层建模的核心对象

从代码看，这个项目的语义层主要由以下对象组成。

### 2.1 Project

`Project` 是语义层所属的顶层上下文，包含：

- 数据源类型
- catalog / schema
- 连接信息
- 语言
- 当前项目的推荐问题、部署状态等上下文

它不是单纯的数据库连接，而是整个 BI 工作空间的根对象。

代码参考：

- [projectRepository.ts](/Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui/src/apollo/server/repositories/projectRepository.ts)

### 2.2 Model

`Model` 是语义层里的业务实体，通常对应一张业务分析表或一个逻辑实体。

在 MDL 中，对应 `ModelMDL`，主要字段有：

- `name`
- `tableReference`
- `refSql`
- `columns`
- `primaryKey`
- `cached`
- `refreshTime`
- `properties.displayName`
- `properties.description`

这说明一个 model 既可以直接绑定物理表，也可以绑定一段 `refSql` 作为逻辑来源。

代码参考：

- [type.ts](/Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui/src/apollo/server/mdl/type.ts)

### 2.3 Column / Field

语义层里的字段在 MDL 中对应 `ColumnMDL`。

关键能力包括：

- 字段名 `name`
- 类型 `type`
- 是否计算字段 `isCalculated`
- 是否非空 `notNull`
- 表达式 `expression`
- 展示属性 `displayName` / `description`

字段并不只是数据库原始列。它可以是：

- 原始字段
- 重命名后的业务字段
- 带业务描述的字段
- 计算字段

### 2.4 Relation

`Relation` 是语义层的核心能力之一。

在 MDL 中，对应 `RelationMDL`，主要信息包括：

- `name`
- `models`
- `joinType`
- `condition`
- `manySideSortKeys`

这意味着系统不是靠 LLM 自己猜表关系，而是把关系显式建出来，然后在问答和 SQL 生成阶段使用。

这也是它区别于简单 `NL2SQL` 的关键点之一。

### 2.5 View

`View` 在语义层中是逻辑视图对象。

在 MDL 中，对应 `ViewMDL`，主要包括：

- `name`
- `statement`
- `properties.displayName`
- `properties.description`
- `properties.question`
- `properties.summary`

这说明 view 不只是一个 SQL 片段，它也能承载面向问答和分析的语义信息。

### 2.6 Metric

从 GraphQL schema 可以看到，项目支持 `Metric` 与 `MetricMeasure` 相关对象。这代表它不仅有表和字段，也具备指标层能力。

虽然本文主要依据 MDL 构造链路说明，但从整体产品能力看，这套系统是朝“语义模型 + 指标口径”方向走的，而不是只做表字段映射。

代码参考：

- [schema.ts](/Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui/src/apollo/server/schema.ts)

## 3. Manifest / MDL 是什么

这个项目会把上面的语义对象编译成一份可部署的 `Manifest`，代码中也常叫 `MDL`。

`Manifest` 是问答和执行链路真正依赖的语义层产物，主要结构包括：

- `catalog`
- `schema`
- `dataSource`
- `models`
- `relationships`
- `enumDefinitions`
- `views`

代码参考：

- [type.ts](/Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui/src/apollo/server/mdl/type.ts)

它的角色类似于：

- 语义层快照
- 已编译的业务模型
- AI 与查询引擎都能消费的统一描述文件

这意味着前端建模页上的结果不会直接用于问答，而是会先被编译成一份稳定结构，再进入后续链路。

## 4. MDL 是如何构建出来的

MDL 的构造由 `MDLBuilder` 完成。

构建流程很清楚：

1. `addProject()`
2. `addModel()`
3. `addNormalField()`
4. `addRelation()`
5. `addCalculatedField()`
6. `addView()`
7. `postProcessManifest()`

代码参考：

- [mdlBuilder.ts](/Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui/src/apollo/server/mdl/mdlBuilder.ts)

这说明语义层并不是数据库 schema 的直接镜像，而是一个带有构建过程的模型编译结果。

### 4.1 Model 如何进入 MDL

`addModel()` 会把数据库模型对象转成 `ModelMDL`，并注入：

- `referenceName`
- `displayName`
- `description`
- `tableReference` 或 `refSql`
- `primaryKey`

这里已经发生了一次“数据库对象 -> 业务对象”的转换。

### 4.2 普通字段如何进入 MDL

`addNormalField()` 会把非计算字段加入 model，并补齐：

- 主键
- 字段展示名
- 描述
- 嵌套字段展示信息
- 表达式

这一步说明字段不只是简单复制，而是伴随了业务元数据增强。

### 4.3 计算字段如何进入 MDL

`addCalculatedField()` 会把 `isCalculated = true` 的列单独处理，并把表达式写入 MDL。

这意味着语义层能够承载一部分业务逻辑，而不只是原始数据映射。

### 4.4 Relation 如何进入 MDL

`addRelation()` 会把模型间关系写入 `relationships`，包括：

- 两边的 model
- join type
- join condition

对于问答和 SQL 生成来说，这一步非常关键，因为它显式告诉系统：

- 哪些实体能联表
- 联表依据是什么
- 一对多还是多对一

### 4.5 View 如何进入 MDL

`addView()` 会把视图 statement 和相关属性放入 `views`。

这使得系统既能用底层 model 生成 SQL，也能基于已定义的分析视角进行工作。

## 5. Deploy 在语义层里的作用

在这个项目里，“建模完成”不等于“可以问答”。

语义层必须先 `deploy`，才能进入问答主链路。

`DeployService` 做的事主要包括：

- 对 Manifest 计算 hash
- 记录 deploy log
- 把 `manifest + hash + projectId` 发给 AI service
- 记录部署成功或失败状态

代码参考：

- [deployService.ts](/Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui/src/apollo/server/services/deployService.ts)

这说明语义层不是临时内存对象，而是一个：

- 可发布
- 可追踪
- 可版本化
- 可回溯

的业务模型产物。

这也是它更接近正式 BI 系统，而不是普通 `NL2SQL` demo 的地方。

## 6. 它和普通 NL2SQL 的区别

### 6.1 普通 NL2SQL

普通 `NL2SQL` 的典型链路是：

`问题 -> 数据库 schema -> LLM -> SQL`

特点是：

- 依赖数据库原始表结构
- 依赖 prompt 质量
- 容易受表名、字段名、口径不一致影响
- 对企业复杂语义环境不够稳定

### 6.2 当前项目

当前项目的链路更像：

`问题 -> 已发布语义层 -> 检索历史问题/SQL pair/instruction -> 生成 SQL -> 执行 -> 总结/图表`

也就是说，它多了几层关键结构：

- 显式业务建模
- 关系建模
- 计算字段
- 视图
- 部署版本
- 历史知识增强

因此它不是“让模型自己猜业务语义”，而是“先把业务语义建出来，再让模型使用这层语义”。

## 7. 这套语义层解决了什么问题

### 7.1 解决数据库命名过于技术化的问题

裸表字段通常偏技术名称，例如：

- `emp_no`
- `dept_no`
- `hire_date`

语义层可以把它们变成更适合业务理解的对象和字段。

### 7.2 解决关系靠模型猜测的问题

在普通 `NL2SQL` 里，模型经常需要猜：

- 哪张表该 join
- 用哪个字段 join

而语义层把关系显式定义出来，降低了猜错的概率。

### 7.3 解决口径不一致的问题

计算字段、视图、指标层能把业务口径固定下来，避免同一问题不同时间生成不同 SQL。

### 7.4 解决上线治理问题

通过 deploy 和 hash，模型不是随意变化的。问答使用的是某一版已发布语义层，便于追踪和治理。

## 8. 语义层在产品中的实际作用

从产品视角看，这层语义层至少承担了四个角色。

### 8.1 作为建模层

用于配置：

- 实体
- 字段
- 关系
- 计算字段
- 视图

### 8.2 作为 AI 的上下文层

问答不是直接面向数据库，而是先面向语义层。

### 8.3 作为查询执行层的语义中间表示

项目里存在 `Wren SQL` 和原生 SQL 的区分，这说明语义层不仅服务于问答，也服务于 SQL 生成和转换。

### 8.4 作为 BI 复用层

同一套语义模型可以被：

- 问答
- 图表
- Dashboard
- 推荐问题
- SQL pair

共同复用。

## 9. 可以把它理解成什么

如果要用一句话概括，这个项目的语义层可以理解成：

> 一层位于数据库之上的业务语义抽象，它把表、字段、关系、计算逻辑和视图编译成可部署的 Manifest，供 AI 问答与 BI 查询统一使用。

它不是简单 schema，也不是单纯 metadata，而是：

- 建模层
- 发布层
- AI 上下文层
- 查询语义层

的组合。

## 10. 对你当前工作的启示

如果你的目标是做可演示的 BI 前端，这个语义层设计非常重要，因为它决定了前端展示不应只是一个聊天框。

更合理的前端演示应该同时体现：

- 数据源接入
- 语义建模入口
- 已部署语义模型
- 问答结果
- SQL
- 图表
- Dashboard

这样领导看到的就不是一个 `NL2SQL` 页面，而是一套“有语义层、有配置能力、有 BI 工作流”的平台型产品。

## 11. 结论

这个项目的语义层不是附属能力，而是整套系统的核心。

它的本质是：

- 用 `Model / Field / Relation / View / Metric` 组织业务知识
- 编译成 `Manifest / MDL`
- 通过 `Deploy` 进入正式问答和 BI 链路

因此，这个项目的正确理解方式不是：

- “一个会写 SQL 的聊天工具”

而是：

- “一个以语义层为核心、由 AI 驱动查询和分析体验的 BI 系统”
