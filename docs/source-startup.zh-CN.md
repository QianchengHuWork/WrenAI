# WrenAI 源码启动指南

这份文档说明如何基于**当前本地源码改动**启动 WrenAI，而不是拉官方发布镜像。

适用场景：
- 你正在开发 `wren-ui` 或 `wren-ai-service`
- 你希望页面跑的是当前分支代码
- 你只需要最小依赖容器，不想启动整套旧镜像

不适用场景：
- 客户交付包启动
- `./scripts/wren-one-click.sh up`

`wren-one-click` 会拉镜像版服务，不适合验证当前分支代码改动。

## 一、启动方式总览

源码启动建议拆成 3 部分：

1. 依赖容器
   - `wren-engine`
   - `ibis-server`
   - `qdrant`
2. 本地源码启动 `wren-ai-service`
3. 本地源码启动 `wren-ui`

推荐开 3 个终端窗口分别执行。

## 二、前置要求

### 1. 系统工具

需要本机具备：

- Docker
- Docker Compose
- Node.js 18
- Yarn
- Python 3.12
- Poetry
- Just

### 2. 代码目录

假设仓库根目录为：

```bash
/Users/qianchenghu/PycharmProjects/workspace/WrenAI
```

后文所有命令都基于这个仓库结构。

## 三、推荐端口

本地源码启动默认使用这些端口：

- UI: `3000`
- AI Service: `5556`
- Wren Engine: `8080`
- Ibis Server: `8000`
- Qdrant: `6333`

## 四、终端 1：启动依赖容器

工作目录：

```bash
cd /Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ai-service
```

先准备 engine 需要的本地文件：

```bash
just prepare-files
```

然后只启动最小依赖，不启动镜像版 `wren-ui` 和 `wren-ai-service`：

```bash
docker compose \
  -f ./tools/dev/docker-compose-dev.yaml \
  --env-file ./tools/dev/.env \
  up -d wren-engine ibis-server qdrant
```

说明：
- 这里只起依赖容器，不起 `wren-ui` 镜像
- 这样 `3000` 和 `5556` 不会被容器占掉
- 你后面启动的就是本地源码服务

检查容器是否正常：

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

你应该能看到：
- `wren-wren-engine-1`
- `wren-ibis-server-1`
- `wren-qdrant-1`

## 五、终端 2：启动 wren-ai-service 源码

工作目录：

```bash
cd /Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ai-service
```

首次启动先安装依赖：

```bash
poetry install
```

初始化本地配置文件：

```bash
just init
```

这一步会生成：
- `config.yaml`
- `.env.dev`

你至少需要检查并补齐：
- LLM 配置
- Embedding 配置
- 对应的 API Key

然后启动 AI 服务：

```bash
just start
```

默认启动地址：

```bash
http://127.0.0.1:5556
```

健康检查：

```bash
curl http://127.0.0.1:5556/health
```

预期返回：

```json
{"status":"ok"}
```

## 六、终端 3：启动 wren-ui 源码

工作目录：

```bash
cd /Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui
```

先确认 Node 版本必须是 18：

```bash
node -v
```

再安装依赖：

```bash
yarn
```

### 1. 使用 SQLite

源码开发推荐直接用 SQLite。

先执行数据库迁移：

```bash
export DB_TYPE=sqlite
export SQLITE_FILE=./db.sqlite3
export WREN_AI_ENDPOINT=http://127.0.0.1:5556
export WREN_ENGINE_ENDPOINT=http://127.0.0.1:8080
export IBIS_SERVER_ENDPOINT=http://127.0.0.1:8000

yarn migrate
```

然后启动前端：

```bash
export DB_TYPE=sqlite
export SQLITE_FILE=./db.sqlite3
export WREN_AI_ENDPOINT=http://127.0.0.1:5556
export WREN_ENGINE_ENDPOINT=http://127.0.0.1:8080
export IBIS_SERVER_ENDPOINT=http://127.0.0.1:8000

yarn dev
```

