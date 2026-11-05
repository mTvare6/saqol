#!/bin/sh

set -eu

if [ "$#" -lt 2 ]; then
  echo "usage: $0 ROOT PREFIX [LICENSE_DIR]" >&2
  exit 2
fi

root=$1
prefix=$2
license_dir=${3:-saq}

install -Dm755 target/release/saq target/release/saqctl target/release/saqd \
  -t "$root$prefix/bin"
install -Dm644 res/saq.desktop "$root$prefix/share/applications/saq.desktop"
install -Dm644 res/saq.service "$root$prefix/lib/systemd/user/saq.service"
install -Dm644 res/saq.svg "$root$prefix/share/icons/hicolor/scalable/apps/saq.svg"
install -Dm644 LICENSE "$root$prefix/share/licenses/$license_dir/LICENSE"
