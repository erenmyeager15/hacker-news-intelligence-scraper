FROM apify/actor-node:20

COPY --chown=myuser package*.json ./
RUN npm --quiet set progress=false && npm ci --include=dev --omit=optional

COPY --chown=myuser . ./
RUN npm run build && npm prune --omit=dev --omit=optional

CMD ["node", "dist/main.js"]
