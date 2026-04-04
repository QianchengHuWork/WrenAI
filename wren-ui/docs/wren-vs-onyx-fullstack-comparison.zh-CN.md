# 当前项目 vs Onyx 详细对比报告

面向新项目整合评估，重点关注前端能力差距，同时纳入会反向塑造前端设计的全栈边界。

## 1. 结论摘要

### 一页结论

- **当前项目**本质上是一个 `语义建模驱动的 ChatBI / Semantic BI 前端 + BFF`。它的核心工作流是：`setup -> modeling -> deploy -> ask -> SQL/chart/dashboard`。
- **Onyx**本质上是一个 `通用企业 AI 平台 / RAG Chat / Agents / Connectors 工作台`。它的核心工作流是：`chat -> retrieval -> connectors -> agents -> admin`。
- 如果新项目的主目标是 **ChatBI**，那么**当前项目更适合作为前端底座**，因为它已经具备建模、SQL 查看、结果预览、图表、仪表板和 BI 导向问答工作流。
- 如果新项目还需要 **通用 AI 工作台 / 知识助手 / Agents / 多连接器交互**，那么 **Onyx 更适合作为能力参考来源**，尤其是在现代 AI SaaS 前端工程、聊天工作台、管理后台和连接器交互范式上。
- **不建议直接选一方完全替代另一方。** 对新项目最现实的角色分工是：
  - 当前项目承接：`建模 + SQL + 图表 + Dashboard + BI 工作流`
  - Onyx 承接：`通用 AI 工作台 + RAG/Agent/Connectors 的交互范式`

### 推荐判断

**优先选择“以当前项目为 BI 底座，吸收 Onyx 的通用 AI 工作台能力”**。

原因很简单：

- Onyx 补齐 BI 语义建模和 SQL 工作流的成本很高。
- 当前项目补齐现代 AI 工作台体验和知识连接器交互，相对更现实。
- 两者前端能力的重叠主要在“聊天壳子”，但产品内核完全不同。

---

## 2. 产品与架构定位对比

### 2.1 当前项目的定位

从本地仓库实现看，当前项目不是一个纯聊天前端，而是一个带 BFF 的 BI 产品前端：

- `wren-ui` 使用 `Next.js + React + Apollo Client + Apollo Server Micro`，说明它同时承担页面和 BFF 角色。
- 页面主入口清晰分成：
  - `setup/connection`
  - `setup/models`
  - `setup/relationships`
  - `modeling`
  - `home`
  - `home/dashboard`
  - `knowledge/*`
  - `api-management/history`
- `modeling` 页负责模型、关系、计算字段、视图、元数据等业务语义层编辑。
- `home` 页不是普通 chat，而是围绕提问、生成 SQL、查看结果、生成图表、保存知识展开。
- `deploy` 是前置动作，说明问答依赖一个已发布的语义模型版本。

它更像：

`轻量语义层建模工具 + ChatBI 前端 + BFF`

而不是：

`通用企业知识聊天平台`

### 2.2 Onyx 的定位

根据官方 README，Onyx 是：

- `Open Source AI Platform`
- `feature-rich, self-hostable Chat UI that works with any LLM`
- 强调的能力包括：
  - Agents
  - Web Search
  - RAG
  - MCP
  - Deep Research
  - Connectors to 40+ knowledge sources
  - Code Interpreter
  - Image Generation
  - Collaboration
  - Management UI

这意味着 Onyx 的核心不是 BI，而是：

`企业级通用 AI 工作台 / 知识助手平台`

### 2.3 两者最根本的差异

| 维度 | 当前项目 | Onyx | 结论 |
|---|---|---|---|
| 核心对象 | 模型、字段、关系、视图、部署版本、SQL、图表 | 文档、连接器、知识源、Agent、权限、聊天会话 | 本质是两类产品 |
| 主要目标 | 让用户对业务数据问数、看 SQL、看图、做 dashboard | 让用户和企业知识、工具、Agent 交互 | 当前项目偏 BI，Onyx 偏 AI 平台 |
| 前端中心页面 | modeling + home + dashboard | chat + connectors + admin + agents | 页面范式不同 |
| 后端契约核心 | deploy/manifest/sql/result/native-sql | retrieval/connectors/agents/permissions | 前端耦合面完全不同 |

### 2.4 为什么它们都像 chat UI，但不是同类产品

两者都会出现聊天输入框、回答区、会话历史，但底层驱动完全不同：

- 当前项目里，chat 只是 BI 操作入口；真正核心是语义建模和 SQL 执行。
- Onyx 里，chat 本身就是产品中心；检索、Agent、工具调用都围绕它组织。

