FROM sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff
COPY --chown=0:0 --chmod=0444 driver.mjs /opt/eitri/frozen-driver.mjs
COPY --chown=1001:1001 rootfs/ /
USER pwuser
WORKDIR /opt/eitri
ENTRYPOINT ["/usr/local/bin/node", "/opt/eitri/frozen-driver.mjs"]
CMD []
