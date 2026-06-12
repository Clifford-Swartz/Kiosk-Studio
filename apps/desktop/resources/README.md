# Bundled App Resources

This folder contains static assets bundled with the application.

## Required Assets

### audio-icon.png
- **Purpose**: Static icon displayed for audio elements in the editor
- **Size**: 60×60 pixels (matches default audio element size)
- **Format**: PNG with transparency
- **Content**: Speaker/sound wave icon
- **Current**: Using embedded data URI fallback in code (replace with this file for better quality)

### placeholder.png
- **Purpose**: Default image shown for new image elements before user imports their own
- **Size**: 320×240 pixels (matches default image element size)
- **Format**: PNG
- **Content**: Gray rectangle with "Image" text or camera icon
- **Current**: Using embedded data URI fallback in code (replace with this file for better quality)

## How These Are Bundled

In production builds (`pnpm --filter @kiosk/desktop package`):
- Files in this folder are copied to `process.resourcesPath/` by @electron/packager
- The `app://` URL scheme handler (main process) serves them from this location
- Example URL: `app://audio-icon.png` resolves to `process.resourcesPath/audio-icon.png`

In development:
- The `app://` handler resolves to `__dirname/../../resources/` (repo root)
- Hot reload does not apply to these static assets (restart dev server if changed)
