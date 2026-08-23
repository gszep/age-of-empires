# Local import tools

Tools in this directory define reproducible import steps. Tool installations, source game files, and generated proprietary content live in ignored directories.

```text
.tools/          external Python/openage environments
.local/aoe2de/   local source configuration and intermediate data
public/imported/ browser-ready local atlases/manifests
```

No Steam credentials, Steam configuration, DAT files, SLD files, or converted Microsoft assets belong in this repository.

Planned adapters:

1. `genieutils-py` extracts a selected semantic subset from the patch-matched DAT. Version 0.1.2 successfully parsed the downloaded `VER 8.9` file; `aoe2-genie-tooling` 1.2.4 left 22,449 bytes unparsed and is not used for this manifest.
2. openage converts selected SLD files to PNG atlases and `.texture` hotspot metadata.
3. A project-owned packager converts those generic outputs into the versioned JSON schema consumed by the browser and future Node runner.
