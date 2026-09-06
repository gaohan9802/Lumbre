FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

ARG CLAUDE_CODE_VERSION=2.1.236

RUN npm install --global "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  && claude --version

RUN useradd --create-home --uid 10001 ccgateway \
  && mkdir -p /gateway-data /gateway-workspace /etc/claude-code /opt/lumbre/services/cc-probe /opt/lumbre/services/cc-gateway \
  && chown -R ccgateway:ccgateway /gateway-data /gateway-workspace

COPY cc-probe/managed-settings.json /etc/claude-code/managed-settings.json
COPY cc-probe/contract.mjs /opt/lumbre/services/cc-probe/contract.mjs
COPY cc-gateway/*.mjs /opt/lumbre/services/cc-gateway/

ENV DISABLE_AUTOUPDATER=1 \
    DISABLE_UPDATES=1 \
    CC_GATEWAY_ISOLATED=1 \
    CC_GATEWAY_DATA_DIR=/gateway-data \
    CC_GATEWAY_CLAUDE_HOME=/gateway-data/claude-home \
    CC_GATEWAY_REHYDRATE_TURNS=16 \
    CC_GATEWAY_WORKSPACE=/gateway-workspace \
    PORT=8787

USER ccgateway
WORKDIR /gateway-workspace
VOLUME ["/gateway-data"]
EXPOSE 8787

ENTRYPOINT ["node", "/opt/lumbre/services/cc-gateway/server.mjs"]
