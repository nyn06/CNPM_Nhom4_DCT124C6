FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public/index.html ./public/index.html
COPY public/css ./public/css
COPY public/js ./public/js

EXPOSE 3000

CMD ["node", "src/server.js"]
