#!/bin/sh

set -eu

cd "$(dirname "$0")/.."

cargo build --release --locked --bins --package saq
sudo install -Dm755 target/release/saq target/release/saqctl target/release/saqd -t /usr/bin
sudo install -Dm644 res/saq.desktop /usr/share/applications/saq.desktop
sudo install -Dm644 res/saq.service /usr/lib/systemd/user/saq.service
sudo install -Dm644 res/saq.svg /usr/share/icons/hicolor/scalable/apps/saq.svg
sudo install -Dm644 LICENSE /usr/share/licenses/saq/LICENSE

if systemctl --user cat saqd.service >/dev/null 2>&1; then
    systemctl --user disable --now saqd.service
fi
sudo rm -f /usr/lib/systemd/user/saqd.service

systemctl --user daemon-reload
systemctl --user enable saq.service
systemctl --user restart saq.service

printf '%s\n' 'Śaq is running. Control it via the GUI or CLI controller.'
