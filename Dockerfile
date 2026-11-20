# The Floor Fifty race server, for one Fly.io Machine (fly.toml).
#
# It is what deploy/bin/build-release stages for the server: `pnpm deploy
# --prod` plus the built dist/, on Node 24. The client is not in the image
# (Ruken serves it). Build from the repository root:
#   fly deploy --build-arg FLOOR_FIFTY_BUILD_ID=<id>
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /repo
COPY . .
# Only the server and the workspace packages it needs, not the client's tooling.
RUN pnpm install --frozen-lockfile --filter "@floor-fifty/server..." --filter .
# The build stamps /health with this (YYYYMMDDHHMM-<7 hex>, as build-release
# makes it). An image without one would report a development build, so it is
# refused.
ARG FLOOR_FIFTY_BUILD_ID
RUN test -n "$FLOOR_FIFTY_BUILD_ID" || { echo "pass --build-arg FLOOR_FIFTY_BUILD_ID=<id>" >&2; exit 1; }
ENV FLOOR_FIFTY_BUILD_ID=$FLOOR_FIFTY_BUILD_ID
RUN pnpm --filter @floor-fifty/server build \
 && pnpm --filter @floor-fifty/server deploy --prod --legacy /out/server \
 && rm -rf /out/server/dist \
 && cp -R apps/server/dist /out/server/dist

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out/server ./
USER node
EXPOSE 3000
# Exec form, so node is PID 1 and gets Fly's SIGTERM; the heap fits the
# 512 MB Machine (fly.toml), leaving room for the rest of the process: with
# a full heap, 384 reached 444 MB resident and 320 peaked at 389 MB. The load
# test's busiest server peaked at 165 MB resident.
CMD ["node", "--max-old-space-size=320", "dist/main.js"]
