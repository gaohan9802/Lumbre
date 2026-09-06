FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

ARG CLAUDE_CODE_VERSION=2.1.236

RUN npm install --global "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  && claude --version

RUN useradd --create-home --uid 10001 ccprobe \
  && mkdir -p /probe/workspace /etc/claude-code \
  && chown -R ccprobe:ccprobe /probe

COPY managed-settings.json /etc/claude-code/managed-settings.json
COPY contract.mjs /opt/lumbre-cc-probe/contract.mjs
COPY process.mjs /opt/lumbre-cc-probe/process.mjs
COPY probe.mjs /opt/lumbre-cc-probe/probe.mjs

ENV DISABLE_AUTOUPDATER=1 \
    DISABLE_UPDATES=1 \
    CC_PROBE_ISOLATED=1 \
    CC_PROBE_WORKSPACE=/probe/workspace

USER ccprobe
WORKDIR /probe/workspace

ENTRYPOINT ["node", "/opt/lumbre-cc-probe/probe.mjs"]
CMD ["inspect"]
