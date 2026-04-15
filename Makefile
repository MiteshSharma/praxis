NVM_INSTALLED := $(shell test -f "$(HOME)/.nvm/nvm.sh"; echo $$?)
NODE_VERSION  := $(shell cat .nvmrc 2>/dev/null || echo 24)
PNPM_VERSION  := 10.33.0
COMPOSE       := docker compose -f docker/docker-compose.dev.yml

# Every target that runs node/pnpm sources nvm and selects the project's node
# version, so you never have to remember `nvm use` yourself.
NVM_EXEC = . $(HOME)/.nvm/nvm.sh && nvm use >/dev/null &&

.DEFAULT_GOAL := help

help:
	@echo "Usage: make [target]"
	@echo ""
	@echo "Setup"
	@echo "  setup              - Install nvm, node ($(NODE_VERSION)), and pnpm ($(PNPM_VERSION))"
	@echo "  setup-nvm          - Install nvm if missing"
	@echo "  setup-node         - Install the node version pinned in .nvmrc"
	@echo "  setup-pnpm         - Install pnpm globally"
	@echo "  prepare            - pnpm install (frozen lockfile)"
	@echo ""
	@echo "Infrastructure (Postgres / Redis / MinIO)"
	@echo "  infra-up           - docker compose up -d --wait"
	@echo "  infra-down         - docker compose down"
	@echo "  infra-reset        - docker compose down -v (wipes volumes)"
	@echo "  infra-logs         - Tail infra logs"
	@echo "  infra-ps           - Show container status"
	@echo ""
	@echo "Development"
	@echo "  dev                - Run web + backend (MODE=all) + sandbox-worker with hot reload"
	@echo "  dev-backend        - Run backend only (MODE=all)"
	@echo "  dev-sandbox-worker - Run sandbox-worker only"
	@echo "  dev-web            - Run the vite dev server only"
	@echo "  up                 - infra-up + dev (full local stack)"
	@echo ""
	@echo "Quality"
	@echo "  typecheck          - tsc --noEmit across the workspace"
	@echo "  lint               - biome check"
	@echo "  format             - biome format --write"
	@echo "  smoke              - Run scripts/smoke.ts against a running stack"
	@echo ""
	@echo "Housekeeping"
	@echo "  clean              - Remove node_modules, dist, and build caches"
	@echo "  help               - Print this help"

# ---------- setup ----------

setup: setup-nvm setup-node setup-pnpm
	@echo "Setup complete. Next: make prepare && make up"

setup-nvm:
	@echo "Checking if nvm is installed..."
	@if [ $(NVM_INSTALLED) -eq 0 ]; then \
		echo "  nvm already installed."; \
	else \
		echo "  installing nvm..."; \
		curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash; \
	fi

setup-node:
	@echo "Installing node $(NODE_VERSION) via nvm..."
	@. $(HOME)/.nvm/nvm.sh && nvm install $(NODE_VERSION) && nvm use $(NODE_VERSION)
	@echo "Node setup complete."

setup-pnpm:
	@echo "Installing pnpm@$(PNPM_VERSION)..."
	@. $(HOME)/.nvm/nvm.sh && nvm use >/dev/null && npm install -g pnpm@$(PNPM_VERSION)
	@echo "pnpm setup complete."

prepare:
	@echo "Installing dependencies..."
	@$(NVM_EXEC) pnpm install --frozen-lockfile
	@echo "Dependencies installed."

# ---------- infrastructure ----------

infra-up:
	@echo "Starting postgres / redis / minio..."
	@$(COMPOSE) up -d --wait
	@$(COMPOSE) ps

infra-down:
	@$(COMPOSE) down

infra-reset:
	@echo "Tearing down infra and wiping volumes..."
	@$(COMPOSE) down -v

infra-logs:
	@$(COMPOSE) logs -f --tail=100

infra-ps:
	@$(COMPOSE) ps

# ---------- dev ----------

dev:
	@$(NVM_EXEC) pnpm dev

dev-backend:
	@$(NVM_EXEC) pnpm dev:backend

dev-sandbox-worker:
	@$(NVM_EXEC) pnpm dev:sandbox-worker

dev-web:
	@$(NVM_EXEC) pnpm dev:web

up: infra-up dev

# ---------- quality ----------

typecheck:
	@$(NVM_EXEC) pnpm typecheck

lint:
	@$(NVM_EXEC) pnpm lint

format:
	@$(NVM_EXEC) pnpm format

smoke:
	@$(NVM_EXEC) pnpm smoke

# ---------- housekeeping ----------

clean:
	@echo "Cleaning node_modules and build output..."
	@rm -rf node_modules
	@rm -rf services/*/dist shared/*/dist
	@rm -rf services/web/.vite
	@echo "Clean complete."

.PHONY: help setup setup-nvm setup-node setup-pnpm prepare \
        infra-up infra-down infra-reset infra-logs infra-ps \
        dev dev-backend dev-sandbox-worker dev-web up \
        typecheck lint format smoke clean
