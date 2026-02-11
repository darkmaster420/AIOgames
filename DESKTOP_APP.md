# AIOGames Desktop App

This guide explains how to run and build the AIOGames Windows desktop application.

## Overview

The desktop app wraps the Next.js web application using Electron, providing a native Windows experience with:
- Standalone executable (.exe)
- No browser required
- Native window controls
- System tray integration (future)

## Configuration

See [Desktop App Configuration Guide](DESKTOP_APP_CONFIG.md) for complete instructions on:
- Configuring MongoDB connection
- Setting up authentication
- Adding Telegram bot integration
- Pre-configuring builds before distribution

### Quick Config Summary

The app uses [`.env.production`](.env.production) for configuration. You can:

1. **Pre-configure before building**: Edit `.env.production` with your settings, then build
2. **Let users configure**: Users edit the file after installation at `resources\app\.env.production`

## Development

### Prerequisites
- Node.js 20+ installed
- All project dependencies installed (`npm install`)
- MongoDB running (local or remote connection configured)

### Running in Development Mode

1. Start the Next.js development server:
   ```bash
   npm run dev:next
   ```

2. In a separate terminal, start the Electron app:
   ```bash
   npm run electron:dev
   ```

The app will open in a desktop window with DevTools enabled for debugging.

## Building for Production

### Building the Windows Installer

To create a Windows installer (.exe):

```bash
npm run electron:build:win
```

This will:
1. Build the Next.js production bundle
2. Package everything with Electron
3. Create an installer in the `dist/` directory

The installer will be named: `AIOGames-Setup-{version}.exe`

### Build Output

After building, you'll find in the `dist/` folder:
- `AIOGames-Setup-{version}.exe` - The Windows installer
- `win-unpacked/` - The unpacked application files

### Distribution

To distribute your app:
1. Share the `AIOGames-Setup-{version}.exe` installer
2. Users run the installer to install the app
3. The app appears in Start Menu and Desktop (if selected)

## Configuration

### App Settings

Main Electron configuration is in:
- [`electron/main.js`](electron/main.js) - Main process, window configuration
- [`electron/preload.js`](electron/preload.js) - Security preload script
- [`electron-builder.json`](electron-builder.json) - Build configuration

### Customization

#### Change App Name
Edit `electron-builder.json`:
```json
{
  "productName": "Your App Name"
}
```

#### Change Window Size
Edit `electron/main.js`:
```javascript
const mainWindow = new BrowserWindow({
  width: 1400,  // Change this
  height: 900,  // And this
  // ...
});
```

#### Add App Icon
1. Place your icon file in `public/` directory
   - For Windows: `icon.ico` (256x256 recommended)
2. Reference it in `electron-builder.json`:
   ```json
   {
     "win": {
       "icon": "public/icon.ico"
     }
   }
   ```

## Environment Variables

The Electron app will automatically detect it's running in Electron mode via:
```javascript
process.env.ELECTRON === 'true'
```

You can use this in your Next.js code to conditionally enable/disable features specific to the desktop app.

## Troubleshooting

### Port Already in Use
If port 3000 is already in use, set a different port:
```bash
set PORT=3001
npm run electron:dev
```

### App Won't Start
1. Make sure MongoDB is accessible
2. Check `.env` file is properly configured
3. Try rebuilding: `npm run build` then `npm run electron:dev`

### Build Fails
1. Clear the dist folder: `rmdir /s /q dist`
2. Clear Next.js cache: `rmdir /s /q .next`
3. Rebuild: `npm run electron:build:win`

## Advanced

### Code Signing
To code sign your Windows app:
1. Obtain a code signing certificate
2. Configure in `electron-builder.json`:
   ```json
   {
     "win": {
       "certificateFile": "path/to/cert.pfx",
       "certificatePassword": "your_password"
     }
   }
   ```

### Auto-Updates
To enable auto-updates, integrate `electron-updater`:
1. Install: `npm install electron-updater`
2. Configure update server in `electron-builder.json`
3. Add update logic to `electron/main.js`

## Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [electron-builder Documentation](https://www.electron.build/)
- [Next.js Documentation](https://nextjs.org/docs)

## Releasing on GitHub

### Automated Release (Recommended)

The project includes a GitHub Actions workflow that automatically builds and publishes releases:

1. **Update version** in [`package.json`](package.json):
   ```bash
   npm version patch  # For bug fixes (1.10.1 -> 1.10.2)
   npm version minor  # For new features (1.10.1 -> 1.11.0)
   npm version major  # For breaking changes (1.10.1 -> 2.0.0)
   ```

2. **Push the tag** to GitHub:
   ```bash
   git push origin main --tags
   ```

3. **Wait for the build** - GitHub Actions will:
   - Build the Windows installer
   - Create a GitHub release
   - Upload the `.exe` file automatically

4. **Publish the release** - Go to your GitHub repository's Releases page and the new release will be ready!

### Manual Release

If you prefer to release manually:

1. **Build the installer**:
   ```bash
   npm run electron:build:win
   ```

2. **Find your installer** in the `dist/` folder:
   - `AIOGames-Setup-{version}.exe`

3. **Create a GitHub Release**:
   - Go to your repository on GitHub
   - Click "Releases" → "Create a new release"
   - Tag version: `v1.10.1` (match your package.json version)
   - Release title: `AIOgames v1.10.1`
   - Description: Add release notes
   - Upload the `.exe` file from `dist/`
   - Click "Publish release"

4. **Share the download link** with users:
   ```
   https://github.com/YOUR_USERNAME/AIOgames/releases/latest
   ```

### Distribution

Users can download and install:
1. Go to the GitHub Releases page
2. Download `AIOGames-Setup-{version}.exe`
3. Run the installer
4. AIOgames will be installed and added to the Start Menu
