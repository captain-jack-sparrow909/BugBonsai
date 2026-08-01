# Package managers

Detection prioritizes the `packageManager` field and then lockfiles. npm and pnpm are the primary validated paths. Installs use frozen lockfiles for unchanged candidates and disable lifecycle scripts by default. Dependency mutations use the manager's mutable install mode so the isolated candidate's lockfile is updated, then verify that the selected lockfile still exists.

BugBonsai records all detected lockfiles and whether the root uses `package.json` workspaces or `pnpm-workspace.yaml`. When lockfiles from more than one package manager exist, the `packageManager` declaration selects the authoritative manager and a warning is added to diagnostics and reproduction reports. Without that declaration or an explicit `--install-command`, reduction stops rather than making an ambiguous install choice.

Use `--install-command` for project-specific preparation. Use `--allow-install-scripts` only after reviewing dependency scripts. Private registry credentials are not copied into the exported reproduction.

Current conservative boundaries include Yarn Plug'n'Play, Bun-specific workspace layouts, dependency patch files, catalogs, and custom registry authentication. Keep the files these mechanisms require with `--keep` and use a reviewed install command where necessary.
