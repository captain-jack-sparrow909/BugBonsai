# Package managers

Detection prioritizes the `packageManager` field and then lockfiles. npm and pnpm are the primary validated paths. Installs use frozen lockfiles for unchanged candidates and disable lifecycle scripts by default. Dependency mutations use the manager's mutable install mode so the isolated candidate's lockfile is updated, then verify that the selected lockfile still exists.

After installation, BugBonsai snapshots every root and workspace-local `node_modules` directory in its original relative layout. Candidate `node_modules` directories contain package-level links into that private snapshot, while workspace package symlinks are recreated relative to the candidate. This preserves Node ESM sibling resolution without allowing a command to mutate the shared snapshot. Dependency-changing candidates receive a private filesystem copy before their package-manager install.

With `--no-install`, BugBonsai copies existing root and workspace-local dependency trees into the private snapshot instead. Dependency reduction is disabled because manifest changes cannot be verified without a package-manager refresh. The exported reproduction still excludes `node_modules`; use this mode only when recipients can recreate the prepared dependency topology or when the command is dependency-free.

BugBonsai records all detected lockfiles and whether the root uses `package.json` workspaces or `pnpm-workspace.yaml`. When lockfiles from more than one package manager exist, the `packageManager` declaration selects the authoritative manager and a warning is added to diagnostics and reproduction reports. Without that declaration or an explicit `--install-command`, reduction stops rather than making an ambiguous install choice.

Use `--install-command` for project-specific preparation. An explicit command always runs during initial and clean final preparation, including after reduction removes every declared dependency. Use `--allow-install-scripts` only after reviewing dependency scripts. Private registry credentials are not copied into the exported reproduction.

Current conservative boundaries include Yarn Plug'n'Play, Bun-specific workspace layouts, dependency patch files, catalogs, and custom registry authentication. Keep the files these mechanisms require with `--keep` and use a reviewed install command where necessary.
