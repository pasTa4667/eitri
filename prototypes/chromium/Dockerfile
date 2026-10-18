FROM node:26.5.0-bookworm@sha256:26512a269d07e691f1af2013dfeb115bbf76933254421729abf48d42c78b64f5 AS node
FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:68456172e8d99f42cf391e835f5d566b3ab0a2c6a745decd9590c4d73c54d2fb
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /opt/eitri
RUN npm install --ignore-scripts --no-audit --no-fund --save-exact playwright@1.64.1 && rm -rf /root/.npm
COPY probe.mjs sandbox-status.mjs namespace_probe.py ./
USER pwuser
ENV HOME=/tmp
ENTRYPOINT ["node", "/opt/eitri/probe.mjs"]