因此，不能因为它们都“有聊天页”就认为前端能力可直接替换。

---

## 3. 前端能力对比

这一节是报告主体，按能力域对比。

### 3.1 页面工作台结构

#### 当前项目现状

当前项目的页面结构是典型 BI 工作台：

- `setup/*`：数据源接入、选表、关系定义
- `modeling`：模型图、元数据、关系、计算字段、视图
- `home`：提问和结果呈现
- `home/dashboard`：仪表板和缓存刷新
- `knowledge/*`：问题-SQL 对与指令
- `api-management/history`：接口历史

这种结构非常强调“从数据接入到业务语义再到问答结果”的完整闭环。

#### Onyx 现状

根据官方 README 和公开前端目录，Onyx 的页面工作台明显更平台化：

- `app/admin`
- `app/connector`
- `app/auth`
- `app/mcp`
- `app/app`
- 以及配套的 `components / hooks / providers / sections / layouts`

这类命名表明它的工作台重点是聊天平台、管理界面、连接器和平台配置，而不是 BI 建模。

#### 差距结论

- 当前项目的工作台结构是**流程驱动 BI 产品**。
- Onyx 的工作台结构是**平台驱动 AI 产品**。

#### 对新项目整合的启示

- 如果新项目主目标是 ChatBI，页面骨架应优先参考当前项目。
- 如果新项目还要覆盖管理后台、连接器中心、Agent 配置台，则应参考 Onyx 的工作台分区方式。

### 3.2 聊天交互能力

#### 当前项目现状

当前项目的聊天能力强依赖 BI 问答：

- 问题提交不是直接得到文案，而是先生成 asking task。
- 前端通过 Apollo 轮询任务状态，再用 `EventSource` 消费推理过程和文本答案流。
- 回答区不仅有文本，还包括：
  - SQL 查看
  - 原始 SQL 切换
  - 结果预览
  - 图表
  - 调整 SQL
  - 调整推理步骤

这说明它的聊天体验核心是：**围绕 SQL 和结果展示展开**。

#### Onyx 现状

根据官方定位，Onyx 的聊天是一个通用 AI chat workspace，支持：

- 纯对话
- RAG
- Web Search
- Agent 调用
- MCP / Actions
- Code Interpreter
- Image Generation

它的聊天目标是一个“多能力 AI 助手入口”，不是 BI 查询操作入口。

#### 差距结论

- 当前项目的聊天是 **SQL/数据结果导向**
- Onyx 的聊天是 **通用 AI 工作流导向**

#### 对新项目整合的启示

- 需要保留当前项目的“回答结果结构”。
- 可以参考 Onyx 的“聊天工作台组织方式”，但不应直接替换当前项目的结果面板逻辑。

### 3.3 建模与配置能力

#### 当前项目现状

这是当前项目最强、也是最难替代的部分。

前端里已经具备：

- 数据源接入
- 模型定义
- 字段配置
- 关系配置
- 计算字段
- 视图
- 元数据编辑
- 发布动作

这些能力使前端不只是“消费查询结果”，而是“定义 BI 语义层”。

#### Onyx 现状

Onyx 的公开定位里没有 BI 语义建模工作台。它更强调：

- connectors
- knowledge sources
- permissions
- agents

即使存在配置页面，也不是围绕字段关系和业务语义层建模展开。

#### 差距结论

- 当前项目强：**BI 语义建模前端**
- Onyx 弱：**缺少 ChatBI 所需的建模工作台**

#### 对新项目整合的启示

- 新项目只要目标仍是 ChatBI，建模前端必须以当前项目为基底。
- 不建议尝试把 Onyx 改造成 BI 建模前端。

### 3.4 数据可视化与 BI 结果展示

#### 当前项目现状

当前项目已经内建 BI 展示链路：

- SQL 代码块
- 结果预览表格
- 图表渲染
- 图表属性配置
- Dashboard Grid
- Dashboard 缓存刷新和计划任务

这套能力是成体系的，不是单个图表组件。

#### Onyx 现状

Onyx 有图表和分析相关依赖，如 `recharts`，也有 code interpreter 能力描述，但公开信息并未显示其主产品是围绕 BI 图表工作台构建。

#### 差距结论

- 当前项目的图表能力是 **BI 工作流中的一环**
- Onyx 的图表能力更像 **通用 AI 回答增强**

#### 对新项目整合的启示

- 图表、结果预览、dashboard 能力建议保留当前项目。
- 如果要现代化视觉，可以在表现层参考 Onyx，但不应放弃当前项目已有的 BI 结果链路。

