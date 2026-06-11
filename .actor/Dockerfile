FROM apify/actor-node:20

COPY --chown=myuser package*.json ./
RUN npm --quiet set progress=false && npm install --include=dev --omit=optional

COPY --chown=myuser . ./
RUN npm run build

CMD ["node", "dist/main.js"]
