const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const path = require('path');
const isDev = !app.isPackaged;
const { spawn } = require('child_process');
const fs = require('fs');

// Keep a global reference of the window object
let mainWindow;
let backendProcess;

function createWindow() {

  console.log('isDev:', isDev);
  console.log('app.isPackaged:', app.isPackaged);
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: false, // Allow local API calls
    },
    icon: path.join(__dirname, 'logo.ico'), // Add your lab logo
    show: false, // Don't show until ready
    titleBarStyle: 'default',
  });

  // Remove default menu bar (optional)
  Menu.setApplicationMenu(null);

  const startUrl = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(__dirname, '../build/index.html')}`;
  
  mainWindow.loadURL(startUrl);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
  mainWindow.show();
  
  // FORCE DevTools open to see logs
  mainWindow.webContents.openDevTools();
});

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle navigation (security)
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    
    if (parsedUrl.origin !== 'http://localhost:3000' && !isDev) {
      event.preventDefault();
    }
  });
}

// Start FastAPI backend
function startBackend() {
  console.log('=== BACKEND STARTUP DEBUG ===');
  console.log('isDev:', isDev);
  console.log('app.isPackaged:', app.isPackaged);
  console.log('process.env.NODE_ENV:', process.env.NODE_ENV);
  console.log('Will attempt to start backend?', !isDev);

  if (isDev) {
    console.log('❌ EXITING: Development mode detected');
    return;
  }

  console.log('✅ Production mode: Attempting to start backend...');
  
  try {
    // Check all possible paths
    const possiblePaths = [
      path.join(process.resourcesPath, 'backend', 'dist', 'lab_backend.exe'),
      path.join(__dirname, 'backend', 'dist', 'lab_backend.exe'),
      path.join(__dirname, '..', 'backend', 'dist', 'lab_backend.exe'),
      path.join(process.resourcesPath, 'app', 'backend', 'dist', 'lab_backend.exe'),
      path.join(__dirname, '..', '..', 'backend', 'dist', 'lab_backend.exe')
    ];

    console.log('Checking these paths:');
    possiblePaths.forEach((p, i) => {
      const exists = fs.existsSync(p);
      console.log(`${i + 1}. ${p} - ${exists ? '✅ EXISTS' : '❌ NOT FOUND'}`);
    });

    let backendPath;
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        backendPath = possiblePath;
        break;
      }
    }

    if (!backendPath) {
      console.error('❌ Backend executable not found in any location!');
      dialog.showErrorBox('Backend Error', 'Backend executable not found');
      return;
    }

    console.log('✅ Found backend at:', backendPath);

    // Start the backend process
    console.log('🚀 Starting backend process...');
    backendProcess = spawn(backendPath, [], {
      cwd: path.dirname(backendPath),
      env: {
        ...process.env,
        ENVIRONMENT: 'production'
      }
    });

    console.log('✅ Backend process spawned');

    backendProcess.stdout.on('data', (data) => {
      console.log(`📤 Backend stdout: ${data}`);
    });

    backendProcess.stderr.on('data', (data) => {
      console.error(`📤 Backend stderr: ${data}`);
    });

    backendProcess.on('close', (code) => {
      console.log(`💀 Backend process exited with code ${code}`);
    });

    backendProcess.on('error', (error) => {
      console.error('💥 Backend spawn error:', error);
    });

  } catch (error) {
    console.error('💥 Failed to start backend:', error);
    dialog.showErrorBox('Backend Error', `Failed to start backend: ${error.message}`);
  }
}

// Stop backend process
function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    console.log('Stopping backend process...');
    backendProcess.kill('SIGTERM');
    
    // Force kill if it doesn't stop gracefully
    setTimeout(() => {
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill('SIGKILL');
      }
    }, 5000);
    
    backendProcess = null;
  }
}

// App event handlers
app.whenReady().then(() => {
  startBackend();
  
  // Wait a moment for backend to start before creating window
  setTimeout(() => {
    createWindow();
  }, 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackend();
});

// Handle certificate errors (for self-signed certificates)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (url.startsWith('https://localhost')) {
    // Allow self-signed certificates for localhost
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// Handle app crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  stopBackend();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});