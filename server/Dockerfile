FROM alpine:3.20

ARG PB_VERSION=0.39.8

RUN apk add --no-cache ca-certificates unzip curl \
    && curl -LO https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
    && unzip pocketbase_${PB_VERSION}_linux_amd64.zip -d /pb \
    && rm pocketbase_${PB_VERSION}_linux_amd64.zip \
    && apk del unzip curl

WORKDIR /pb
COPY pb_migrations /pb/pb_migrations

EXPOSE 8090
VOLUME /pb/pb_data

ENTRYPOINT ["/pb/pocketbase"]
CMD ["serve", "--http=0.0.0.0:8090"]
