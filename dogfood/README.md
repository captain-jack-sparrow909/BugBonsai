# External dogfooding

Dogfood cases point at local checkouts of public open-source projects. BugBonsai
does not clone, upload, or redistribute those projects. A descriptor records the
exact upstream commit and license while the generated observation contains only
aggregate metrics and a normalized failure hash. The runner rejects a mismatched
origin, commit, or dirty working tree before executing anything.

1. Fork or clone a public project and check out the exact failing commit.
2. Install its dependencies using the project’s documented process.
3. Copy `example.case.json` without committing your local path.
4. Run:

   ```bash
   pnpm dogfood -- --case /tmp/project.case.json --output /tmp/observation.json
   ```

5. Review the observation before sharing it. Do not commit the reproduction,
   command output, local paths, secrets, or third-party source.

Only observations for failures already public upstream should be proposed for
the compatibility scoreboard. Get maintainer permission before using a private
or embargoed security issue, even locally.