默认访问地址：

```bash
http://127.0.0.1:3000
```

### 2. 推荐问题开关

当前代码里推荐问题默认就是关闭的，不需要额外设置。

如果你要强制开启，可以额外加：

```bash
export NEXT_PUBLIC_ENABLE_RECOMMENDED_QUESTIONS=true
```

## 七、最小可用启动顺序

按顺序执行：

1. `wren-ai-service` 目录启动依赖容器
2. `wren-ai-service` 目录启动本地 AI 服务
3. `wren-ui` 目录执行 migration
4. `wren-ui` 目录启动本地前端

## 八、验证是否真的跑的是本地源码

这一步很重要。

如果你启动的是本地源码版本，应满足：

- `3000` 端口来自本地 `yarn dev`
- `5556` 端口来自本地 `just start`
- Docker 里**不应该**有镜像版 `wren-ui` 或 `wren-ai-service` 在运行

可以这样检查：

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

理想情况下，只保留这几个依赖容器：
- `wren-wren-engine-1`
- `wren-ibis-server-1`
- `wren-qdrant-1`

如果你看到下面这些容器仍在跑，说明你起的不是纯源码版本：
- `wrenai-customer-wren-ui-1`
- `wrenai-customer-wren-ai-service-1`
- 其他镜像版 `wren-ui` / `wren-ai-service`

## 九、停止方式

### 1. 停止本地源码服务

分别在 `wren-ui` 和 `wren-ai-service` 的终端里按：

```bash
Ctrl + C
```

### 2. 停止依赖容器

工作目录：

```bash
cd /Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ai-service
```

执行：

```bash
docker compose \
  -f ./tools/dev/docker-compose-dev.yaml \
  --env-file ./tools/dev/.env \
  down
```

如果你只想停最小依赖，也可以直接删除对应容器。

## 十、常见问题

### 1. 页面打开了，但不是我当前改的版本

通常原因是：
- 你启动了镜像版 `wren-ui`
- 或 `3000` 端口已经被旧容器占用

先检查：

```bash
docker ps
```

把镜像版 `wren-ui` / `wren-ai-service` 停掉，再重启本地源码服务。

### 2. `Failed to create asking task`

通常是 `wren-ui` 没连到本地 AI 服务。

确认下面几个变量是否正确：

```bash
export WREN_AI_ENDPOINT=http://127.0.0.1:5556
export WREN_ENGINE_ENDPOINT=http://127.0.0.1:8080
export IBIS_SERVER_ENDPOINT=http://127.0.0.1:8000
```

### 3. `No internet` 或首页报错

先检查：
- `wren-ui` 是否真的在 `3000`
- `wren-ui` 的 Node 版本是不是 18
- `wren-ui` 是否执行过 `yarn migrate`

### 4. 依赖容器起不来

先看：

```bash
docker compose \
  -f ./tools/dev/docker-compose-dev.yaml \
  --env-file ./tools/dev/.env \
  logs
```

最常见的是端口冲突：
- `8080`
- `8000`
- `6333`

## 十一、一套可直接复制的命令

### 终端 1

```bash
cd /Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ai-service
just prepare-files
docker compose \
  -f ./tools/dev/docker-compose-dev.yaml \
  --env-file ./tools/dev/.env \
  up -d wren-engine ibis-server qdrant
```

### 终端 2

```bash
cd /Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ai-service
poetry install
just init
just start
```

### 终端 3

```bash
cd /Users/qianchenghu/PycharmProjects/workspace/WrenAI/wren-ui
yarn
export DB_TYPE=sqlite
export SQLITE_FILE=./db.sqlite3
export WREN_AI_ENDPOINT=http://127.0.0.1:5556
export WREN_ENGINE_ENDPOINT=http://127.0.0.1:8080
export IBIS_SERVER_ENDPOINT=http://127.0.0.1:8000
yarn migrate
yarn dev
```
