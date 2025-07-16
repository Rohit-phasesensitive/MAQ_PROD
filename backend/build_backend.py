import subprocess
import os
import sys
import shutil

def build_backend():
    """Build the FastAPI backend into a standalone executable"""
    
    print("Building FastAPI backend...")
    print(f"Working directory: {os.getcwd()}")
    
    # Clean previous build
    if os.path.exists("dist"):
        shutil.rmtree("dist")
        print("🧹 Cleaned previous dist folder")
    if os.path.exists("build"):
        shutil.rmtree("build")
        print("🧹 Cleaned previous build folder")
    
    # Check what files exist
    print("\n🔍 Checking for files...")
    
    # Build basic PyInstaller command (minimal first)
    cmd = [
        "pyinstaller",
        "--onefile",
        "--name=lab_backend",
        "--distpath=dist",
        "--workpath=build",
        "--specpath=build",
        "--console"  # Show console for debugging
    ]
    
    # Add FastAPI/Uvicorn hidden imports (essential)
    uvicorn_imports = [
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.websockets_impl",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.http.httptools_impl",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.loops.uvloop"
    ]
    
    for import_name in uvicorn_imports:
        cmd.append(f"--hidden-import={import_name}")
    
    # Add modules if they exist (try different approach)
    if os.path.exists("modules") and os.path.isdir("modules"):
        print("✅ modules directory found")
        
        # Try using absolute path
        modules_path = os.path.abspath("modules")
        print(f"📁 Modules absolute path: {modules_path}")
        
        # Add data with absolute path
        if os.name == 'nt':  # Windows
            cmd.append(f"--add-data={modules_path};modules")
        else:  # Linux/Mac
            cmd.append(f"--add-data={modules_path}:modules")
        
        # Add hidden imports for modules
        cmd.extend([
            "--hidden-import=modules",
            "--collect-submodules=modules"
        ])
        
        # List actual module files found
        try:
            module_files = [f for f in os.listdir("modules") if f.endswith(".py") and f != "__init__.py"]
            print(f"📄 Found module files: {module_files}")
            
            for module_file in module_files:
                module_name = module_file.replace(".py", "")
                cmd.append(f"--hidden-import=modules.{module_name}")
                print(f"✅ Added hidden import for: modules.{module_name}")
                
        except Exception as e:
            print(f"⚠️ Could not list module files: {e}")
    else:
        print("❌ modules directory not found")
        print(f"📁 Current directory contents: {os.listdir('.')}")
    
    # Add main.py at the end
    cmd.append("main.py")
    
    print(f"\n🔨 Running PyInstaller...")
    print("Command:", " ".join(cmd))
    
    try:
        subprocess.run(cmd, check=True)
        print("✅ Backend build successful!")
        
        exe_name = "lab_backend.exe" if os.name == 'nt' else "lab_backend"
        exe_path = os.path.join("dist", exe_name)
        
        if os.path.exists(exe_path):
            size_mb = os.path.getsize(exe_path) / (1024 * 1024)
            print(f"📦 Executable created: {exe_path} ({size_mb:.1f} MB)")
        
        # Copy additional files to dist folder AFTER build succeeds
        print("\n📋 Copying config files to dist...")
        config_files = [".env", "lab_config.json", "config.json", "database.json"]
        
        for file_name in config_files:
            if os.path.exists(file_name):
                shutil.copy2(file_name, "dist/")
                print(f"✅ Copied {file_name} to dist folder")
            else:
                print(f"⚠️ {file_name} not found - skipping")
                
        return True
            
    except subprocess.CalledProcessError as e:
        print(f"❌ Build failed with return code: {e.returncode}")
        return False
    except Exception as e:
        print(f"❌ Build error: {e}")
        return False

if __name__ == "__main__":
    print("🧪 FastAPI Backend Builder")
    print("=" * 40)
    
    # Check if main.py exists
    if not os.path.exists("main.py"):
        print("❌ main.py not found! Make sure you're in the backend directory.")
        input("Press Enter to exit...")
        sys.exit(1)
    
    success = build_backend()
    
    if success:
        print("\n🎉 Build completed successfully!")
        print("📁 Files are in the 'dist' folder")
        print("🚀 Test the executable: cd dist && lab_backend.exe")
    else:
        print("\n💥 Build failed!")
    
    input("\nPress Enter to exit...")
    sys.exit(0 if success else 1)