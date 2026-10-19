.PHONY: install dev test build preview desktop desktop-package clean

install:
	npm ci

dev:
	npm run dev -- --host 0.0.0.0

test:
	npm run check

build:
	npm run build

preview:
	npm run preview -- --host 0.0.0.0

desktop:
	npm run desktop

desktop-package:
	npm run desktop:package

clean:
	rm -rf dist coverage
