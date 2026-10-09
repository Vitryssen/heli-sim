# Game server for Littlebird Pad Hopper (the web client is deployed separately to GitHub Pages).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY server ./server
RUN npm run build:server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HELI_SERVER_MAIN=1
COPY --from=build /app/server/dist/index.cjs ./index.cjs
EXPOSE 8080
USER node
CMD ["node", "index.cjs"]
