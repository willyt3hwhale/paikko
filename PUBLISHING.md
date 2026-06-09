# Publishing the paikko packages

Two packages are published to npm under the `@paikko` scope:

| Package | What ships | Notes |
|---------|-----------|-------|
| `@paikko/contract` | compiled `dist/` (ESM + types) | built by its `prepare` script (`tsc`) |
| `@paikko/widget` | raw `src/` TS/TSX + the provenance plugin | consumers transpile it (`transpilePackages`) |

`@paikko/widget` depends on `@paikko/contract` (`^0.1.0`), so **contract must be published first**.

## One-time setup

1. An npm account that can publish public scoped packages.
2. Create the `@paikko` org (or user scope) on npm - scoped packages need the scope to exist:
   - https://www.npmjs.com/org/create  (free for public packages), or publish under your user scope.
3. Authenticate locally:
   ```bash
   npm login
   npm whoami   # confirms you're authed
   ```

Both manifests already set `"publishConfig": { "access": "public" }`, so no `--access public` flag is needed.

## Publish (run from the repo root)

```bash
# 1. contract first (widget depends on it)
npm publish -w @paikko/contract

# 2. then the widget
npm publish -w @paikko/widget
```

That's it. The contract `prepare` script builds `dist/` automatically before packing.

## Verify before you publish (optional, no auth needed)

```bash
# what each tarball will contain + size
npm publish -w @paikko/contract --dry-run
npm publish -w @paikko/widget   --dry-run

# pack real tarballs and install them into a throwaway consumer
npm pack -w @paikko/contract --pack-destination /tmp
npm pack -w @paikko/widget   --pack-destination /tmp
mkdir /tmp/t && cd /tmp/t && npm init -y
npm install react /tmp/paikko-contract-*.tgz /tmp/paikko-widget-*.tgz
node --input-type=module -e "import('@paikko/contract').then(c=>console.log(Object.keys(c).length,'exports'))"
node -e "console.log(require.resolve('@paikko/widget/build/provenancePlugin'))"
```

## After the first publish

Point the example at the published versions instead of the workspace link to prove the
real install path (optional but recommended):

```jsonc
// examples/calculator/package.json
"@paikko/widget": "^0.1.0",
"@paikko/contract": "^0.1.0"
```

## Cutting a new version

Bump both packages together (they move in lockstep for now):

```bash
npm version patch -w @paikko/contract -w @paikko/widget   # or minor / major
# commit the version bump, then publish in the same order (contract, then widget)
```

Keep the two versions in sync and bump `@paikko/widget`'s `@paikko/contract`
dependency range if the contract gets a breaking (major) change.
