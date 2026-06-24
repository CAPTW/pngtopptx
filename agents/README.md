# Agent Templates

This folder collects optional Codex agent template TOML files from the packaged Skills.

To install them with the SkillSet:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallAgents
```

The installer copies templates to:

```text
%USERPROFILE%\.codex\agents
```

Existing agent files are not overwritten unless `-Force` is used.

