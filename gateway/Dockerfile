FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY .npmrc ./

RUN npm install

COPY . .

RUN npm run build

RUN npm prune --omit=dev

EXPOSE 4000

CMD ["node", "dist/index.js"]
