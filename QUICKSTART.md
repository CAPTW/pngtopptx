# Quickstart

1. Download the repository ZIP from GitHub and extract it.
2. Open PowerShell in the extracted folder.
3. Install the toolkit:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force
```

4. Verify the install:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

5. Create a separate deck project and install runtime packages:

```powershell
mkdir deck
cd deck
mkdir src, assets, work, out, lib
npm i pptxgenjs sharp react react-dom react-icons
```

6. Copy slide images into `src/`, then run the renderer scripts from the installed
   toolkit path shown by the installer.

See [README.md](README.md) for a full command example and [INSTALL.md](INSTALL.md)
for custom install paths.
