#!/usr/bin/env bash
set -euo pipefail

npm run check
npm run plugin:validate
