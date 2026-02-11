const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Load environment variables from .env file
const dotenv = require('dotenv');

// In development, load from project root .env
// In production, load from .env.production in the app directory
const isDev = process.env.NODE_ENV === 'development';
if (isDev) {
  dotenv.config();
} else {
  // Load production env from the app directory
  const envPath = path.join(app.getAppPath(), '.env.production');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

let mainWindow;
let nextServer;
const port = process.env.PORT || 3000;

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
      webSecurity: true
    },
    autoHideMenuBar: true,
    backgroundColor: '#000000'
  });

  // Remove menu bar
  Menu.setApplicationMenu(null);

  // Load the Next.js app
  const url = `http://localhost:${port}`;
  
  mainWindow.loadURL(url).catch((err) => {
    console.error('Failed to load URL:', err);
    // Retry after a short delay
    setTimeout(() => {
      mainWindow.loadURL(url);
    }, 2000);
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
}

app.whenReady().then(async () => {
  try {
    await startNextServer();
    createWindow();
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