### 3.5 知识接入与连接器能力

#### 当前项目现状

当前项目的接入中心是数据库/数仓：

- MySQL
- PostgreSQL
- SQL Server
- Oracle
- ClickHouse
- BigQuery
- Snowflake
- Trino
- Redshift
- Databricks
- Athena
- DuckDB

这是一种“面向 BI 数据源”的接入设计。

#### Onyx 现状

Onyx 的官方 README 明确写了 `Connectors to 40+ knowledge sources`，并强调：

- 文档与知识摄取
- 权限映射
- 企业搜索
- 文档权限继承

这是一种“面向知识与应用生态”的接入设计。

#### 差距结论

- 当前项目偏 **数据库连接器**
- Onyx 偏 **知识源连接器**

#### 对新项目整合的启示

- 如果新项目未来需要同时做 ChatBI 和企业知识助手，连接器层需要双轨设计。
- BI 数据源接入可延续当前项目思路。
- 知识源接入和连接器管理界面可借鉴 Onyx 的平台化思路。

### 3.6 实时交互与状态消费

#### 当前项目现状

当前项目采用“轮询 + SSE”混合模式：

- Apollo GraphQL 轮询 asking task / recommended question task
- `EventSource` 消费推理和文本回答流
- 页面局部状态和局部 store 负责中间态拼装

这套方式对 ChatBI 是够用的，优点是简单清晰。

#### Onyx 现状

Onyx 的前端依赖显示其采用更现代的组合：

- `zustand`
- `swr`
- `Radix`
- `Headless UI`
- `motion`
- `dnd-kit`

这通常对应更复杂的 AI workspace 状态组织和更高互动密度的产品形态。

#### 差距结论

- 当前项目：**面向单链路 BI 问答的稳定实现**
- Onyx：**更适合承载复杂 AI 平台交互**

#### 对新项目整合的启示

- 当前项目现有状态流可作为 MVP。
- 如果新项目要承载更多 AI 平台级交互，建议后续重构状态层，不要长期停留在 Apollo 轮询 + 页面局部 store 的混合方案上。

### 3.7 管理后台与企业能力前端

#### 当前项目现状

当前项目有设置、API 历史、知识库、Dashboard，但整体管理前端范围有限，更多是产品自用后台，而非平台级企业控制台。

#### Onyx 现状

根据 README，Onyx 明确具备：

- user management
- usage analytics
- Management UI
- SSO / RBAC / document permissioning

这说明它在企业化控制面前端上明显更成熟。

#### 差距结论

- Onyx 强于当前项目：**平台级管理与企业能力前端**

#### 对新项目整合的启示

- 如果新项目未来要做企业级 SaaS 控制台，Onyx 更值得参考。
- 对 ChatBI MVP 而言，这部分不是第一优先级。

### 3.8 UI 与工程现代化程度

#### 当前项目现状

当前项目技术栈：

- `Next.js 14`
- `React 18`
- `TypeScript 5`
- `Ant Design 4`
- `styled-components`
- `Less`
- `Apollo Client`
- `reactflow`
- `vega / vega-lite`
- `react-grid-layout`
- `react-ace`

这是一个典型的企业后台 + BI 产品组合。

#### Onyx 现状

Onyx 技术栈：

- `Next.js 16`
- `React 19`
- `TypeScript 5.9`
- `Tailwind CSS`
- `Radix UI`
- `Headless UI`
- `Zustand`
- `SWR`
- `TanStack Table`
- `Recharts`
- `dnd-kit`
- `react-dropzone`
- `motion`
- `storybook`

这套栈明显更现代，更偏 AI SaaS 工作台。

#### 差距结论

- 当前项目更像传统企业 BI 产品
- Onyx 更像现代 AI SaaS 工作台

#### 对新项目整合的启示

- 如果你追求现代 UI 与长期可演进性，Onyx 的工程组织更值得参考。
- 但技术栈不能反向决定产品方向，ChatBI 的核心仍然更匹配当前项目。

---

## 4. 技术栈与前端工程实现对比

### 4.1 技术栈对比表

