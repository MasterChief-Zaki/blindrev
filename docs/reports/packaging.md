# Desktop packaging — Tauri v2 (agent S)

Status: **unsigned** builds only. Code signing and the signed auto-updater need secrets this
repo does not have, so they are **not enabled**. This file is the exact procedure to turn them on.

## What exists today

| Item           | Where                                                               | Notes                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tauri v2 shell | `packages/app-shell/src-tauri/`                                     | crate/binary `blindrev`, lib `blindrev_lib`                                                                                                                         |
| Config         | `src-tauri/tauri.conf.json`                                         | productName `BlindRev`, identifier `bureau.blindrev.app`, window 1600×900 (min 1280×720)                                                                            |
| Frontend       | `devUrl` `http://localhost:5173`, `frontendDist` `../dist`          | `beforeDevCommand` `pnpm run dev`, `beforeBuildCommand` `pnpm exec vite build` (cwd = `packages/app-shell`)                                                         |
| WebView2       | `bundle.windows.webviewInstallMode = downloadBootstrapper (silent)` | Evergreen bootstrapper, downloaded by the installer only if WebView2 is missing                                                                                     |
| Installer      | NSIS, `installMode: currentUser`                                    | no admin prompt                                                                                                                                                     |
| Diagnostics    | `tauri-plugin-log`, **opt-in**                                      | `BLINDREV_DIAGNOSTICS=1` or `blindrev.exe --diagnostics` → `%LOCALAPPDATA%\bureau.blindrev.app\logs\blindrev.log`, 5 MB per file, `KeepOne` rotation, panics logged |
| Icons          | `src-tauri/icons/*` from `src-tauri/app-icon.png`                   | regenerate: `node tools/make-icon.mjs && pnpm --filter @blindrev/app-shell tauri icon src-tauri/app-icon.png` (then delete `icons/android`, `icons/ios`)            |

Commands (repo root):

```
pnpm desktop            # tauri dev  (starts vite on 5173, opens the window)
pnpm desktop:build      # tauri build --no-bundle  → src-tauri/target/release/blindrev.exe
pnpm desktop:bundle     # tauri build              → src-tauri/target/release/bundle/nsis/BlindRev_<ver>_x64-setup.exe
```

`desktop:build` skips the bundler on purpose: on this dev machine the bundler step can shell out to
PowerShell, which hangs (Defender AMSI fault). CI (`windows-smoke` job) runs `desktop:bundle` on a
clean GitHub runner.

## 1. Authenticode signing (Windows)

1. Obtain an **OV or EV code-signing certificate** (EV gets immediate SmartScreen reputation; OV
   needs warm-up, see §2). Since June 2023 private keys must live on an HSM/token, so use either a
   cloud HSM (Azure Trusted Signing, DigiCert KeyLocker, SSL.com eSigner) or a hardware token.
2. **Azure Trusted Signing** (cheapest path; recommended):
   - Create a Trusted Signing account + certificate profile in Azure; give the CI service principal
     the _Trusted Signing Certificate Profile Signer_ role.
   - Install the signing client on the runner: `dotnet tool install --global --version 0.9.* sign`
     (or `trusted-signing-cli`).
   - In `tauri.conf.json` → `bundle.windows`:

     ```json
     "signCommand": "trusted-signing-cli -e https://<region>.codesigning.azure.net -a <account> -c <profile> -d BlindRev %1"
     ```
   - CI secrets: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` (exported as env in the
     `windows-smoke` job before `pnpm desktop:bundle`).
3. **PFX / token with signtool** (alternative):

   ```json
   "bundle": { "windows": {
     "certificateThumbprint": "<SHA1 thumbprint of the cert in the CurrentUser\\My store>",
     "digestAlgorithm": "sha256",
     "timestampUrl": "http://timestamp.digicert.com"
   } }
   ```

   In CI, import the PFX from a base64 secret (`WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`)
   into `Cert:\CurrentUser\My` before building. Always timestamp, or signatures die with the cert.
4. Verify: `signtool verify /pa /v BlindRev_0.1.0_x64-setup.exe` and check that `blindrev.exe` inside
   the install directory is signed too (Tauri signs both the binary and the installer).

## 2. SmartScreen reputation warm-up

- New OV certificates (and every unsigned build) show _"Windows protected your PC"_ until the
  certificate/file hash accrues reputation. There is no switch to skip this.
- Warm-up procedure: sign every release with the **same** certificate; publish through one stable
  download URL; submit each release to Microsoft (<https://www.microsoft.com/wdsi/filesubmission>,
  "software developer" → "incorrectly detected"); expect days to weeks of organic downloads.
- EV certificates and Azure Trusted Signing (Microsoft-issued) reach reputation much faster.
- Until then, the README must tell players: _More info → Run anyway_.

## 3. Signed auto-updater (tauri-plugin-updater)

Not added: the updater refuses to run without a public key, and the private key must stay secret.

1. Generate the updater keypair (once, offline):

   ```
   pnpm --filter @blindrev/app-shell tauri signer generate -w ~/.tauri/blindrev-updater.key
   ```

   Keep the private key + password in a password manager. Store them as CI secrets
   `TAURI_SIGNING_PRIVATE_KEY` (file contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   **Losing the private key means existing installs can never update again.**
2. Add the plugin:

   ```
   cd packages/app-shell/src-tauri && cargo add tauri-plugin-updater --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'
   pnpm --filter @blindrev/app-shell add @tauri-apps/plugin-updater
   ```

   In `src/lib.rs`: `.plugin(tauri_plugin_updater::Builder::new().build())`.
   In `capabilities/default.json` add `"updater:default"`.
3. `tauri.conf.json`:

   ```json
   "bundle": { "createUpdaterArtifacts": true },
   "plugins": { "updater": {
     "pubkey": "<contents of blindrev-updater.key.pub>",
     "endpoints": ["https://<release-host>/blindrev/latest.json"],
     "windows": { "installMode": "passive" }
   } }
   ```
4. CSP: add the update endpoint host to `connect-src` (the updater check runs in Rust, but any
   frontend "check for updates" fetch of release notes needs it) — update the CSP matrix row.
5. Release: `pnpm desktop:bundle` with the two `TAURI_SIGNING_*` env vars set produces
   `*-setup.exe` + `*-setup.exe.sig`; publish `latest.json`
   (`{ version, notes, pub_date, platforms: { "windows-x86_64": { signature, url } } }`).
6. Sign the installer with Authenticode **before** the updater signature is computed (Tauri does this
   in the right order when both are configured).

## 4. CSP shipped in `tauri.conf.json`

SPEC §13 baseline, plus only what Tauri needs:

- `connect-src` + `ipc: http://ipc.localhost` — Tauri v2 IPC transport (custom protocol on
  macOS/Linux, `http://ipc.localhost` on Windows/WebView2).
- `"dangerousDisableAssetCspModification": ["style-src"]` — Tauri otherwise appends nonces/hashes to
  `style-src`, which makes browsers ignore the baseline's `'unsafe-inline'` (CSP3) and breaks
  inline styles. `script-src` modification stays on (Tauri hashes its own init scripts).
- Candidates **not** added (add only after testing, per the CSP matrix): `'wasm-unsafe-eval'` in
  `script-src` if Draco/KTX2/Basis WASM decoders are used (Cesium 3D Tiles, three.js loaders);
  `data:` in `connect-src` if a loader fetches data URIs; `font-src` is covered by `default-src 'self'`
  (fonts are bundled by Vite).
