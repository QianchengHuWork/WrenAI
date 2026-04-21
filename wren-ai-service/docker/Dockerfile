# reference: https://medium.com/@albertazzir/blazing-fast-python-docker-builds-with-poetry-a78a66f5aed0
ARG PYTHON_BUILD_IMAGE=python:3.12.0-bookworm
ARG PYTHON_RUNTIME_IMAGE=python:3.12.0-slim-bookworm

FROM ${PYTHON_BUILD_IMAGE} as builder

RUN pip install poetry==1.8.3

ENV POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=1 \
    POETRY_VIRTUALENVS_CREATE=1 \
    POETRY_CACHE_DIR=/tmp/poetry_cache

WORKDIR /app

COPY pyproject.toml ./

RUN poetry install --without dev,eval,test --no-root && rm -rf $POETRY_CACHE_DIR

FROM ${PYTHON_RUNTIME_IMAGE} as runtime

RUN apt-get update && apt install -y --no-install-recommends netcat-traditional && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

ARG AI_CONFIG_FILE=config.yaml
ARG SILICONFLOW_API_KEY=""

ENV CONFIG_PATH=/app/config.yaml
ENV SILICONFLOW_API_KEY=${SILICONFLOW_API_KEY}

COPY --from=builder ${VIRTUAL_ENV} ${VIRTUAL_ENV}

COPY src ./src
COPY entrypoint.sh ./entrypoint.sh
COPY pyproject.toml ./pyproject.toml
COPY ${AI_CONFIG_FILE} ./config.yaml
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT [ "/app/entrypoint.sh" ]
