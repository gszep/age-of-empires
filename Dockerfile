FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY schemas ./schemas
# vite.config.ts and the typechecked test graph import these three tool modules.
COPY tools/vite-compression.ts tools/vite-watch.ts tools/relic_journey.ts ./tools/
ENV OPEN_CONTENT_ONLY=1
RUN npm run build:public

FROM nginx:1.29-alpine
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV PORT=8080
EXPOSE 8080
