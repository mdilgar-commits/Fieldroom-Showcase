FROM node:22-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.mjs ./
COPY public ./public

USER node
EXPOSE 8080
CMD ["npm", "start"]
