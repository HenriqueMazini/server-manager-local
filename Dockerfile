# syntax=docker/dockerfile:1

FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
COPY VERSION /src/VERSION
RUN npm run build

FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /server-manager .

FROM alpine:3.22
RUN adduser -D -u 1000 app
COPY --from=build /server-manager /server-manager
USER app
EXPOSE 9090
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:9090/healthz >/dev/null || exit 1
ENTRYPOINT ["/server-manager"]