| 维度 | 当前项目 | Onyx | 结论 |
|---|---|---|---|
| 框架 | Next.js 14.2.35 | Next.js 16.1.7 | Onyx 更新 |
| React | React 18.2 | React 19.2 | Onyx 更新 |
| UI 体系 | Ant Design 4 + styled-components + Less | Tailwind + Radix UI + Headless UI | 风格和范式差异大 |
| 状态管理 | Apollo Client + React state + custom hooks + 局部 store | Zustand + SWR + React hooks | Onyx 更现代 |
| 数据获取 | GraphQL hooks 为主 | SWR + 平台化组件/Provider | 获取范式不同 |
| 图表 | Vega / Vega-Lite | Recharts | 当前项目更偏分析配置，Onyx 更偏轻交互 |
| 拖拽/布局 | react-grid-layout + reactflow | dnd-kit | 使用目标不同 |
| 代码编辑/渲染 | react-ace + react-markdown | react-markdown + highlight/katex 等 | 当前项目更强调 SQL 编辑 |
| 实时通信 | Apollo 轮询 + SSE/EventSource | 未从公开资料确认具体协议；推断更偏平台型状态组织 | 当前项目已验证有混合流 |
| 组件开发支持 | 无 Storybook | 有 Storybook | Onyx 工程成熟度更高 |

### 4.2 技术选择带来的结果

#### 当前项目为什么更像传统 BI 企业后台

- Ant Design 4 天然适合后台表单、表格、弹窗、配置型页面。
- Apollo GraphQL 强调结构化读写和轮询任务状态，适合 BI 工作流。
- Vega、React Flow、React Grid Layout 组合适合图表、模型图和仪表板。

#### Onyx 为什么更像现代 AI SaaS 工作台

- Tailwind + Radix/Headless UI 更适合快速构造高定制度交互界面。
- Zustand + SWR 更适合复杂客户端状态和轻量数据获取。
- dnd-kit、motion、Storybook 说明其更偏面向产品体验和组件工程化。

### 4.3 迁移/融合成本判断

- **视觉体系难合并**：Ant Design 4 与 Tailwind/Radix 的设计哲学差异很大。
- **状态管理模式差异大**：Apollo-centric 与 Zustand/SWR-centric 难以无缝混用。
- **页面范式差异大于组件粒度差异**：真正难的是工作台结构和产品抽象，而不是按钮和表单组件。

---

## 5. 前后端耦合与全栈边界对比

### 5.1 当前项目的前端/BFF 一体模式

当前项目不是纯前端：

- `Next.js` 页面负责 UI
- `pages/api/graphql.ts` 暴露 Apollo GraphQL 服务
- `pages/api/*` 还承担 ask、stream、preview 等 BFF 路由
- 前端页面直接依赖：
  - deploy 状态
  - manifest/hash
  - asking task
  - native SQL
  - preview data

所以这个前端并不能被视为“拿起来就接任意后端的纯 UI”。

### 5.2 Onyx 的平台型依赖

Onyx 的前端能力强依赖平台后端：

- connectors
- retrieval
- agents
- management UI
- permissions

这意味着它的前端很多能力只有在对应平台能力存在时才成立。

### 5.3 边界判断

| 问题 | 当前项目 | Onyx |
|---|---|---|
| 能否当纯前端壳直接复用 | 否，BFF 和 BI 契约绑定深 | 否，平台后端能力依赖强 |
| 最大耦合点 | deploy/manifest/asking task/native SQL | connectors/retrieval/agents/permissions |
| 对新项目的启示 | 前端改造必须同时考虑接口适配层 | 前端借鉴不能脱离产品平台能力假设 |

### 5.4 哪些是前端问题，哪些其实是后端契约问题

前端问题：

- 页面结构
- 组件体系
- 状态组织
- 设计系统
- 交互工作台布局

后端契约问题：

- 当前项目的 deploy / ask / result / nativeSql / previewData
- Onyx 的 connectors / retrieval / agents / permissioning

如果不先统一契约，仅改前端外壳不会得到稳定的新产品。

---

## 6. 整合方案评估

### 方案一：以当前项目为底，吸收 Onyx 能力

#### 描述

- 保留当前项目的 BI 工作台骨架
- 保留建模、SQL、图表、Dashboard、结果预览
- 在聊天工作台、连接器交互、设计系统和管理面上借鉴 Onyx

#### 优点

- 最贴合 ChatBI 主目标
- 保留现有语义建模和 BI 链路
- 风险最低，路径最现实

#### 缺点

- 需要逐步重构现有前端工程体系
- 会经历一段“旧 BI 后台风格 + 新 AI 工作台风格并存”的阶段

#### 适用前提

- 新项目核心仍然是 ChatBI
- 短中期以 BI 问答和结果可信度为主

#### 风险

- 状态管理和设计系统重构成本
- BFF 契约需要重新抽象，不能继续深绑旧后端模型

#### 推荐等级

**强烈推荐**

### 方案二：以 Onyx 为底，补 BI 能力

