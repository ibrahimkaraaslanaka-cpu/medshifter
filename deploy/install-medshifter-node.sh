#!/usr/bin/env bash
set -euo pipefail

version=24.22.2
directory=/opt/node-v${version}
archive=node-v${version}-linux-x64.tar.xz
base=https://nodejs.org/dist/v${version}

if [ "$(uname -m)" != x86_64 ]; then
    echo 'This installer expects Linux x86_64' >&2
    exit 1
fi
if [ -e "$directory" ]; then
    echo 'Node runtime directory already exists; refusing to overwrite' >&2
    exit 1
fi

scratch=$(mktemp -d /tmp/medshifter-node.XXXXXXXX)
trap 'rm -rf -- "$scratch"' EXIT
curl --fail --location --retry 3 --silent --show-error "$base/$archive" -o "$scratch/$archive"
curl --fail --location --retry 3 --silent --show-error "$base/SHASUMS256.txt" -o "$scratch/SHASUMS256.txt"
(
    cd "$scratch"
    grep "  $archive$" SHASUMS256.txt | sha256sum --check --status
)
install -d -m 755 "$directory"
tar -xJf "$scratch/$archive" -C "$directory" --strip-components=1
"$directory/bin/node" --version
"$directory/bin/npm" --version
