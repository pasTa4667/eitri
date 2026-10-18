FROM eitri-chromium-probe:1.64.1-node26.5.0
COPY --chown=0:0 --chmod=0444 driver.mjs /opt/eitri/frozen-browser/driver.mjs
COPY --chown=0:0 --chmod=0444 watchdog.mjs /opt/eitri/frozen-browser/watchdog.mjs
COPY --chown=0:0 --chmod=0444 scenario.json /opt/eitri/frozen-browser/scenario.json
COPY --chown=1001:1001 rootfs/ /
USER 1001:1001
WORKDIR /opt/eitri
ENTRYPOINT ["/usr/local/bin/node", "/opt/eitri/frozen-browser/watchdog.mjs"]
CMD []
