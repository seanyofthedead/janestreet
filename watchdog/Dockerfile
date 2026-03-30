FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
# Copy workspace package.json files
COPY watchdog/package.json watchdog/
COPY trading-core-js/ trading-core-js/
RUN npm ci --workspace=watchdog
COPY watchdog/ watchdog/
COPY tsconfig.base.json ./
CMD ["npx", "tsx", "watchdog/src/main.ts"]
