# Install

Use [QUICKSTART.md](QUICKSTART.md) if you want the shortest non-developer path:
download ZIP, extract, open PowerShell, run one command, restart Codex.

This page gives the same installation steps plus advanced options.

## Recommended Install

Open PowerShell in the extracted repository folder, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force -InstallAgents
```

This is the safest default for most people:

- `-BackupExisting` saves old installed Skill folders before replacing them.
- `-Force` allows the installer to replace existing folders after backup.
- `-InstallAgents` installs optional Codex agent templates used by the workflow.
- `-ExecutionPolicy Bypass` avoids Windows blocking this one local installer run.

After installation, restart Codex Desktop/App so the Skill registry reloads.

Then verify:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

Successful install means the verifier ends with:

```text
Failures: 0
```

## Where It Installs

By default, the installer copies Skills into:

```text
%USERPROFILE%\.codex\skills
```

That is the local Codex Skill path used by this package.

The four installed Skills are:

- `slide-text-layer-inpaint`
- `slide-image-dual-render`
- `slide-visual-polish-qa`
- `slide-editable-deck-orchestrator`

## Minimal Install

Use this only when you are sure no old copies need to be backed up:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

## Advanced: Official User Skills Path

Some environments use the newer user Skills path:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -UseAgentsSkillsPath
```

## Advanced: Custom Target

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -TargetRoot "C:\Users\you\.codex\skills"
```

## Updating An Existing Install

Download the newest ZIP, extract it, open PowerShell in the new folder, and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force -InstallAgents
```

The installer creates backups before replacing existing Skill folders.

## Agent Templates Only

If the Skills are already installed and you only want to install agent templates,
you can still run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallAgents
```

## First Test Prompt

After restarting Codex, try:

```text
Use $slide-editable-deck-orchestrator.
Check that the pngtopptx editable PPTX SkillSet is available.
```

For an actual conversion, upload a slide image and ask:

```text
Use $slide-editable-deck-orchestrator.
Convert this slide image into an editable PPTX. Put the result in my Downloads folder.
```

## Troubleshooting

### PowerShell Says Script Execution Is Disabled

Run the command with `-ExecutionPolicy Bypass`, exactly like this:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force -InstallAgents
```

### Installer Refuses To Overwrite Existing Skills

Use backup plus force:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force -InstallAgents
```

### Codex Still Does Not Show The Skills

Restart Codex. If that does not work, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

Confirm that the Skill folders exist under:

```text
%USERPROFILE%\.codex\skills
```

### Conversion Dependencies Are Missing

The installer only copies the Codex Skills. Real conversion jobs may need Node.js,
Python packages, PowerPoint, Chrome/Edge, or LibreOffice depending on the task.
Run `verify_install.ps1`; missing optional tools are reported clearly.
