FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir --only-binary=:all: --require-hashes -r requirements.lock
COPY decoder/ decoder/
COPY tests/ tests/
USER 65532:65532
ENTRYPOINT ["python", "decoder/inspect_forecast.py"]
