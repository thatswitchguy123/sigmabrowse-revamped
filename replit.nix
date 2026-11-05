{ pkgs }: {
  deps = [
    pkgs.nodejs_22
    pkgs.chromium

    pkgs.nss
    pkgs.glib
    pkgs.gtk3
    pkgs.pango
    pkgs.cairo
    pkgs.gdk-pixbuf
    pkgs.alsa-lib
    pkgs.atk
    pkgs.at-spi2-atk
    pkgs.libxkbcommon

    pkgs.xorg.libX11
    pkgs.xorg.libXcomposite
    pkgs.xorg.libXdamage
    pkgs.xorg.libXext
    pkgs.xorg.libXfixes
    pkgs.xorg.libXrandr
    pkgs.xorg.libxcb
    pkgs.xorg.libxshmfence

    pkgs.mesa
    pkgs.fontconfig
    pkgs.freetype
  ];
}