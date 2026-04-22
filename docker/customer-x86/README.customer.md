# 客户版 x86 Linux 部署包

这个目录保存的是客户交付包的源码级说明和打包脚本，目标是单机 `Docker Compose` 部署。

更详细的本地试跑和客户服务器部署步骤请看 [USAGE.md](/Users/qianchenghu/PycharmProjects/workspace/WrenAI/docker/customer-x86/USAGE.md)。

## 打包内容

- `wren-ui`：基于当前分支源码构建
- `wren-ai-service`：基于当前分支源码构建
- `wren-engine`、`ibis-server`、`bootstrap`、`qdrant`：使用固定版本镜像并随包打出，支持离线加载

## 前置条件

### 打包机

- 安装 Docker，且支持 `buildx`
- 安装 Git
- 安装 `gzip` / `tar`
- 能访问镜像仓库和 `https://api.siliconflow.cn`

### 客户机

- 安装 Docker
- 安装 Docker Compose 插件
- 能访问 `https://api.siliconflow.cn`

客户机不需要预装 Node.js、Python、Poetry、Yarn 或 SQLite。

## 打包

```bash
cd docker/customer-x86
export SILICONFLOW_API_KEY=你的真实密钥
./package.sh
```

生成结果会写到 `dist/`：

- `images-<git_sha>.tar.gz`
- `source-<git_sha>.tar.gz`
- `images.manifest.txt`
- `checksums.txt`
- `.env.customer`
- `docker-compose.customer.yaml`
- `install.sh`
- `README.customer.md`

## 在客户机上安装

1. 把完整的 `dist/` 目录拷到目标机器。
2. 如需调整端口或数据目录，先检查 `.env.customer`。
3. 执行：

```bash
cd dist
./install.sh
```

## 说明

- SQLite 文件保存在 `CUSTOMER_UI_DATA_DIR` 指定的 UI 数据目录内。
- 这是单实例部署，不要让多个 `wren-ui` 容器共用同一个 SQLite 文件。
- 打包时会把 `SILICONFLOW_API_KEY` 写入客户版 AI 镜像。这个做法安全风险较高，只建议用于当前 POC。
- 推荐问题功能默认关闭。如需启用，请在 `.env.customer` 里设置 `NEXT_PUBLIC_ENABLE_RECOMMENDED_QUESTIONS=true`。
