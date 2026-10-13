#!/usr/bin/env bash
set -euo pipefail
: "${YARD_IMAGE_REGISTRY:?Set YARD_IMAGE_REGISTRY}"
: "${YARD_RELEASE:?Set a release tag or commit SHA}"
build_args=()
if [[ -n "${YARD_BUILD_CA_BUNDLE:-}" ]]; then
  build_args+=(--secret "id=build_ca_bundle,src=$YARD_BUILD_CA_BUNDLE")
fi
for item in server:yard-api migration:yard-migration hrms-web:yard-hrms-web license-admin-web:yard-license-admin-web; do
  target=${item%%:*}
  name=${item#*:}
  docker build "${build_args[@]}" --file infra/docker/Dockerfile --target "$target" --tag "$YARD_IMAGE_REGISTRY/$name:$YARD_RELEASE" .
done
