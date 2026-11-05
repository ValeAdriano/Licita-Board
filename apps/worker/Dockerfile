FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 tesseract-ocr tesseract-ocr-por libreoffice-writer fonts-liberation fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.23 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev
RUN useradd --create-home worker
USER worker
EXPOSE 8000
CMD ["sh", "-c", "uv run --no-sync uvicorn worker.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
