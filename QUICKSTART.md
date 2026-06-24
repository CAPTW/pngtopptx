# Quick Install, No Git Required

This guide is for people who want to install the `pngtopptx` Codex SkillSet
without using Git or understanding the project internals.

Installing this SkillSet means copying four local Codex Skills into your user
Codex skills folder. After that, restart Codex and ask Codex to use the Skill.

## Before You Start

You need:

- Windows
- Codex Desktop/App or Codex CLI with local Skill support
- PowerShell, which is already included with Windows

You do not need Git to install from the ZIP download.

For real slide conversion jobs, the Skill may also need Node.js, Python, and
PowerPoint or LibreOffice. The verifier will tell you what is missing. The
basic Skill installation can still be done first.

## 1. Download

1. Open the GitHub repository page.
2. Click the green `Code` button.
3. Click `Download ZIP`.
4. Extract the ZIP file somewhere easy to find, such as `Downloads`.

After extracting, open the folder that contains `install.ps1`, `README.md`, and
`verify_install.ps1`.

## 2. Open PowerShell In That Folder

In File Explorer:

1. Open the extracted folder.
2. Click the address bar at the top.
3. Type `powershell`.
4. Press Enter.

A PowerShell window should open already pointed at the correct folder.

## 3. Run The Recommended Installer

Copy and paste this command:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force -InstallAgents
```

What this does:

- installs the four Codex Skills;
- backs up old copies before replacing them;
- installs the optional Codex agent templates;
- does not delete your input decks or generated PPTX files.

## 4. Verify

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

You want to see:

```text
Failures: 0
```

Warnings can be acceptable when they describe optional tools. If conversion jobs
later need those tools, Codex can help install them.

## 5. Restart Codex

Close and reopen Codex so it reloads the local Skill registry.

Then try this prompt:

```text
Use $slide-editable-deck-orchestrator.
Check that the pngtopptx editable PPTX SkillSet is available.
```

For a real conversion, upload or provide a slide image and ask:

```text
Use $slide-editable-deck-orchestrator.
Convert this slide image into an editable PPTX. Put the output in my Downloads folder.
```

## Updating Later

Download the newest ZIP, extract it, open PowerShell in the new folder, and run
the same recommended installer again:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force -InstallAgents
```

The old installed Skill folders are backed up before replacement.

## Common Problems

### PowerShell Says Scripts Are Disabled

Use the command exactly as shown, including `-ExecutionPolicy Bypass`:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force -InstallAgents
```

### Installer Refuses To Overwrite Existing Skills

That is intentional. Use the recommended command with backup and force:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force -InstallAgents
```

### Codex Cannot See The Skills

Restart Codex after installation. If it still cannot see them, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

Then check that the installed folders exist under:

```text
%USERPROFILE%\.codex\skills
```

### Conversion Fails Because Node.js Or Python Is Missing

Installation and conversion are separate steps. The Skill may install correctly
even if conversion dependencies are not ready yet. Run the verifier and follow
the missing-tool messages, or ask Codex to set up the dependencies for a deck
project.
