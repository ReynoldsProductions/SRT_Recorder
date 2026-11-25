# companion-module-c2c-console

Bitfocus Companion (v5, `@companion-module/base` 2.x) module for the Camera2Cloud **C2C Console**: SRT
input monitoring and recording control backed by OvenMediaEngine.

See [companion/HELP.md](companion/HELP.md) for usage.

## Development

Requires Node 26 and Yarn 4 (via corepack).

    yarn install
    yarn build      # tsc -> dist/
    yarn test       # node:test against dist/
    yarn lint
    yarn package    # -> c2c-console-<version>.tgz, import in Companion: Modules → Import module package
