# MedFlow AI backend — used for both the API server and the worker
# (docker-compose overrides the command for the worker).
FROM node:20-alpine

WORKDIR /app

# Install dependencies first so Docker caches this layer between code changes.
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

# Run as a non-root user — a container breakout shouldn't gain root.
RUN addgroup -S medflow && adduser -S medflow -G medflow \
  && mkdir -p /app/uploads && chown -R medflow:medflow /app
USER medflow

EXPOSE 5000

CMD ["node", "src/index.js"]
