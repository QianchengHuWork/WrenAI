# Customer x86 Linux Deployment Bundle

This directory contains the source-controlled assets used to produce a customer delivery bundle for a single-node Docker Compose deployment.

## What gets built

- `wren-ui`: built from the current branch source
- `wren-ai-service`: built from the current branch source
- `wren-engine`, `ibis-server`, `bootstrap`, `qdrant`: pulled as pinned dependency images and bundled for offline loading

## Prerequisites

### Packaging host

- Docker with `buildx`
- Git
- gzip / tar
- outbound access to the image registries and `https://api.siliconflow.cn`

### Customer host

- Docker
- Docker Compose plugin
- outbound access to `https://api.siliconflow.cn`

The customer host does not need Node.js, Python, Poetry, Yarn, or SQLite installed.

## Package

```bash
cd docker/customer-x86
export SILICONFLOW_API_KEY=your-real-key
./package.sh
```

Generated artifacts are written to `dist/`:

- `images-<git_sha>.tar.gz`
- `source-<git_sha>.tar.gz`
- `images.manifest.txt`
- `checksums.txt`
- `.env.customer`
- `docker-compose.customer.yaml`
- `install.sh`

## Install on the customer host

1. Copy the full `dist/` directory to the target machine.
2. Review `.env.customer` if ports or data paths must change.
3. Run:

```bash
cd dist
./install.sh
```

## Notes

- SQLite is stored inside the UI data directory defined by `CUSTOMER_UI_DATA_DIR`.
- The deployment is single-instance only. Do not run multiple `wren-ui` containers against the same SQLite file.
- The package process bakes `SILICONFLOW_API_KEY` into the customer AI image. This is intentionally high risk and should only be used for the current POC.
