# Install

Install into the legacy Codex local Skill path:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Install into the official user Skills path:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -UseAgentsSkillsPath
```

Install into a custom target:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -TargetRoot "C:\Users\you\.codex\skills"
```

If existing Skill folders are present, the installer refuses to overwrite them unless `-Force` is used. To preserve old folders first:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force
```

Install agent templates as well:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallAgents
```

After install, restart Codex Desktop/App so the Skill registry reloads.

Invoke the workflow explicitly:

```text
Use $slide-editable-deck-orchestrator.
```

