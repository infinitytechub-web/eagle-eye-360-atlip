# Eagle Eye 360 · ATLIP gateway — build from the repository root:
#   docker build -f gateway/Dockerfile -t atlip-gateway .
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY gateway/package.json gateway/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY gateway/src ./src
COPY public/models/atlip-detector-yolo11n.onnx public/models/atlip-state-v2.onnx ./models/
RUN useradd --system --uid 10001 atlip && mkdir -p /app/data && chown -R atlip /app/data
USER atlip
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8090 DATA_DIR=/app/data STREAM_DIR=/app/data/streams MODELS_DIR=/app/models
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8090/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
