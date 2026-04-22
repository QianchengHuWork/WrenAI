# 客户版 x86 Bundle 使用说明

这套 bundle 面向单机 `linux/amd64` 的 `Docker Compose` 部署。

## 包含内容

- 基于当前分支源码构建的 `wren-ui` 镜像
- 基于当前分支源码构建的 `wren-ai-service` 镜像
- 固定版本的依赖镜像：`wren-engine`、`ibis-server`、`bootstrap`、`qdrant`
- Compose 文件、环境变量文件、安装脚本、源码快照

## 前置条件

### 打包机

- Docker，且支持 `buildx`
- Git
- `tar` 和 `gzip`
- 能访问 Docker 镜像仓库和 `https://api.siliconflow.cn`

### 运行机

- Docker
- Docker Compose 插件
- 能访问 `https://api.siliconflow.cn`

运行机不需要预装 Node.js、Python、Poetry、Yarn 或 SQLite。

默认已经关闭首页和线程里的“推荐问题”能力。如果要重新开启，把 `.env.customer` 里的 `NEXT_PUBLIC_ENABLE_RECOMMENDED_QUESTIONS=true`。

## 1. 生成 bundle

在要生成客户包的机器上执行：

```bash
cd docker/customer-x86
export SILICONFLOW_API_KEY=你的真实密钥
./package.sh
```

生成结果会写到 `docker/customer-x86/dist/`。

输出文件包括：

- `images-<git_sha>.tar.gz`
- `source-<git_sha>.tar.gz`
- `images.manifest.txt`
- `checksums.txt`
- `.env.customer`
- `docker-compose.customer.yaml`
- `install.sh`
- `README.customer.md`

## 2. 本地先试跑

如果你想先在本机验证 bundle，可以直接使用生成好的 `dist/` 目录：

```bash
cd docker/customer-x86/dist
./install.sh
```

启动后访问：

- UI：`http://127.0.0.1:3000`
- AI 健康检查：`http://127.0.0.1:5555/health`

停止服务：

```bash
docker compose --env-file .env.customer -f docker-compose.customer.yaml down
```

如果希望保留重启后的数据，请保留 `./data/` 目录。

## 3. 部署到客户服务器

把完整的 `dist/` 目录拷贝到客户 x86 Linux 服务器。

然后执行：

```bash
cd dist
./install.sh
```

安装脚本会完成：

- 加载 `images-*.tar.gz`
- 创建挂载的数据目录
- 启动 Compose 服务
- 等待 UI 和 AI 服务健康检查通过

启动后访问：

- `http://<host>:3000`

## 4. 配置说明

如果要改端口或数据目录，先编辑 `.env.customer`，常见项有：

- `HOST_PORT`
- `AI_SERVICE_FORWARD_PORT`
- `NEXT_PUBLIC_ENABLE_RECOMMENDED_QUESTIONS`
- `CUSTOMER_UI_DATA_DIR`
- `CUSTOMER_QDRANT_STORAGE_DIR`
- `CUSTOMER_SHARED_ETC_DIR`
- `CUSTOMER_LOCAL_STORAGE_DIR`

默认存储位置是：

- SQLite：`CUSTOMER_UI_DATA_DIR`
- Qdrant：`CUSTOMER_QDRANT_STORAGE_DIR`
- engine bootstrap 共享数据：`CUSTOMER_SHARED_ETC_DIR`
- engine 本地数据：`CUSTOMER_LOCAL_STORAGE_DIR`

## 5. 运行注意事项

- 这是单实例部署，不能让多个 `wren-ui` 容器共用同一个 SQLite 文件。
- AI 镜像会在打包阶段写入 `SILICONFLOW_API_KEY`。这个做法安全风险较高，只建议用于当前 POC。
- 这个 bundle 只面向 `linux/amd64`，不要拿去部署到 ARM 机器。

## 6. 常见问题

- 如果 `install.sh` 提示 `PACKAGE_TAG is still a placeholder`，先修改 `.env.customer`。
- 如果 Docker 提示找不到镜像，确认你是在包含 `images-*.tar.gz` 的 `dist/` 目录里执行 `install.sh`。
- 如果 UI 没起来，先看日志：

```bash
docker compose --env-file .env.customer -f docker-compose.customer.yaml logs --tail=200
```
