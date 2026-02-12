const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config.cjs');
const AppUpdater = require('./updater.cjs');

// Load environment variables from .env file in development
if (process.env.NODE_ENV === 'development') {
  require('dotenv').config();
}
// In production, environment variables should be set externally
// DO NOT bundle .env files with secrets - this is a security risk!

let mainWindow;
let nextServer;
const isDev = process.env.NODE_ENV === 'development';
const port = process.env.PORT || 3000;

// Backend URL configuration
// In production, use BACKEND_URL to connect to hosted backend
// If not set, fallback to local server mode
const BACKEND_URL = config.backendUrl;

// Determine the correct command based on platform
function getNodeCommand() {
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

// Start Next.js server
function startNextServer() {
  return new Promise((resolve, reject) => {
    if (isDev) {
      // In development, use next dev
      nextServer = spawn('npm', ['run', 'dev:next'], {
        shell: true,
        stdio: 'inherit',
        env: {
          ...process.env,
          ELECTRON: 'true'
        }
      });
    } else {
      // In production, use the standalone server
      const serverPath = path.join(app.getAppPath(), '.next', 'standalone', 'server.js');
      nextServer = spawn(getNodeCommand(), [serverPath], {
        stdio: 'inherit',
        env: {
          ...process.env,
          PORT: port,
          ELECTRON: 'true'
        }
      });
    }

    nextServer.on('error', (err) => {
      console.error('Failed to start Next.js server:', err);
      reject(err);
    });

    // Wait a bit for the server to start
    setTimeout(() => {
      console.log('Next.js server started');
      resolve();
    }, isDev ? 5000 : 2000);
  });
}

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
      // Relaxed security for service workers and notifications
      webSecurity: false,  // Allow service workers to work properly
      enableRemoteModule: false,
      partition: 'persist:main'  // Persistent session for service workers
    },
    autoHideMenuBar: true,
    backgroundColor: '#000000'
  });

  // Remove menu bar
  Menu.setApplicationMenu(null);

  // Load the Next.js app
  // If BACKEND_URL is set, connect to hosted backend (secure mode)
  // Otherwise, connect to local server (development/standalone mode)
  const url = BACKEND_URL || `http://localhost:${port}`;
  
  console.log(`Loading application from: ${url}`);
  
  mainWindow.loadURL(url).catch((err) => {
    console.error('Failed to load URL:', err);
    // Retry after a short delay
    setTimeout(() => {
      mainWindow.loadURL(url);
    }, 2000);
  });

  // Log console messages from the web page for debugging
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[WEB] ${message}`);
  });

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in default browser
    if (url.startsWith('http://') || url.startsWith('https://')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Handle web push notification permissions
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    // Auto-grant permission for notifications and other web APIs
    const allowedPermissions = ['notifications', 'media', 'geolocation'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Handle notification permission checks
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'notifications') {
      return true;
    }
    return false;
  });
}

app.whenReady().then(async () => {
  try {
    // Only start local server if no BACKEND_URL is configured
    if (!BACKEND_URL) {
      console.log('Starting local Next.js server...');
      await startNextServer();
    } else {
      console.log(`Connecting to hosted backend: ${BACKEND_URL}`);
    }
    createWindow();

    // Initialize auto-updater
    const updater = new AppUpdater();
    updater.checkOnStartup(async (update) => {
      console.log(`[Updater] New version available: ${update.version}`);
      
      // Show update notification dialog
      const response = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version of AIOgames is available!`,
        detail: `Version ${update.version} is now available. You are currently running version ${app.getVersion()}.\n\nWould you like to download it now?`,
        buttons: ['Download Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });

      if (response.response === 0) {
        // User clicked "Download Now"
        try {
          const downloadPath = await updater.downloadUpdate();
          
          const installResponse = await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Downloaded',
            message: 'Update downloaded successfully!',
            detail: `The installer has been saved to:\n${downloadPath}\n\nWould you like to open the downloads folder?`,
            buttons: ['Open Downloads Folder', 'OK'],
            defaultId: 0,
            cancelId: 1,
          });

          if (installResponse.response === 0) {
            shell.showItemInFolder(downloadPath);
          }
        } catch (error) {
          console.error('[Updater] Download failed:', error);
          dialog.showErrorBox(
            'Download Failed',
            `Failed to download the update: ${error.message}`
          );
        }
      }
    });
  } catch (err) {
    console.error('Error starting application:', err);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (nextServer) {
      nextServer.kill();
    }
    app.quit();
  }
});

app.on('before-quit', () => {
  if (nextServer) {
    nextServer.kill();
  }
});

// Handle any uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});
