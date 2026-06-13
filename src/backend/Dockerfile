FROM dataelement/bisheng-backend:base.v7

WORKDIR /app

ENV UV_HTTP_TIMEOUT=300 \
    UV_HTTP_RETRIES=5

RUN apt-get update && \
    apt-get install -y --no-install-recommends unixodbc && \
    rm -rf /var/lib/apt/lists/*

COPY ./ ./

# 生成并安装依赖
RUN uv pip compile pyproject.toml --upgrade --output-file requirements.txt && \
    uv pip install -r requirements.txt --system --no-cache-dir && \
    uv cache clean && \
    rm -f requirements.txt


# patch langchain-openai lib. remove this when langchain-openai support reasoning_content
RUN patch -N --batch -p1 < /app/bisheng/patches/langchain_openai.patch /usr/local/lib/python3.10/site-packages/langchain_openai/chat_models/base.py || true


CMD ["sh", "entrypoint.sh"]
