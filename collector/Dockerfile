FROM node:24.19.0-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

COPY --chown=node:node package.json index.js ./

RUN mkdir frames && chown node:node frames

USER node

CMD ["node", "index.js"]
