# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS hermesc
WORKDIR /h
RUN npm install --no-save hermes-compiler@250829098.0.10

FROM node:22-bookworm-slim AS jsdeps
WORKDIR /jsdeps
COPY jsdeps/package.json jsdeps/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS typedeps
WORKDIR /typedeps
COPY typedeps/package.json typedeps/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api

# Node base (not debian-slim) so tsc is available for the typecheck pass; the
# bookworm base still carries libstdc++6 for the hermesc binary.
FROM node:22-bookworm-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm install -g typescript@6 \
	&& npm cache clean --force
COPY --from=hermesc /h/node_modules/hermes-compiler/hermesc/linux64-bin/hermesc /usr/local/bin/hermesc
COPY --from=build /out/api /usr/local/bin/api
COPY --from=jsdeps /jsdeps/node_modules /app/jsdeps/node_modules
COPY --from=typedeps /typedeps/node_modules /app/typedeps/node_modules
WORKDIR /app
ENV HERMESC_PATH=hermesc
EXPOSE 1337
ENTRYPOINT ["api"]
