# AIOGames Desktop App - Secure Configuration Guide

## ⚠️ Critical Security Warning

**DO NOT bundle credentials/API keys into the .exe file!**

Anyone who installs your app can:
- Navigate to the installation folder
- Open the `resources\app` directory
- Read ANY file you bundled, including `.env` files
- Extract your MongoDB passwords, API keys, secrets, etc.

## Secure Architecture Options

### ✅ Option 1: Self-Hosted Backend (RECOMMENDED)

**Best for**: Public distribution, security, maintainability

**Architecture**:
```
[User's Desktop App] → [Your Hosted Server] → [Your MongoDB + APIs]
```

**How it works**:
1. You host the Next.js backend on a server (Vercel, Railway, VPS, etc.)
2. Desktop app is just a webview that loads your hosted URL
3. NO local server, NO bundled credentials
4. All secrets stay safely on YOUR server

**Setup**:

1. **Deploy your backend** to any hosting service:
   ```bash
   # Example with Vercel
   vercel deploy --prod
   ```

2. **Edit [`electron/main.cjs`](electron/main.cjs)** - change around line 60:

   ```javascript
   // BEFORE (local server):
   const url = `http://localhost:${port}`;
   
   // AFTER (your hosted backend):
   const url = `https://your-domain.com`;  // Your production URL
   ```

3. **Disable local server startup** in the same file:

   ```javascript
   app.whenReady().then(async () => {
     try {
       // COMMENT OUT THIS LINE:
       // await startNextServer();
       
       createWindow();  // Just open the window
     } catch (err) {
       console.error('Error starting application:', err);
       app.quit();
     }
   });
   ```

4. **Build the desktop app**:
   ```bash
   npm run electron:build:win
   ```

**Benefits**:
- ✅ **Secure**: Users never see your credentials
- ✅ **Easy updates**: Update your server, no new .exe needed
- ✅ **Scalable**: One backend serves all desktop users
- ✅ **Professional**: Like Discord, Slack, VS Code, etc.

**Users need**:
- Just the .exe file
- Internet connection
- That's it!

---

### ⚠️ Option 2: Fully Standalone (Personal Use ONLY)

**Best for**: Building for yourself, development/testing

**How it works**:
- Desktop app runs its own Next.js server
- Requires local or remote MongoDB access
- Each instance is completely independent

**⚠️ Security Risks**:
- If you bundle credentials, anyone can extract them
- Users can access your MongoDB if you use your connection string
- API keys are exposed

#### Approach 2a: No Bundled Credentials (Still risky for distribution)

Users must set up their own:
- MongoDB (local or Atlas)
- API keys
- Configuration

Not recommended - too complex for end users.

#### Approach 2b: For Personal Use Only (YOU are the only user)

If you're building for yourself and won't distribute:

1. Keep your `.env` file (don't commit to GitHub!)
2. Optionally bundle `.env.production`:
   - Edit [`electron-builder.json`](electron-builder.json)
   - Add `.env.production` to the `files` array
3. Build and use personally

**⚠️ Never share this .exe with anyone!**

---

## Recommendation

**Use Option 1** - it's what professional desktop apps do:

- **VS Code**: Connects to Microsoft's servers for extensions, sync
- **Discord**: Desktop app connects to Discord's servers
- **Slack**: Desktop app connects to Slack's workspace servers
- **Spotify**: Desktop app streams from Spotify's servers

Your app should work the same way - desktop UI + your hosted backend.

---

## Example: Converting to Self-Hosted

Here's the exact changes needed for Option 1:

**File: [`electron/main.cjs`](electron/main.cjs)**

```javascript
// Around line 60-90, replace the entire URL loading section:

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    autoHideMenuBar: true,
    backgroundColor: '#000000'
  });

  Menu.setApplicationMenu(null);

  // YOUR HOSTED URL HERE:
  const url = 'https://aiogames.yourdomain.com';
  
  mainWindow.loadURL(url).catch((err) => {
    console.error('Failed to load URL:', err);
  });

  // Remove this in production:
  // if (isDev) {
  //   mainWindow.webContents.openDevTools();
  // }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

// Simplified app startup - no local server:
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

That's it! Now your desktop app is just a secure webview to your hosted backend.
