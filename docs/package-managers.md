# Package managers

Detection prioritizes the `packageManager` field and then lockfiles. npm and pnpm are the primary v0.1 paths. Installs use frozen lockfiles for unchanged candidates and disable lifecycle scripts by default.

Use `--install-command` for project-specific preparation. Use `--allow-install-scripts` only after reviewing dependency scripts. Private registry credentials are not copied into the exported reproduction.
