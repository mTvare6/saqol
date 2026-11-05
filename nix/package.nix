{
  lib,
  libglvnd,
  libx11,
  libxcursor,
  libxi,
  libxkbcommon,
  libxrandr,
  pipewire,
  pkg-config,
  rustPlatform,
  wayland,
}:

rustPlatform.buildRustPackage {
  pname = "saq";
  version = (builtins.fromTOML (builtins.readFile ../Cargo.toml)).package.version;

  src = lib.cleanSourceWith {
    src = ./..;
    filter =
      path: type:
      let
        baseName = baseNameOf path;
      in
      !(
        (type == "directory" && builtins.elem baseName [
          ".git"
          "result"
          "target"
        ])
        || (type == "symlink" && baseName == "result")
      );
  };

  cargoLock = {
    lockFile = ../Cargo.lock;
    outputHashes = {
      "pipewire-0.10.1" = "sha256-r/bp8lhTC1/JNCcs5fiEsg65W7bjFFsiwwjqKV7lUWU=";
    };
  };

  nativeBuildInputs = [
    pkg-config
    rustPlatform.bindgenHook
  ];

  buildInputs = [
    libglvnd
    libx11
    libxcursor
    libxi
    libxkbcommon
    libxrandr
    pipewire
    wayland
  ];

  cargoBuildFlags = [
    "--package"
    "saq"
    "--bins"
  ];
  cargoTestFlags = [ "--workspace" ];

  postInstall = ''
    install -Dm644 res/saq.desktop \
      "$out/share/applications/saq.desktop"
    install -Dm644 res/saq.service \
      "$out/lib/systemd/user/saq.service"
    install -Dm644 res/saq.svg \
      "$out/share/icons/hicolor/scalable/apps/saq.svg"
    install -Dm644 LICENSE "$out/share/licenses/saq/LICENSE"

    substituteInPlace "$out/share/applications/saq.desktop" \
      --replace-fail "/usr/bin/saq" "$out/bin/saq"
    substituteInPlace "$out/lib/systemd/user/saq.service" \
      --replace-fail "ExecStart=/usr/bin/saqd" "ExecStart=$out/bin/saqd"
  '';

  meta = {
    description = "Real-time easy-to-use audio enhancer for Linux";
    homepage = "https://github.com/mTvare6/saqol";
    license = lib.licenses.mpl20;
    mainProgram = "saq";
    platforms = lib.platforms.linux;
  };
}
