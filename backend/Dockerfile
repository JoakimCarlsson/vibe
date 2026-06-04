# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS hermesc
WORKDIR /h
RUN npm install --no-save hermes-compiler@250829098.0.10

FROM node:22-bookworm-slim AS jsdeps
WORKDIR /jsdeps
COPY jsdeps/package.json jsdeps/package-lock.json ./
RUN npm ci --omit=dev

FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api

FROM debian:bookworm-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=hermesc /h/node_modules/hermes-compiler/hermesc/linux64-bin/hermesc /usr/local/bin/hermesc
COPY --from=build /out/api /usr/local/bin/api
COPY --from=jsdeps /jsdeps/node_modules /app/jsdeps/node_modules
WORKDIR /app
ENV HERMESC_PATH=hermesc
EXPOSE 1337
ENTRYPOINT ["api"]
