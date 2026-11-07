# PROJECT-session image: openvscode-server + the OpenCode runtime + an OpenCode
# sidebar (webview) extension. Used for kind=PROJECT sessions so the candidate
# drives OpenCode from inside VS Code (like the Codex / Claude Code extensions).
# CODING sessions run in-browser Monaco and never use this image.
#
# Build:
#   docker build -f apps/vscode-orchestrator/project.Dockerfile \
#     -t aisd/openvscode-opencode:latest .
#
# The sidebar extension is installed by id from the Open VSX registry (which
# openvscode-server uses by default). Swap OPENCODE_EXT_ID to try a different
# published OpenCode chat/sidebar extension without touching anything else, e.g.
#   Pacoaldev.opencode-mcp-vscode  - "chat sidebar connected to local OpenCode"
#   YasirArafat.opencode-ai-chat   - "full-featured chat UI for OpenCode"
#   haoyangzeng.opencui            - "OpenCode Panel: React chat UI"
FROM gitpod/openvscode-server:1.102.3

USER root

# curl/ca-certificates to fetch the OpenCode runtime installer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# OpenCode runtime (standalone binary - no Node needed). The installer's target
# path varies by version, so locate the binary and copy it onto a world-readable
# PATH location; /root is not traversable by the uid-1000 server user.
RUN curl -fsSL https://opencode.ai/install | bash \
 && OPENCODE_BIN="$(find /root /usr/local /home /opt -type f -name opencode -perm -u+x 2>/dev/null | head -1)" \
 && echo "Resolved opencode binary: ${OPENCODE_BIN}" \
 && test -n "${OPENCODE_BIN}" \
 && cp "${OPENCODE_BIN}" /usr/local/bin/opencode \
 && chmod a+rx /usr/local/bin/opencode \
 && opencode --version

# Install the published OpenCode sidebar extension from Open VSX into the server
# user's default extensions dir (auto-loaded on launch). Done as that user so
# ownership/permissions are correct.
ARG OPENCODE_EXT_ID=Pacoaldev.opencode-mcp-vscode
USER openvscode-server
RUN "${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server" --install-extension "${OPENCODE_EXT_ID}" \
 && ls "${HOME}/.openvscode-server/extensions"

# The extension declares no activationEvents, so it activates only when its view
# is first opened - and in the openvscode-server web workbench a lazily-loaded
# view container can fail to surface its activity-bar icon. Force eager
# activation so the extension loads, registers its sidebar view + webview
# provider, and shows its icon as soon as the workbench opens.
RUN d="$(ls -d ${HOME}/.openvscode-server/extensions/pacoaldev.opencode-mcp-vscode-* | head -1)" \
 && grep -q '"activationEvents"' "$d/package.json" \
    || sed -i 's#\("main": "./out/extension.js",\)#\1\n\t"activationEvents": ["onStartupFinished"],#' "$d/package.json" \
 && grep -n '"activationEvents"' "$d/package.json"

# Ensure the server user owns its whole home - build steps (opencode install, the
# extension install) can leave root-owned dirs (e.g. /home/workspace/.cache) that
# would otherwise cause EACCES at runtime for the uid-1000 server.
# Pre-create the pinned --user-data-dir (…/data/User) so the orchestrator can seed
# User/settings.json into it (where workbench.colorTheme actually applies) and the
# server can write its own state there at boot without an EACCES on a root dir.
USER root
RUN mkdir -p /home/workspace/.openvscode-server/data/User \
 && chown -R openvscode-server:openvscode-server /home/workspace
USER openvscode-server
