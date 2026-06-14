FROM oven/bun:1.3.14 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src

RUN bun run build

FROM oven/bun:1.3.14 AS runtime

WORKDIR /app

RUN groupadd --system --gid 1001 appgroup && \
  useradd --system --uid 1001 --gid appgroup appuser

COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock
COPY --from=build /app/node_modules ./node_modules

RUN chown -R appuser:appgroup /app /tmp

USER appuser

ARG GIT_COMMIT_SHA=development
ARG BUILD_TIME

ENV BUILD_TIME=$BUILD_TIME
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "/app/dist/api/index.js"]