#### 描述

- 以 Onyx 的现代 AI 工作台为前端底座
- 额外补出 BI 建模、SQL 工作流、图表与 dashboard

#### 优点

- AI 工作台和平台型能力起点高
- 前端工程更现代

#### 缺点

- 需要从零补 BI 语义建模前端
- 需要重建 SQL 结果链路和 dashboard 工作流
- ChatBI 需要的大量领域组件都不现成

#### 适用前提

- 新项目目标已不以 ChatBI 为主，而是综合企业 AI 平台

#### 风险

- BI 能力重建成本高
- 容易做成“什么都想要，核心不聚焦”的平台

#### 推荐等级

**不推荐作为 ChatBI 主路线**

### 方案三：双层整合

#### 描述

- BI 工作台保留当前项目思路
- 通用 AI 助手域参考 Onyx
- 统一身份、导航、设计语言和部分基础组件

#### 优点

- 最符合两者的天然优势分工
- 可支持未来“ChatBI + 知识助手”双场景

#### 缺点

- 初期架构设计要求高
- 两条产品线容易产生重复能力

#### 适用前提

- 新项目目标明确包含两个域：BI 与企业知识助手

#### 风险

- 导航与信息架构复杂化
- 状态和权限模型容易失控

#### 推荐等级

**推荐作为中长期演进方向，不建议一开始就全量落地**

---

## 7. 新项目的前端落地建议

### 7.1 建议保留的模块

- 建模页
- SQL 查看区
- 结果预览
- 图表结果区
- Dashboard Grid
- 数据预览能力
- 与 BI 语义层直接相关的弹窗、选择器、关系图

### 7.2 建议深改的模块

- `home/chat` 容器
- 前端状态组织
- 问答结果编排方式
- BFF 接口层
- 与当前 deploy / asking task 强绑定的前端逻辑

### 7.3 建议参考 Onyx 重建的模块

- 通用聊天布局
- AI 工作台信息架构
- 连接器/知识助手入口
- 平台级管理界面
- 设计系统与基础组件体系
- 更现代的前端状态组织方式

### 7.4 暂不优先处理的模块

- 不影响 ChatBI MVP 的企业管理能力
- 不影响 BI 问答闭环的高级平台功能
- 纯知识助手域的复杂 Agent 工作流

### 7.5 默认演进顺序

1. 明确新项目主定位：ChatBI 为主  
2. 保留当前项目 BI 页面与结果能力  
3. 抽象并重构问答数据流和 API 适配层  
4. 引入 Onyx 式聊天工作台体验与知识/连接器入口  
5. 最后统一设计系统、状态管理和身份导航体系  

---

## 8. 数据来源与证据说明

### 当前项目（代码事实）

本报告关于当前项目的判断来自本地仓库真实实现，包括但不限于：

- `wren-ui/package.json`
- `wren-ui/src/pages/_app.tsx`
- `wren-ui/src/pages/modeling.tsx`
- `wren-ui/src/pages/setup/connection.tsx`
- `wren-ui/src/pages/home/index.tsx`
- `wren-ui/src/pages/home/dashboard.tsx`
- `wren-ui/src/pages/knowledge/question-sql-pairs.tsx`
- `wren-ui/src/pages/api/graphql.ts`
- `wren-ui/src/hooks/useAskingStreamTask.tsx`
- `wren-ui/src/hooks/useTextBasedAnswerStreamTask.tsx`

### Onyx（公开一手资料）

本报告关于 Onyx 的判断来自：

- 官方 GitHub README  
  `https://github.com/onyx-dot-app/onyx`
- 官方 `web/package.json`  
  `https://raw.githubusercontent.com/onyx-dot-app/onyx/main/web/package.json`
- GitHub API 公开目录：
  - `web/src`
  - `web/src/app`
  - `web/src/components`

### 判断边界

- 任何关于 Onyx 具体页面行为的结论，如果没有直接源码验证，均按“公开资料可推断的工程判断”处理。
- 本报告尽量使用一手证据，但不会伪装未验证的推断为已确认事实。

---

## 9. 最终建议

如果你的新项目目标是：

> 以 ChatBI 为核心，同时逐步吸收通用 AI 工作台与知识助手能力

那么正确的整合方向不是“选 Wren 还是选 Onyx”，而是：

> **保留当前项目的 BI 核心前端能力，重构其外层工作台和接口适配方式，并在聊天工作台、连接器交互和平台化前端工程上系统借鉴 Onyx。**

这是成本最低、成功率最高、也最符合两个项目天然能力边界的方案。
