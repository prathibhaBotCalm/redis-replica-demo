FROM node:18-alpine

# for deps
RUN apk add --no-cache git python3 make g++

WORKDIR /app
COPY . /app

RUN yarn install
RUN yarn build

EXPOSE 3000
CMD ["yarn", "start"]