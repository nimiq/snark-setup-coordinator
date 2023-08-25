FROM node:18-alpine as base

ENV NPM_CONFIG_LOGLEVEL info

# @celo/utils has dependencies in github
# @nimiq/core needs python3 make gcc g++
RUN apk update && apk upgrade && \
    apk add --no-cache git python3 make gcc g++

WORKDIR /app
COPY package*.json ./
RUN npm ci

# Copy app
COPY . .

RUN npm run build

FROM node:18-alpine

# Ensure we only install dependencies (not devDependencies too)
ENV NODE_ENV production
ENV NPM_CONFIG_LOGLEVEL info

# @celo/utils has dependencies in github
# @nimiq/core needs python3 make gcc g++
RUN apk update && apk upgrade && \
    apk add --no-cache git python3 make gcc g++

WORKDIR /app
COPY package*.json ./
RUN npm ci

# Copy build files
COPY --from=base /app/dist ./dist
COPY ceremony ceremony

CMD ["npm", "start"]
