# build_lab_manager_exe_fixed.py - Fixed version with Node.js detection
import os
import shutil
import subprocess
import sys
import json
from pathlib import Path

def check_nodejs_installation():
    """Check if Node.js and npm are installed"""
    print("🔍 Checking Node.js installation...")
    
    # Check Node.js
    try:
        result = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            node_version = result.stdout.strip()
            print(f"✅ Node.js found: {node_version}")
        else:
            print("❌ Node.js not found")
            return False
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("❌ Node.js not found")
        return False
    
    # Check npm
    try:
        result = subprocess.run(["npm", "--version"], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            npm_version = result.stdout.strip()
            print(f"✅ npm found: {npm_version}")
            return True
        else:
            print("❌ npm not found")
            return False
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("❌ npm not found")
        return False

def install_nodejs_guide():
    """Provide Node.js installation guide"""
    print("\n" + "="*60)
    print("📥 NODE.JS INSTALLATION REQUIRED")
    print("="*60)
    print("You need Node.js to build the React frontend.")
    print("\n🔗 Download Node.js from: https://nodejs.org/")
    print("\n📋 Installation Steps:")
    print("1. Go to https://nodejs.org/")
    print("2. Download the LTS version (recommended)")
    print("3. Run the installer (.msi file)")
    print("4. Follow the installation wizard")
    print("5. Restart your command prompt/terminal")
    print("6. Run this script again")
    print("\n💡 Alternative: Use pre-built React files (skip frontend build)")
    
    choice = input("\nDo you have pre-built React files? (y/n): ").lower().strip()
    return choice == 'y'

def find_existing_build():
    """Look for existing React build files"""
    possible_builds = [
        Path("build"),
        Path("dist"), 
        Path("src/build"),
        Path("frontend/build"),
        Path("frontend/dist")
    ]
    
    for build_path in possible_builds:
        if build_path.exists() and (build_path / "index.html").exists():
            print(f"✅ Found existing build at: {build_path}")
            return build_path
    
    return None

def create_minimal_frontend():
    """Create a minimal HTML frontend as fallback"""
    print("🔧 Creating minimal frontend fallback...")
    
    build_dir = Path("build")
    build_dir.mkdir(exist_ok=True)
    
    # Create minimal index.html
    html_content = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Assembly Lab Manager</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
        .container { max-width: 800px; margin: 0 auto; }
        .error { color: #e74c3c; background: #fdf2f2; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .info { color: #2c3e50; background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
        button { background: #667eea; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
        button:hover { background: #5a6fd8; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧪 Assembly Lab Manager</h1>
        <div class="info">
            <h3>Backend-Only Mode</h3>
            <p>The React frontend was not built. You can still access the API.</p>
            <p><strong>API Documentation:</strong> <a href="http://localhost:8000/docs" target="_blank">http://localhost:8000/docs</a></p>
            <p><strong>Alternative:</strong> Build the React frontend separately and replace this page.</p>
        </div>
        
        <div id="status"></div>
        
        <button onclick="checkAPI()">Test API Connection</button>
        
        <script>
            async function checkAPI() {
                const status = document.getElementById('status');
                try {
                    const response = await fetch('http://localhost:8000/health');
                    if (response.ok) {
                        const data = await response.json();
                        status.innerHTML = '<div class="info">✅ API is running! <a href="http://localhost:8000/docs">Open API Docs</a></div>';
                    } else {
                        status.innerHTML = '<div class="error">❌ API returned error: ' + response.status + '</div>';
                    }
                } catch (error) {
                    status.innerHTML = '<div class="error">❌ Cannot connect to API. Make sure the backend is running.</div>';
                }
            }
            
            // Auto-check on load
            setTimeout(checkAPI, 1000);
        </script>
    </div>
</body>
</html>"""
    
    with open(build_dir / "index.html", "w") as f:
        f.write(html_content)
    
    # Create minimal manifest
    manifest_content = {
        "short_name": "Lab Manager",
        "name": "Assembly Lab Manager",
        "start_url": ".",
        "display": "standalone"
    }
    
    with open(build_dir / "manifest.json", "w") as f:
        json.dump(manifest_content, f, indent=2)
    
    print(f"✅ Minimal frontend created at: {build_dir}")
    return build_dir

def build_lab_manager_exe():
    """Build Lab Manager EXE with Node.js detection"""
    
    print("🧪 ASSEMBLY LAB MANAGER - Centralized PostgreSQL EXE Builder")
    print("This will create an executable for your lab management system.")
    print()
    
    print("🏗️ Building ASSEMBLY LAB MANAGER EXE for Centralized PostgreSQL")
    print("=" * 70)
    
    # Project paths
    root_dir = Path.cwd()
    backend_dir = root_dir / "backend"
    frontend_dir = root_dir / "src"
    modules_dir = backend_dir / "modules"
    
    print(f"📁 Project root: {root_dir}")
    print(f"📁 Backend: {backend_dir}")
    print(f"📁 Frontend: {frontend_dir}")
    print(f"📁 Modules: {modules_dir}")
    
    # Verify backend structure
    if not backend_dir.exists():
        print("❌ Backend directory not found!")
        return False
    
    if not modules_dir.exists():
        print("❌ Modules directory not found!")
        return False
    
    # Step 1: Get database configuration
    print("\n📊 Database Server Configuration")
    print("-" * 40)
    db_host = "192.168.99.121"
    db_name = "postgres"
    db_user = "postgres"
    db_password = "karthi"
    
    # Step 2: Handle frontend build
    print("\n⚛️ Frontend Build Process...")
    
    # Check for Node.js
    build_output = None
    
    if check_nodejs_installation():
        print("✅ Node.js detected. Proceeding with React build...")
        
        # Find package.json
        package_json_locations = [
            root_dir / "package.json",
            frontend_dir / "package.json"
        ]
        
        package_json_path = None
        for loc in package_json_locations:
            if loc.exists():
                package_json_path = loc
                build_dir = loc.parent
                break
        
        if package_json_path:
            try:
                print(f"   Using package.json at: {package_json_path}")
                print("   Installing npm dependencies...")
                subprocess.run(["npm", "install"], cwd=build_dir, check=True, timeout=300)
                
                print("   Building production bundle...")
                subprocess.run(["npm", "run", "build"], cwd=build_dir, check=True, timeout=600)
                
                # Find build output
                for possible_build in [build_dir / "build", build_dir / "dist", root_dir / "build"]:
                    if possible_build.exists() and (possible_build / "index.html").exists():
                        build_output = possible_build
                        print(f"✅ React build successful: {build_output}")
                        break
                
                if not build_output:
                    print("❌ Build completed but output directory not found!")
                    print("🔍 Looking for existing build files...")
                    build_output = find_existing_build()
                
            except subprocess.CalledProcessError as e:
                print(f"❌ npm command failed: {e}")
                print("🔍 Looking for existing build files...")
                build_output = find_existing_build()
            except subprocess.TimeoutExpired:
                print("❌ Build process timed out")
                print("🔍 Looking for existing build files...")
                build_output = find_existing_build()
        else:
            print("❌ package.json not found!")
            print("🔍 Looking for existing build files...")
            build_output = find_existing_build()
    
    else:
        # Node.js not found
        if install_nodejs_guide():
            print("🔍 Looking for existing build files...")
            build_output = find_existing_build()
        else:
            print("📋 Choose an option:")
            print("1. Install Node.js and run this script again")
            print("2. Continue with minimal frontend (backend-only)")
            print("3. Exit and manually build frontend")
            
            choice = input("Enter choice (1/2/3): ").strip()
            
            if choice == "1":
                print("Please install Node.js and run this script again.")
                return False
            elif choice == "2":
                build_output = create_minimal_frontend()
            else:
                print("Exiting. Please build frontend manually.")
                return False
    
    # If no build found, create minimal one
    if not build_output:
        print("⚠️ No React build found. Creating minimal frontend...")
        build_output = create_minimal_frontend()
    
    # Step 3: Prepare backend
    print("\n🐍 Preparing backend...")
    
    # Copy frontend build to backend
    backend_build = backend_dir / "build"
    if backend_build.exists():
        shutil.rmtree(backend_build)
    
    shutil.copytree(build_output, backend_build)
    print(f"   Frontend copied to: {backend_build}")
    
    # Step 4: Create configuration
    print("\n⚙️ Creating configuration...")
    config = {
        "deployment_type": "centralized",
        "database": {
            "host": db_host,
            "port": 5432,
            "name": db_name,
            "user": db_user,
            "password": db_password
        },
        "application": {
            "backend_port": 8000,
            "frontend_port": 3000,
            "auto_open_browser": True
        },
        "station": {
            "id": "station_template",
            "name": "Lab Station",
            "modules": [
                "chip_inspection",
                "housing_inspection",
                "manufacturing_orders", 
                "s11",
                "s21",
                "twotone"
            ]
        }
    }
    
    config_file = backend_dir / "lab_config.json"
    with open(config_file, "w") as f:
        json.dump(config, f, indent=2)
    print(f"✅ Configuration saved: {config_file}")
    
    # Step 5: Create launcher (same as before)
    print("\n🚀 Creating application launcher...")
    
    launcher_code = '''"""
ASSEMBLY LAB MANAGER - Centralized PostgreSQL Launcher
"""
import os
import sys
import json
import time
import threading
import webbrowser
import socket
import psycopg2
from pathlib import Path
import http.server
import socketserver
from datetime import datetime

class AssemblyLabManagerLauncher:
    def __init__(self):
        self.base_dir = Path(__file__).parent
        self.config = self.load_config()
        
    def load_config(self):
        """Load configuration from lab_config.json"""
        config_file = self.base_dir / "lab_config.json"
        try:
            with open(config_file, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            print("❌ Configuration file 'lab_config.json' not found!")
            input("Press Enter to exit...")
            sys.exit(1)
    
    def test_database_connection(self):
        """Test PostgreSQL connection"""
        print("🔗 Testing database connection...")
        db_config = self.config['database']
        
        try:
            conn = psycopg2.connect(
                host=db_config['host'],
                port=db_config['port'],
                database=db_config['name'],
                user=db_config['user'],
                password=db_config['password'],
                connect_timeout=10
            )
            
            cursor = conn.cursor()
            cursor.execute("SELECT version();")
            version = cursor.fetchone()[0]
            cursor.close()
            conn.close()
            
            print(f"✅ Database connected: {version[:50]}...")
            return True
            
        except Exception as e:
            print(f"❌ Database connection failed: {e}")
            return False
    
    def start_backend(self):
        """Start FastAPI backend"""
        try:
            os.chdir(self.base_dir)
            os.environ['ENVIRONMENT'] = 'production'
            
            db_config = self.config['database']
            os.environ['DB_HOST'] = db_config['host']
            os.environ['DB_PORT'] = str(db_config['port'])
            os.environ['DB_NAME'] = db_config['name']
            os.environ['DB_USER'] = db_config['user']
            os.environ['DB_PASSWORD'] = db_config['password']
            
            import main
            import uvicorn
            
            config = uvicorn.Config(
                app=main.app,
                host="127.0.0.1",
                port=self.config['application']['backend_port'],
                log_level="info",
                access_log=False
            )
            server = uvicorn.Server(config)
            server.run()
            
        except Exception as e:
            print(f"❌ Backend error: {e}")
            input("Press Enter to exit...")
            sys.exit(1)
    
    def start_frontend(self):
        """Start frontend server"""
        try:
            build_dir = self.base_dir / "build"
            if not build_dir.exists():
                print("❌ Frontend build directory not found!")
                return
            
            os.chdir(build_dir)
            
            class ReactHandler(http.server.SimpleHTTPRequestHandler):
                def end_headers(self):
                    self.send_header('Cache-Control', 'no-cache')
                    super().end_headers()
                
                def do_GET(self):
                    if not os.path.exists(self.translate_path(self.path)):
                        self.path = '/index.html'
                    return super().do_GET()
                
                def log_message(self, format, *args):
                    pass
            
            port = self.config['application']['frontend_port']
            with socketserver.TCPServer(("127.0.0.1", port), ReactHandler) as httpd:
                httpd.serve_forever()
                
        except Exception as e:
            print(f"❌ Frontend error: {e}")
    
    def start_application(self):
        """Start the application"""
        print("🧪 ASSEMBLY LAB MANAGER - Starting...")
        
        if not self.test_database_connection():
            print("❌ Cannot start without database connection")
            input("Press Enter to exit...")
            return
        
        # Start services
        backend_thread = threading.Thread(target=self.start_backend, daemon=True)
        backend_thread.start()
        
        time.sleep(3)
        
        frontend_thread = threading.Thread(target=self.start_frontend, daemon=True)
        frontend_thread.start()
        
        time.sleep(2)
        
        # Open browser
        if self.config['application'].get('auto_open_browser', True):
            webbrowser.open(f"http://localhost:{self.config['application']['frontend_port']}")
        
        print("✅ Assembly Lab Manager started!")
        print(f"🌐 Web: http://localhost:{self.config['application']['frontend_port']}")
        print(f"📡 API: http://localhost:{self.config['application']['backend_port']}")
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\\nShutting down...")

if __name__ == "__main__":
    launcher = AssemblyLabManagerLauncher()
    launcher.start_application()
'''
    
    launcher_file = backend_dir / "assembly_lab_launcher.py"
    with open(launcher_file, "w") as f:
        f.write(launcher_code)
    print("✅ Launcher created")
    
    # Step 6: Build executable
    print("\n🔨 Building executable...")
    
    if not shutil.which("pyinstaller"):
        print("   Installing PyInstaller...")
        subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"], check=True)
    
    original_dir = os.getcwd()
    os.chdir(backend_dir)
    
    try:
        pyinstaller_cmd = [
            "pyinstaller",
            "--onefile",
            "--name=AssemblyLabManager",
            "--distpath=../distribution",
            "--add-data=lab_config.json;.",
            "--add-data=build;build",
            "--add-data=modules;modules",
            "--hidden-import=uvicorn",
            "--hidden-import=fastapi",
            "--hidden-import=psycopg2",
            "--hidden-import=modules.chip_inspection_module",
            "--hidden-import=modules.housing_inspection_module",
            "--hidden-import=modules.manufacturing_orders_module",
            "--hidden-import=modules.s11_module",
            "--hidden-import=modules.S21_module",
            "--hidden-import=modules.twotone_module",
            "--collect-submodules=psycopg2",
            "--collect-submodules=modules",
            "--noconsole",
            "assembly_lab_launcher.py"
        ]
        
        print("   Running PyInstaller (this may take several minutes)...")
        result = subprocess.run(pyinstaller_cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            print("✅ Executable built successfully!")
        else:
            print("❌ Build failed!")
            print("Error:", result.stderr)
            return False
            
    except Exception as e:
        print(f"❌ Build error: {e}")
        return False
    finally:
        os.chdir(original_dir)
    
    # Success summary
    print("\n" + "=" * 70)
    print("🎉 BUILD COMPLETED!")
    print("=" * 70)
    
    dist_dir = Path("distribution")
    exe_path = dist_dir / "AssemblyLabManager.exe"
    if exe_path.exists():
        size_mb = exe_path.stat().st_size / (1024 * 1024)
        print(f"📁 Executable: {exe_path}")
        print(f"📏 Size: {size_mb:.1f} MB")
    
    print(f"\n🚀 Next Steps:")
    print(f"1. Setup PostgreSQL on {db_host}")
    print(f"2. Migrate your database using pgAdmin")
    print(f"3. Copy AssemblyLabManager.exe to lab stations")
    print(f"4. Configure lab_config.json for each station")
    
    return True

if __name__ == "__main__":
    success = build_lab_manager_exe()
    if not success:
        print("Build failed!")
    input("\nPress Enter to exit...")