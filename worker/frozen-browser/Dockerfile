FROM eitri-chromium-probe:1.64.1-node26.5.0
COPY --chown=0:0 --chmod=0444 driver.mjs watchdog.mjs scenario.json /opt/eitri/frozen-browser/
COPY --chown=1001:1001 rootfs/ /
USER 1001:1001
WORKDIR /opt/eitri
ENTRYPOINT ["/usr/local/bin/node", "/opt/eitri/frozen-browser/watchdog.mjs"]
CMD []
