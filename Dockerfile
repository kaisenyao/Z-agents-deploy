FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_SYSTEM_PYTHON=1 \
    PORT=2024

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY Z-Framework ./Z-Framework
COPY Z-ResearchAgent ./Z-ResearchAgent
COPY Z-QuantAgent ./Z-QuantAgent
COPY Z-RiskManagementAgent ./Z-RiskManagementAgent
COPY Z-App ./Z-App

RUN uv pip install --system \
        ./Z-Framework \
        ./Z-ResearchAgent \
        ./Z-QuantAgent \
        ./Z-RiskManagementAgent \
        ./Z-App

WORKDIR /app/Z-App

EXPOSE 2024

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/ok" || exit 1

CMD ["sh", "-c", "langgraph dev --host 0.0.0.0 --port ${PORT:-2024} --no-browser --no-reload"]
