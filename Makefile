.PHONY: run

NODE_VER := 8.17.0
NODE_DIR := $(CURDIR)/.node
NODE     := $(NODE_DIR)/bin/node

# The first free TCP port from 8000 up. Override with: make run PORT=8080
PORT      ?= $(shell p=8000; while ss -tanH "sport = :$$p" | grep -q .; do p=$$((p+1)); done; echo $$p)

run: package-lock.json
	@(sleep 2; xdg-open http://localhost:$(PORT) >/dev/null 2>&1 || true) &
	PORT=$(PORT) $(NODE) bin/www

package-lock.json: package.json | $(NODE)
	$(NODE_DIR)/bin/npm install

NODE_URL := https://nodejs.org/dist/v$(NODE_VER)/node-v$(NODE_VER)-linux-x64.tar.xz
$(NODE):
	mkdir -p $(NODE_DIR)
	curl -fsSL $(NODE_URL) | tar -xJ -C $(NODE_DIR) --strip-components=1
	$(NODE) --version

.PHONY: clean
clean:
	rm -rf node_modules package-lock.json 
# Writes a synthetic log and a matching part names file to demo/. It holds no machine data.
.PHONY: demo
demo:
	mkdir -p demo
	node -e "require('./libs/DemoLog.js').write('demo')"
