# worker/sandbox.Dockerfile
FROM node:20-slim
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*