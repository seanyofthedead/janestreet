FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
# Copy workspace package.json files
COPY engine/package.json engine/
COPY trading-core-js/ trading-core-js/
RUN npm ci --workspace=engine
COPY engine/ engine/
COPY tsconfig.base.json ./
CMD ["npx", "tsx", "engine/src/main.ts"]
