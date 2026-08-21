FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/app/data/dev.db
WORKDIR /app

RUN groupadd --system app \
    && useradd --system --gid app --home-dir /app app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY routes ./routes
COPY src ./src
COPY views ./views
COPY public ./public
COPY scripts ./scripts
COPY server.js ./server.js
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN ./node_modules/.bin/prisma generate \
    && sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/data /app/uploads \
    && chown -R app:app /app

USER app
EXPOSE 3000
VOLUME ["/app/data", "/app/uploads"]
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
