# Monsieur Flop : le jeu de pronostics de la présidentielle 2027.
# Image : PocketBase (serveur, base de données, comptes) + le code du jeu.
# Plateformes prises en charge : linux/amd64, linux/arm64, linux/arm/v7.

ARG ALPINE_VERSION=3.20

# ---------- Étape 1 : récupérer PocketBase et vérifier son empreinte ----------
FROM alpine:${ALPINE_VERSION} AS pocketbase
ARG PB_VERSION=0.40.6
ARG TARGETARCH
ARG TARGETVARIANT
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}${TARGETVARIANT}.zip /tmp/pocketbase.zip
RUN set -eu; \
    case "${TARGETARCH}${TARGETVARIANT}" in \
      amd64) SHA="0e1f609158ed945f809f8a02ae012aa0427129c66ebb63c1aee76f2c0309373f" ;; \
      arm64) SHA="d22c66ceb67ca92b7d767f36d826e848a276bcfa3c197ead20bf87c42208984f" ;; \
      armv7) SHA="33f1145b80531df8ecca8f6d90387f6f661e1169e313689fbb070d5ee21621c0" ;; \
      *) echo "Architecture non prise en charge : ${TARGETARCH}${TARGETVARIANT}" >&2; exit 1 ;; \
    esac; \
    echo "${SHA}  /tmp/pocketbase.zip" | sha256sum -c -; \
    mkdir -p /pb; \
    unzip -q /tmp/pocketbase.zip pocketbase -d /pb; \
    chmod 0755 /pb/pocketbase

# ---------- Étape 2 : l'image finale ----------
FROM alpine:${ALPINE_VERSION}
LABEL org.opencontainers.image.title="Monsieur Flop" \
      org.opencontainers.image.description="Jeu de pronostics entre amis sur la présidentielle 2027"

RUN addgroup -S -g 10001 flop \
 && adduser -S -D -H -u 10001 -G flop -h /pb flop

WORKDIR /pb
COPY --from=pocketbase /pb/pocketbase /pb/pocketbase
COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks
COPY pb_public /pb/pb_public
COPY perso /pb/pb_public/perso

# pb_data contient la base, les comptes, les paris et les sauvegardes : c'est le seul dossier à conserver.
RUN mkdir -p /pb/pb_data && chown -R flop:flop /pb/pb_data
USER flop

EXPOSE 8090
VOLUME ["/pb/pb_data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8090/api/health || exit 1

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090"]
