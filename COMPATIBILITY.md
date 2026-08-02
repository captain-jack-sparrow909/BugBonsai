# Compatibility

This scoreboard is generated from `compatibility/matrix.json`. “Verified” means the target executes a real reduction in automated tests; narrower evidence is labeled partial or experimental.

Last reviewed: 2026-08-02

## Runtime and operating system

| Target     | Status   | Evidence                                                 |
| ---------- | -------- | -------------------------------------------------------- |
| Node.js 22 | Verified | Corpus and end-to-end tests on Linux, Windows, and macOS |
| Node.js 24 | Verified | Corpus and end-to-end tests on Linux, Windows, and macOS |
| Node.js 26 | Verified | Corpus and end-to-end tests on Linux                     |

## Failure ecosystem

| Target              | Status       | Evidence                                                                        |
| ------------------- | ------------ | ------------------------------------------------------------------------------- |
| Plain Node.js       | Verified     | Compatibility corpus reduction and recipient verification                       |
| TypeScript compiler | Verified     | Real tsc diagnostic in the compatibility corpus                                 |
| Vitest              | Verified     | Real assertion failure in the compatibility corpus                              |
| Vite                | Partial      | Real build failure in end-to-end tests; not yet in every CI corpus job          |
| Jest                | Partial      | Adapter and nested test-structure detection; full installed corpus case pending |
| Next.js             | Experimental | Evidence-based adapter only; external dogfood case pending                      |

## Package manager

| Target | Status       | Evidence                                                               |
| ------ | ------------ | ---------------------------------------------------------------------- |
| npm    | Verified     | Install planning, lockfile validation, and packed-consumer tests       |
| pnpm   | Verified     | Workspace, lockfile, install planning, and CI validation               |
| Yarn   | Experimental | Conservative detection and install command; Plug'n'Play corpus pending |
| Bun    | Experimental | Conservative detection and install command; workspace corpus pending   |

## Status policy

- **Verified:** automated real-command reduction and failure preservation.
- **Partial:** meaningful automated coverage, but an important platform or lifecycle path is missing.
- **Experimental:** detection or conservative planning exists without sufficient real-world reduction evidence.

Run `pnpm compatibility:check` to detect scoreboard drift.
