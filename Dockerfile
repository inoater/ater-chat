FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public

# without MONGODB_URI, chat data lives in a volume so it survives new images
RUN mkdir -p /data && chown node:node /data
VOLUME /data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    ATER_DATA=/data/ater-data.json

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/index.js"]
