# Manuals — local-only reference set

This directory holds copies of Fractal Audio's official documentation that
the project consults during reverse-engineering work. **None of these files
are committed to the repo** — they're copyrighted by Fractal Audio and we
don't redistribute them.

After cloning this repo, download each of the files below from Fractal's
site and drop them here. Several of the scripts and docs expect these exact
filenames.

## Expected files

| Filename | Source |
|----------|--------|
| `AM4-Owners-Manual.pdf` | https://www.fractalaudio.com/am4-downloads/ |
| `Fractal-Audio-Blocks-Guide.pdf` | https://www.fractalaudio.com/downloads/ (search "Blocks Guide") |
| `Axe-Fx III MIDI for 3rd Party Devices.pdf` | https://www.fractalaudio.com/downloads/misc/Axe-Fx%20III%20MIDI%20for%203rd%20Party%20Devices.pdf |

## Optional: extract text for grep-ability

The project refers to `.txt` extractions of each PDF as well. If you have
`pdftotext` (ships with Poppler / MSYS2 on Windows), run:

```bash
cd docs/manuals
pdftotext -layout "AM4-Owners-Manual.pdf" "AM4-Owners-Manual.txt"
pdftotext -layout "Fractal-Audio-Blocks-Guide.pdf" "Fractal-Audio-Blocks-Guide.txt"
pdftotext -layout "Axe-Fx III MIDI for 3rd Party Devices.pdf" "AxeFx3-MIDI-3rdParty.txt"
```

See `docs/REFERENCES.md` for how each manual is used by the project.
