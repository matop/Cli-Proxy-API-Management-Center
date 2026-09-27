# Controlled releases

This branch starts at upstream v1.24.2. Production releases are built through
`matop/cliproxyapi-release-control` together with a pinned backend and catalogs.
The upstream workflows are disabled in this fork's GitHub Actions settings.

Management keys stay in memory. The UI removes keys persisted by earlier
versions and requires login again after a page reload. Browser password-manager
storage is separate and remains under the user's control.

The production output remains one HTML file. Run `bun run verify` before
publishing a candidate. Do not copy production configurations or credentials
into this repository.
