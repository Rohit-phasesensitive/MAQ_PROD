# main.py - Enhanced Core Lab Management System with Module Support
#main.py
from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import List, Optional, Dict, Set
import jwt
import hashlib
import datetime
import json
import asyncio
import psycopg2
import psycopg2.extras
import psycopg2.pool
import os
import uuid
import threading
from contextlib import contextmanager
from dotenv import load_dotenv
from collections import defaultdict
from modules.manufacturing_workflow_module import router as manufacturing_router
# from apps import app as analytics_app
# import os
# from fastapi import FastAPI, HTTPException
# from fastapi.middleware.cors import CORSMiddleware
import databases
# from apps import router as analytics_router
from apps import create_analytics_router
# from apps import app
# Load environment variables
load_dotenv()

app = FastAPI(title="MAQ Lab Manager API", version="1.0.0")

# Module routers will be loaded after app initialization to avoid circular imports
s11_router = None
chip_inspection_router = None
housing_inspection_router = None
mo_router = None  # Add Purchase Order & Manufacturing Order router
# app.mount("/analytics", analytics_app)

# Enhanced CORS middleware for multiple concurrent users
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# Security
security = HTTPBearer()
SECRET_KEY = os.getenv('SECRET_KEY', 'default-dev-key-change-in-production')

# Enhanced Database Configuration with Connection Pooling
DATABASE_CONFIG = {
    'host': os.getenv('DB_HOST', '192.168.99.121'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', 'karthi')
}

# Global connection pool for concurrent access
db_pool = None

def init_db_pool():
    """Initialize database connection pool for concurrent users"""
    global db_pool
    try:
        db_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=20,  # Support up to 20 concurrent connections
            **DATABASE_CONFIG
        )
        print("✅ Database connection pool initialized (2-20 connections)")
        return True
    except Exception as e:
        print(f"❌ Database pool initialization failed: {e}")
        return False

@contextmanager
def get_db_connection():
    """Get PostgreSQL database connection from pool"""
    if not db_pool:
        init_db_pool()
    
    conn = None
    try:
        conn = db_pool.getconn()
        yield conn
    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database connection failed: {str(e)}")
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    finally:
        if conn:
            db_pool.putconn(conn)
# analytics_router = create_analytics_router(get_db_connection)
# app.include_router(analytics_router)
analytics_router = create_analytics_router(get_db_connection)
app.include_router(analytics_router, prefix="/api", tags=["Analytics"])
# User Session Management for Concurrent Access
class UserSessionManager:
    def __init__(self):
        self.active_sessions: Dict[str, dict] = {}  # token -> session_info
        self.user_activities: Dict[int, dict] = {}  # user_id -> activity_info
        self.module_usage: Dict[str, Set[int]] = defaultdict(set)  # module -> set of user_ids
        self.lock = threading.Lock()
    
    def create_session(self, user_id: int, username: str, token: str):
        """Create new user session"""
        with self.lock:
            session_info = {
                'user_id': user_id,
                'username': username,
                'login_time': datetime.datetime.utcnow(),
                'last_activity': datetime.datetime.utcnow(),
                'active_modules': set(),
                'current_operations': {}
            }
            self.active_sessions[token] = session_info
            self.user_activities[user_id] = session_info
            print(f"👤 Session created for {username} (ID: {user_id})")
    
    def update_activity(self, token: str, module: str = None, operation: str = None):
        """Update user activity"""
        with self.lock:
            if token in self.active_sessions:
                session = self.active_sessions[token]
                session['last_activity'] = datetime.datetime.utcnow()
                
                if module:
                    session['active_modules'].add(module)
                    self.module_usage[module].add(session['user_id'])
                
                if operation:
                    session['current_operations'][module] = operation
    
    def end_module_usage(self, token: str, module: str):
        """End module usage for user"""
        with self.lock:
            if token in self.active_sessions:
                session = self.active_sessions[token]
                session['active_modules'].discard(module)
                self.module_usage[module].discard(session['user_id'])
                session['current_operations'].pop(module, None)
    
    def get_active_users(self) -> List[dict]:
        """Get list of currently active users"""
        with self.lock:
            active_users = []
            cutoff_time = datetime.datetime.utcnow() - datetime.timedelta(minutes=30)
            
            for session in self.active_sessions.values():
                if session['last_activity'] > cutoff_time:
                    active_users.append({
                        'user_id': session['user_id'],
                        'username': session['username'],
                        'login_time': session['login_time'].isoformat(),
                        'last_activity': session['last_activity'].isoformat(),
                        'active_modules': list(session['active_modules']),
                        'current_operations': session['current_operations']
                    })
            
            return active_users
    
    def get_module_users(self, module: str) -> List[dict]:
        """Get users currently using a specific module"""
        with self.lock:
            users = []
            for user_id in self.module_usage[module]:
                if user_id in self.user_activities:
                    session = self.user_activities[user_id]
                    users.append({
                        'user_id': user_id,
                        'username': session['username'],
                        'operation': session['current_operations'].get(module, 'active')
                    })
            return users
    
    def cleanup_inactive_sessions(self):
        """Remove inactive sessions (older than 30 minutes)"""
        with self.lock:
            cutoff_time = datetime.datetime.utcnow() - datetime.timedelta(minutes=30)
            
            inactive_tokens = []
            for token, session in self.active_sessions.items():
                if session['last_activity'] < cutoff_time:
                    inactive_tokens.append(token)
            
            for token in inactive_tokens:
                session = self.active_sessions.pop(token, None)
                if session:
                    user_id = session['user_id']
                    username = session['username']
                    self.user_activities.pop(user_id, None)
                    for module_users in self.module_usage.values():
                        module_users.discard(user_id)
                    print(f"🧹 Cleaned up inactive session for {username}")

# Global session manager
session_manager = UserSessionManager()

# Enhanced WebSocket Connection Manager
class ConcurrentConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}  # token -> websocket
        self.user_connections: Dict[int, WebSocket] = {}    # user_id -> websocket
        self.module_subscribers: Dict[str, Set[int]] = defaultdict(set)  # module -> user_ids

    async def connect(self, websocket: WebSocket, user_id: int, token: str):
        await websocket.accept()
        self.active_connections[token] = websocket
        self.user_connections[user_id] = websocket
        print(f"🔌 WebSocket connected for user {user_id}")

    def disconnect(self, websocket: WebSocket, user_id: int, token: str):
        self.active_connections.pop(token, None)
        self.user_connections.pop(user_id, None)
        for subscribers in self.module_subscribers.values():
            subscribers.discard(user_id)
        print(f"🔌 WebSocket disconnected for user {user_id}")

    async def send_personal_message(self, message: dict, user_id: int):
        """Send message to specific user"""
        if user_id in self.user_connections:
            try:
                await self.user_connections[user_id].send_text(json.dumps(message))
            except:
                self.user_connections.pop(user_id, None)

    async def broadcast_to_module_users(self, message: dict, module: str):
        """Send message to all users of a specific module"""
        users = list(self.module_subscribers[module])
        for user_id in users:
            await self.send_personal_message(message, user_id)

    async def broadcast_system_message(self, message: dict):
        """Send message to all connected users"""
        disconnected_users = []
        for user_id, websocket in self.user_connections.items():
            try:
                await websocket.send_text(json.dumps(message))
            except:
                disconnected_users.append(user_id)
        
        for user_id in disconnected_users:
            self.user_connections.pop(user_id, None)

    def subscribe_to_module(self, user_id: int, module: str):
        """Subscribe user to module notifications"""
        self.module_subscribers[module].add(user_id)

    def unsubscribe_from_module(self, user_id: int, module: str):
        """Unsubscribe user from module notifications"""
        self.module_subscribers[module].discard(user_id)

manager = ConcurrentConnectionManager()

# Pydantic models
class LoginRequest(BaseModel):
    username: str
    password: str

class User(BaseModel):
    id: int
    username: str
    email: str
    role: str
    created_at: str
    last_login: Optional[str]
    is_active: bool

class SystemStatusResponse(BaseModel):
    overall: str
    database: str
    active_users: int
    modules_status: dict

# Enhanced authentication functions
def hash_password(password: str) -> str:
    """Hash password using SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password: str, hashed: str) -> bool:
    """Verify password against hash"""
    return hash_password(password) == hashed

def create_jwt_token(user_data: dict) -> str:
    """Create JWT token for user with 10-minute expiration"""
    payload = {
        **user_data,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(minutes=10),
        'iat': datetime.datetime.utcnow(),
        'jti': str(uuid.uuid4())
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

def verify_jwt_token(token: str) -> dict:
    """Verify JWT token and update session activity"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        # Update session activity
        session_manager.update_activity(token)
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired. Please login again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token. Please login again.")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Get current user and track activity"""
    token = credentials.credentials
    user_data = verify_jwt_token(token)
    
    # Ensure session exists
    if token not in session_manager.active_sessions:
        session_manager.create_session(
            user_data['user_id'], 
            user_data['username'], 
            token
        )
    
    return user_data

# Database helper functions
def get_user_by_username(username: str) -> Optional[dict]:
    """Get user by username"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cursor.execute(
                "SELECT * FROM users WHERE username = %s AND is_active = TRUE", 
                (username,)
            )
            row = cursor.fetchone()
            return dict(row) if row else None
    except Exception as e:
        print(f"Error getting user: {e}")
        return None

def update_last_login(user_id: int):
    """Update user's last login timestamp"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = %s",
                (user_id,)
            )
            conn.commit()
    except Exception as e:
        print(f"Error updating last login: {e}")

def log_action(user_id: int, action: str, module: str, details: str):
    """Enhanced logging with concurrent access tracking"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Get current active users for context
            active_users = len(session_manager.get_active_users())
            module_users = len(session_manager.get_module_users(module))
            
            enhanced_details = f"{details} | Active users: {active_users} | Module users: {module_users}"
            
            cursor.execute("""
                INSERT INTO system_logs (user_id, action, module, details)
                VALUES (%s, %s, %s, %s)
            """, (user_id, action, module, enhanced_details))
            conn.commit()
    except Exception as e:
        print(f"Error logging action: {e}")

def get_system_status() -> dict:
    """Get enhanced system status with module information"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Get component statuses
            cursor.execute("SELECT component, status FROM system_status")
            statuses = dict(cursor.fetchall())
            
            # Get active users count
            active_users = len(session_manager.get_active_users())
            
            # Get module usage statistics - Updated to include mo
            modules_status = {}
            for module in ['s11', 'chip_inspection', 'housing_inspection', 'rf', 'power', 'mo']:
                module_users = session_manager.get_module_users(module)
                modules_status[module] = {
                    'active_users': len(module_users),
                    'users': [user['username'] for user in module_users],
                    'status': 'active' if module_users else 'available'
                }
            
            # Determine overall status
            if statuses.get('database') == 'connected':
                overall = 'healthy'
            else:
                overall = 'error'
            
            return {
                'overall': overall,
                'database': statuses.get('database', 'unknown'),
                'active_users': active_users,
                'modules_status': modules_status,
                'session_info': {
                    'total_sessions': len(session_manager.active_sessions),
                    'active_modules': list(session_manager.module_usage.keys())
                }
            }
    except Exception as e:
        print(f"Error getting system status: {e}")
        return {
            'overall': 'error',
            'database': 'error',
            'active_users': 0,
            'modules_status': {}
        }

def update_component_status(component: str, status: str, message: str):
    """Update component status"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE system_status 
                SET status = %s, message = %s, last_updated = CURRENT_TIMESTAMP
                WHERE component = %s
            """, (status, message, component))
            conn.commit()
    except Exception as e:
        print(f"Error updating component status: {e}")

def init_database():
    """Initialize PostgreSQL database with required tables"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Users table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(50) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    email VARCHAR(100),
                    role VARCHAR(20) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP,
                    is_active BOOLEAN DEFAULT TRUE
                )
            """)
            
            # Sessions table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    session_token VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP
                )
            """)
            
            # Enhanced system logs table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS system_logs (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    action VARCHAR(100),
                    module VARCHAR(50),
                    details TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Enhanced system status table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS system_status (
                    id SERIAL PRIMARY KEY,
                    component VARCHAR(50) UNIQUE,
                    status VARCHAR(20),
                    message TEXT,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Check if users exist, if not create default users
            cursor.execute("SELECT COUNT(*) FROM users")
            user_count = cursor.fetchone()[0]
            
            if user_count == 0:
                print("📝 Creating default users...")
                default_users = [
                    ('admin', hash_password('admin123'), 'admin@lab.com', 'admin'),
                    ('operator', hash_password('op123'), 'operator@lab.com', 'operator'),
                    ('viewer', hash_password('view123'), 'viewer@lab.com', 'viewer')
                ]
                
                cursor.executemany("""
                    INSERT INTO users (username, password_hash, email, role)
                    VALUES (%s, %s, %s, %s)
                """, default_users)
                print("✅ Default users created")
            
            # Initialize system status
            cursor.execute("SELECT COUNT(*) FROM system_status")
            status_count = cursor.fetchone()[0]
            
            if status_count == 0:
                print("📝 Creating default system status...")
                default_status = [
                    ('database', 'connected', 'Database operational'),
                    ('storage', 'healthy', 'Storage system operational'),
                    ('s11_vna', 'disconnected', 'S11 VNA not connected'),
                    
                ]
                
                cursor.executemany("""
                    INSERT INTO system_status (component, status, message)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (component) DO NOTHING
                """, default_status)
                print("✅ Default system status created")
            
            conn.commit()
            print("✅ PostgreSQL database initialized successfully")
            
    except Exception as e:
        print(f"❌ Database initialization error: {e}")
        raise

# Include module routers
def load_modules():
    """Load test station modules after app initialization"""
    global s11_router, chip_inspection_router, housing_inspection_router, mo_router
    
    # Load S11 module
    try:
        from modules.s11_module import s11_router as s11_module_router
        s11_router = s11_module_router
        app.include_router(s11_router, prefix="/modules/s11", tags=["S11 Testing"])
        print("✅ S11 module loaded and registered")
    except ImportError as e:
        print(f"⚠️  S11 module not found: {e}")
    
    # Load Chip Inspection module
    try:
        from modules.chip_inspection_module import chip_inspection_router as chip_module_router
        chip_inspection_router = chip_module_router
        app.include_router(chip_inspection_router, prefix="/modules/chip-inspection", tags=["Chip Inspection"])
        print("✅ Chip Inspection module loaded and registered")
    except ImportError as e:
        print(f"⚠️  Chip Inspection module not found: {e}")
    
    # Load housing_inspection module (future)
    try:
        from modules.housing_inspection_module import housing_inspection_router as housing_inspection_module_router
        housing_inspection_router = housing_inspection_module_router
        app.include_router(housing_inspection_router, prefix="/modules/housing_inspection", tags=["housing_inspection Testing"])
        print("✅ housing_inspection module loaded and registered")
    except ImportError as e:
        print(f"⚠️  housing_inspection module not found: {e}")
    
    # Load Purchase Order & Manufacturing Order module - UPDATED
    try:
        from modules.manufacturing_orders_module import mo_router as mo_module_router
        mo_router = mo_module_router
        app.include_router(mo_router, prefix="/admin", tags=["Purchase Orders & Manufacturing Orders"])
        print("✅ Purchase Order & Manufacturing Order module loaded and registered")
    except ImportError as e:
        print(f"⚠️  Purchase Order & Manufacturing Order module not found: {e}")
    # Load Two-Tone Testing module
    try:
        from modules.twotone_module import twotone_router
        app.include_router(twotone_router, prefix="/modules/twotone", tags=["Two-Tone Testing"])
        print("✅ Two-tone testing module loaded and registered")
    except ImportError as e:
        print(f"⚠️  Two-tone testing module not found: {e}")
    # Load S21 Testing module
    try:
        from modules.S21_module import s21_router
        app.include_router(s21_router, prefix="/modules/s21", tags=["S-Parameter Testing"])
        print("✅ S21 testing module loaded and registered")
    except ImportError as e:
        print(f"⚠️  S21 testing module not found: {e}")
    
    try:
        from modules.dcvpitestmodule import modulator_router
        app.include_router(modulator_router, prefix="/api/modulator", tags=["Modulator Testing"])
        print("✅ Dc Vpi test module loaded and registered")
    except ImportError as e:
        print(f"⚠️  Dc Vpi test module not found: {e}")
    # In load_modules() function, update the PO/MO section:
    # try:
    #     from modules.manufacturing_workflow_module import po_mo_router as manufacturing_workflow_router
    #     manufacturing_workflow_router = manufacturing_workflow_router
    #     app.include_router(manufacturing_workflow_router, prefix="/api/manufacturing", tags=["Manufacturing Workflow"])
    #     print("✅ Manufacturing Workflow module loaded and registered")
    # except ImportError as e:
    #     print(f"⚠️  Manufacturing Workflow module not found: {e}")
            # Load Manufacturing Workflow module
   # Load Manufacturing Workflow module
    # Load Manufacturing Workflow module
    # Load Manufacturing Workflow module
    try:
        from modules.manufacturing_workflow_module import router as manufacturing_router, set_db_connection
        # Pass the database connection function to the module
        set_db_connection(get_db_connection)
        app.include_router(manufacturing_router, prefix="/api/manufacturing", tags=["Manufacturing Workflow"])
        print("✅ Manufacturing Workflow module loaded and registered")
    except ImportError as e:
        print(f"⚠️  Manufacturing Workflow module not found: {e}")
# Load modules after app and utilities are defined
load_modules()

# Core API Endpoints
@app.options("/{path:path}")
async def options_handler(path: str):
    """Handle OPTIONS requests for CORS preflight"""
    return {"message": "OK"}

@app.get("/")
async def root():
    return {
        "message": "MAQ Lab Manager API", 
        "version": "1.0.0",
        "features": ["Multi-user support", "Modular test stations", "Real-time notifications", "Purchase Order Management"],
        "active_modules": [
            module for module, router in [
                ("s11", s11_router), 
                ("chip_inspection", chip_inspection_router), 
                ("housing_inspection", housing_inspection_router),
                ("purchase_manufacturing_orders", mo_router)
            ] if router
        ]
    }

@app.post("/auth/login")
async def login(request: LoginRequest):
    """Enhanced login with session management"""
    print(f"Login attempt for user: {request.username}")
    
    user = get_user_by_username(request.username)
    
    if not user:
        print(f"User not found: {request.username}")
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    if not verify_password(request.password, user['password_hash']):
        print(f"Invalid password for user: {request.username}")
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    print(f"Login successful for user: {request.username}")
    
    # Create JWT token
    token_data = {
        'user_id': user['id'],
        'username': user['username'],
        'role': user['role']
    }
    token = create_jwt_token(token_data)
    
    # Create session
    session_manager.create_session(user['id'], user['username'], token)
    
    # Update last login
    update_last_login(user['id'])
    
    # Log login with concurrent user info
    active_count = len(session_manager.get_active_users())
    log_action(user['id'], 'login', 'auth', f"User logged in (Total active: {active_count})")
    
    return {
        "token": token,
        "user": {
            "id": user['id'],
            "username": user['username'],
            "email": user['email'],
            "role": user['role']
        }
    }

@app.get("/auth/verify")
async def verify_token(current_user: dict = Depends(get_current_user)):
    """Verify JWT token and return user info"""
    user = get_user_by_username(current_user['username'])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    
    exp = current_user.get('exp', 0)
    now = datetime.datetime.utcnow().timestamp()
    time_remaining = max(0, exp - now)
    
    return {
        "user": {
            "id": user['id'],
            "username": user['username'],
            "email": user['email'],
            "role": user['role']
        },
        "token_expires_in": int(time_remaining),
        "should_refresh": time_remaining < 300
    }

@app.post("/auth/refresh")
async def refresh_token(current_user: dict = Depends(get_current_user)):
    """Refresh JWT token"""
    try:
        user = get_user_by_username(current_user['username'])
        
        if not user or not user['is_active']:
            raise HTTPException(status_code=401, detail="User account is no longer active")
        
        token_data = {
            'user_id': user['id'],
            'username': user['username'],
            'role': user['role']
        }
        new_token = create_jwt_token(token_data)
        
        log_action(user['id'], 'token_refresh', 'auth', f"Token refreshed for user {user['username']}")
        
        return {
            "token": new_token,
            "user": {
                "id": user['id'],
                "username": user['username'],
                "email": user['email'],
                "role": user['role']
            },
            "expires_in": 600
        }
        
    except Exception as e:
        print(f"Token refresh error: {e}")
        raise HTTPException(status_code=401, detail="Unable to refresh token")

@app.get("/system/status")
async def system_status(current_user: dict = Depends(get_current_user)):
    """Get enhanced system status with module information"""
    return get_system_status()

@app.get("/system/active-users")
async def get_active_users(current_user: dict = Depends(get_current_user)):
    """Get currently active users (admin/operator only)"""
    if current_user['role'] not in ['admin', 'operator']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    return {
        "active_users": session_manager.get_active_users(),
        "total_count": len(session_manager.get_active_users())
    }

@app.get("/system/module-usage/{module}")
async def get_module_usage(module: str, current_user: dict = Depends(get_current_user)):
    """Get users currently using a specific module"""
    return {
        "module": module,
        "users": session_manager.get_module_users(module),
        "user_count": len(session_manager.get_module_users(module))
    }

@app.post("/system/status/{component}")
async def update_status(
    component: str, 
    status: str, 
    message: str = "",
    current_user: dict = Depends(get_current_user)
):
    """Update component status (admin only)"""
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    update_component_status(component, status, message)
    log_action(current_user['user_id'], 'update_status', 'system', f"Updated {component} status to {status}")
    
    # Broadcast status update to all connected clients
    await manager.broadcast_system_message({
        "type": "status_update",
        "component": component,
        "status": status,
        "message": message
    })
    
    return {"success": True}

@app.get("/users")
async def get_users(current_user: dict = Depends(get_current_user)):
    """Get all users (admin only)"""
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cursor.execute("SELECT id, username, email, role, created_at, last_login, is_active FROM users")
            rows = cursor.fetchall()
        
        users = []
        for row in rows:
            users.append({
                "id": row['id'],
                "username": row['username'],
                "email": row['email'],
                "role": row['role'],
                "created_at": str(row['created_at']),
                "last_login": str(row['last_login']) if row['last_login'] else None,
                "is_active": row['is_active']
            })
        
        return {"users": users}
    except Exception as e:
        print(f"Error getting users: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve users")

@app.get("/logs")
async def get_logs(
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get system logs"""
    if current_user['role'] not in ['admin', 'operator']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cursor.execute("""
                SELECT sl.*, u.username 
                FROM system_logs sl
                LEFT JOIN users u ON sl.user_id = u.id
                ORDER BY sl.timestamp DESC
                LIMIT %s
            """, (limit,))
            rows = cursor.fetchall()
        
        logs = []
        for row in rows:
            logs.append({
                "id": row['id'],
                "user_id": row['user_id'],
                "action": row['action'],
                "module": row['module'],
                "details": row['details'],
                "timestamp": str(row['timestamp']),
                "username": row['username']
            })
        
        return {"logs": logs}
    except Exception as e:
        print(f"Error getting logs: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve logs")

@app.websocket("/ws/notifications")
async def websocket_endpoint(websocket: WebSocket, token: str):
    """Enhanced WebSocket with module subscriptions"""
    try:
        user_data = verify_jwt_token(token)
        user_id = user_data['user_id']
        
        await manager.connect(websocket, user_id, token)
        
        # Send welcome message with current system status
        active_users = session_manager.get_active_users()
        await websocket.send_text(json.dumps({
            "type": "welcome",
            "message": f"Connected to lab system",
            "active_users_count": len(active_users),
            "your_session": {
                "user_id": user_id,
                "username": user_data['username']
            },
            "available_modules": ["s11", "chip_inspection", "housing_inspection", "purchase_manufacturing_orders"]
        }))
        
        # Listen for module subscriptions and keep connection alive
        while True:
            try:
                # Wait for message with timeout
                message = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                data = json.loads(message)
                
                if data.get("type") == "subscribe_module":
                    module = data.get("module")
                    manager.subscribe_to_module(user_id, module)
                    await websocket.send_text(json.dumps({
                        "type": "subscribed",
                        "module": module,
                        "message": f"Subscribed to {module} notifications"
                    }))
                
                elif data.get("type") == "unsubscribe_module":
                    module = data.get("module")
                    manager.unsubscribe_from_module(user_id, module)
                    await websocket.send_text(json.dumps({
                        "type": "unsubscribed",
                        "module": module,
                        "message": f"Unsubscribed from {module} notifications"
                    }))
                
                elif data.get("type") == "get_system_status":
                    status = get_system_status()
                    await websocket.send_text(json.dumps({
                        "type": "system_status",
                        "data": status
                    }))
                    
            except asyncio.TimeoutError:
                # Send keepalive ping
                await websocket.send_text(json.dumps({
                    "type": "ping",
                    "timestamp": datetime.datetime.utcnow().isoformat(),
                    "active_users": len(session_manager.get_active_users())
                }))
                
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": "Invalid JSON format"
                }))
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id, token)
        print(f"🔌 WebSocket disconnected for user {user_id}")
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(websocket, user_id, token)

# Background task to clean up inactive sessions
async def cleanup_sessions_periodically():
    """Background task to clean up inactive sessions every 5 minutes"""
    while True:
        await asyncio.sleep(300)  # 5 minutes
        try:
            session_manager.cleanup_inactive_sessions()
            active_count = len(session_manager.get_active_users())
            print(f"🧹 Session cleanup complete: {active_count} active users")
        except Exception as e:
            print(f"Session cleanup error: {e}")

# Background task to broadcast system stats
async def broadcast_system_stats():
    """Background task to broadcast system statistics every minute"""
    while True:
        await asyncio.sleep(60)  # 1 minute
        try:
            status = get_system_status()
            await manager.broadcast_system_message({
                "type": "system_stats_update",
                "data": status,
                "timestamp": datetime.datetime.utcnow().isoformat()
            })
        except Exception as e:
            print(f"System stats broadcast error: {e}")

# Module utility functions for shared access
async def notify_module_users(module: str, message_type: str, data: dict):
    """Utility function for modules to notify their users"""
    message = {
        "type": message_type,
        "module": module,
        "data": data,
        "timestamp": datetime.datetime.utcnow().isoformat()
    }
    await manager.broadcast_to_module_users(message, module)

def track_module_activity(token: str, module: str, operation: str):
    """Utility function for modules to track user activity"""
    session_manager.update_activity(token, module, operation)

def end_module_activity(token: str, module: str):
    """Utility function for modules to end user activity"""
    session_manager.end_module_usage(token, module)

# Startup and shutdown events
@app.on_event("startup")
async def startup_event():
    """Initialize systems on startup"""
    print("🚀 Starting  MAQ Lab Manager API ")
    print("=" * 60)
    
    # Initialize database pool
    if not init_db_pool():
        print("❌ Failed to initialize database pool")
        return
    
    # Test database connection
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT version();")
            version = cursor.fetchone()
            print(f"✅ PostgreSQL version: {version[0]}")
    except Exception as e:
        print(f"❌ Database connection test failed: {e}")
        return
    
    # Initialize database tables
    try:
        init_database()
        print("✅ Database tables initialized")
    except Exception as e:
        print(f"❌ Database initialization failed: {e}")
        return
    
    # Test user accounts
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT username, role FROM users WHERE is_active = TRUE")
            users = cursor.fetchall()
        
        print(f"✅ Found {len(users)} active users:")
        for username, role in users:
            print(f"  - {username} ({role})")
    except Exception as e:
        print(f"❌ User check failed: {e}")
    
    # Start background tasks
    print("🔄 Starting background tasks...")
    asyncio.create_task(cleanup_sessions_periodically())
    asyncio.create_task(broadcast_system_stats())
    
    # Module status check
    loaded_modules = []
    if s11_router:
        loaded_modules.append("S11 Testing")
    if chip_inspection_router:
        loaded_modules.append("Chip Inspection Module")
    if housing_inspection_router:
        loaded_modules.append("Housing Inspection Testing")
    if mo_router:
        loaded_modules.append("Purchase Order & Manufacturing Order Management")
    
    print(f"📋 Loaded modules: {', '.join(loaded_modules) if loaded_modules else 'None'}")
    
    # Print configuration
    print("\n🔧 System Configuration:")
    print(f"  📊 Database: {DATABASE_CONFIG['user']}@{DATABASE_CONFIG['host']}:{DATABASE_CONFIG['port']}/{DATABASE_CONFIG['database']}")
    print(f"  🔑 Secret Key: {'*' * 20}...{SECRET_KEY[-10:] if len(SECRET_KEY) > 10 else '***'}")
    print(f"  🌍 Environment: {os.getenv('ENVIRONMENT', 'development')}")
    
    print("\n🎯 API Endpoints:")
    print("  🌐 Main API:     http://localhost:8000")
    print("  📊 System:      http://localhost:8000/system/status")
    print("  👥 Users:       http://localhost:8000/users")
    print("  📝 Logs:        http://localhost:8000/logs")
    if loaded_modules:
        print("  🔬 Modules:")
        if s11_router:
            print("    - S11:       http://localhost:8000/modules/s11/")
        if chip_inspection_router:
            print("    - Chip Inspection: http://localhost:8000/modules/chip-inspection/")
        if housing_inspection_router:
            print("    - Housing Inspection: http://localhost:8000/modules/housing_inspection/")
        if mo_router:
            print("    - PO & MO:   http://localhost:8000/admin/")
    
    print("\n✅ System startup complete!")
    print("🎉 Ready for multi-user concurrent access!")

@app.on_event("shutdown")
async def shutdown_event():
    """Clean shutdown"""
    print("\n🛑 Shutting down MAQ Lab Manager API...")
    
    # Close database connections
    if db_pool:
        db_pool.closeall()
        print("💾 Database connection pool closed")
    
    # Disconnect all WebSocket connections
    for user_id, websocket in manager.user_connections.items():
        try:
            await websocket.close()
        except:
            pass
    print("🔌 All WebSocket connections closed")
    
    # Clear session data
    session_manager.active_sessions.clear()
    session_manager.user_activities.clear()
    session_manager.module_usage.clear()
    print("🧹 Session data cleared")
    
    print("✅ Shutdown complete")
app.include_router(manufacturing_router)
# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring"""
    try:
        # Test database connection
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
        
        return {
            "status": "healthy",
            "timestamp": datetime.datetime.utcnow().isoformat(),
            "database": "connected",
            "active_users": len(session_manager.get_active_users()),
            "modules": {
                "s11": "loaded" if s11_router else "not_loaded",
                "chip_inspection": "loaded" if chip_inspection_router else "not_loaded",
                "housing_inspection": "loaded" if housing_inspection_router else "not_loaded",
                "purchase_manufacturing_orders": "loaded" if mo_router else "not_loaded"
            }
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "timestamp": datetime.datetime.utcnow().isoformat(),
            "error": str(e)
        }

# Add these endpoints to your main.py file after the existing /users endpoint

from pydantic import EmailStr, validator
import re

# Enhanced Pydantic models for user management
class CreateUserRequest(BaseModel):
    username: str
    password: str
    email: str
    role: str
    
    @validator('username')
    def validate_username(cls, v):
        if len(v) < 3:
            raise ValueError('Username must be at least 3 characters long')
        if len(v) > 50:
            raise ValueError('Username must be less than 50 characters')
        if not re.match(r'^[a-zA-Z0-9_-]+$', v):
            raise ValueError('Username can only contain letters, numbers, hyphens, and underscores')
        return v
    
    @validator('password')
    def validate_password(cls, v):
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        if len(v) > 100:
            raise ValueError('Password must be less than 100 characters')
        return v
    
    @validator('email')
    def validate_email(cls, v):
        if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', v):
            raise ValueError('Invalid email format')
        return v
    
    @validator('role')
    def validate_role(cls, v):
        valid_roles = ['admin', 'operator', 'viewer']
        if v not in valid_roles:
            raise ValueError(f'Role must be one of: {", ".join(valid_roles)}')
        return v

class UpdateUserRequest(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    
    @validator('email')
    def validate_email(cls, v):
        if v is not None and not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', v):
            raise ValueError('Invalid email format')
        return v
    
    @validator('role')
    def validate_role(cls, v):
        if v is not None:
            valid_roles = ['admin', 'operator', 'viewer']
            if v not in valid_roles:
                raise ValueError(f'Role must be one of: {", ".join(valid_roles)}')
        return v

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    
    @validator('new_password')
    def validate_new_password(cls, v):
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        if len(v) > 100:
            raise ValueError('Password must be less than 100 characters')
        return v

# Helper functions for user management
def check_user_exists(username: str, email: str) -> dict:
    """Check if user with username or email already exists"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT username, email FROM users WHERE username = %s OR email = %s",
                (username, email)
            )
            result = cursor.fetchone()
            if result:
                existing_username, existing_email = result
                if existing_username == username:
                    return {"exists": True, "field": "username"}
                elif existing_email == email:
                    return {"exists": True, "field": "email"}
            return {"exists": False}
    except Exception as e:
        print(f"Error checking user existence: {e}")
        raise HTTPException(status_code=500, detail="Database error")

def get_user_by_id(user_id: int) -> Optional[dict]:
    """Get user by ID"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cursor.execute(
                "SELECT * FROM users WHERE id = %s", 
                (user_id,)
            )
            row = cursor.fetchone()
            return dict(row) if row else None
    except Exception as e:
        print(f"Error getting user by ID: {e}")
        return None

# User Management API Endpoints
@app.post("/admin/users")
async def create_user(
    request: CreateUserRequest,
    current_user: dict = Depends(get_current_user)
):
    """Create a new user (admin only)"""
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Check if user already exists
    existence_check = check_user_exists(request.username, request.email)
    if existence_check["exists"]:
        field = existence_check["field"]
        raise HTTPException(
            status_code=409, 
            detail=f"User with this {field} already exists"
        )
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Hash password and create user
            password_hash = hash_password(request.password)
            
            cursor.execute("""
                INSERT INTO users (username, password_hash, email, role)
                VALUES (%s, %s, %s, %s)
                RETURNING id, username, email, role, created_at, is_active
            """, (request.username, password_hash, request.email, request.role))
            
            new_user = cursor.fetchone()
            conn.commit()
            
            # Log the user creation
            log_action(
                current_user['user_id'], 
                'create_user', 
                'admin', 
                f"Created new user: {request.username} with role: {request.role}"
            )
            
            # Notify all admins about new user creation
            await manager.broadcast_system_message({
                "type": "user_created",
                "message": f"New user '{request.username}' created by {current_user['username']}",
                "data": {
                    "username": request.username,
                    "role": request.role,
                    "created_by": current_user['username']
                }
            })
            
            return {
                "success": True,
                "message": f"User '{request.username}' created successfully",
                "user": {
                    "id": new_user[0],
                    "username": new_user[1],
                    "email": new_user[2],
                    "role": new_user[3],
                    "created_at": str(new_user[4]),
                    "is_active": new_user[5]
                }
            }
            
    except Exception as e:
        print(f"Error creating user: {e}")
        raise HTTPException(status_code=500, detail="Failed to create user")

@app.put("/admin/users/{user_id}")
async def update_user(
    user_id: int,
    request: UpdateUserRequest,
    current_user: dict = Depends(get_current_user)
):
    """Update user information (admin only)"""
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Check if user exists
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Prevent admin from deactivating themselves
    if user_id == current_user['user_id'] and request.is_active is False:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    
    # Check email uniqueness if email is being updated
    if request.email and request.email != user['email']:
        existence_check = check_user_exists("__dummy__", request.email)
        if existence_check["exists"]:
            raise HTTPException(status_code=409, detail="Email already exists")
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Build dynamic update query
            update_fields = []
            update_values = []
            
            if request.email is not None:
                update_fields.append("email = %s")
                update_values.append(request.email)
            
            if request.role is not None:
                update_fields.append("role = %s")
                update_values.append(request.role)
            
            if request.is_active is not None:
                update_fields.append("is_active = %s")
                update_values.append(request.is_active)
            
            if not update_fields:
                raise HTTPException(status_code=400, detail="No fields to update")
            
            update_values.append(user_id)  # For WHERE clause
            
            cursor.execute(f"""
                UPDATE users 
                SET {', '.join(update_fields)}
                WHERE id = %s
                RETURNING id, username, email, role, created_at, last_login, is_active
            """, update_values)
            
            updated_user = cursor.fetchone()
            conn.commit()
            
            # Log the user update
            changes = []
            if request.email is not None:
                changes.append(f"email: {user['email']} -> {request.email}")
            if request.role is not None:
                changes.append(f"role: {user['role']} -> {request.role}")
            if request.is_active is not None:
                changes.append(f"active: {user['is_active']} -> {request.is_active}")
            
            log_action(
                current_user['user_id'], 
                'update_user', 
                'admin', 
                f"Updated user {user['username']}: {', '.join(changes)}"
            )
            
            # Notify about user update
            await manager.broadcast_system_message({
                "type": "user_updated",
                "message": f"User '{user['username']}' updated by {current_user['username']}",
                "data": {
                    "username": user['username'],
                    "changes": changes,
                    "updated_by": current_user['username']
                }
            })
            
            return {
                "success": True,
                "message": f"User '{user['username']}' updated successfully",
                "user": {
                    "id": updated_user[0],
                    "username": updated_user[1],
                    "email": updated_user[2],
                    "role": updated_user[3],
                    "created_at": str(updated_user[4]),
                    "last_login": str(updated_user[5]) if updated_user[5] else None,
                    "is_active": updated_user[6]
                }
            }
            
    except Exception as e:
        print(f"Error updating user: {e}")
        raise HTTPException(status_code=500, detail="Failed to update user")

@app.delete("/admin/users/{user_id}")
async def delete_user(
    user_id: int,
    current_user: dict = Depends(get_current_user)
):
    """Delete/deactivate user (admin only)"""
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Check if user exists
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Prevent admin from deleting themselves
    if user_id == current_user['user_id']:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Soft delete - just deactivate the user
            cursor.execute(
                "UPDATE users SET is_active = FALSE WHERE id = %s",
                (user_id,)
            )
            conn.commit()
            
            # Log the user deletion
            log_action(
                current_user['user_id'], 
                'delete_user', 
                'admin', 
                f"Deactivated user: {user['username']}"
            )
            
            # Notify about user deletion
            await manager.broadcast_system_message({
                "type": "user_deleted",
                "message": f"User '{user['username']}' deactivated by {current_user['username']}",
                "data": {
                    "username": user['username'],
                    "deleted_by": current_user['username']
                }
            })
            
            return {
                "success": True,
                "message": f"User '{user['username']}' has been deactivated"
            }
            
    except Exception as e:
        print(f"Error deleting user: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete user")

@app.post("/auth/change-password")
async def change_password(
    request: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user)
):
    """Allow users to change their own password"""
    user = get_user_by_username(current_user['username'])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Verify current password
    if not verify_password(request.current_password, user['password_hash']):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    
    # Check if new password is different
    if verify_password(request.new_password, user['password_hash']):
        raise HTTPException(status_code=400, detail="New password must be different from current password")
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Update password
            new_password_hash = hash_password(request.new_password)
            cursor.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s",
                (new_password_hash, current_user['user_id'])
            )
            conn.commit()
            
            # Log password change
            log_action(
                current_user['user_id'], 
                'change_password', 
                'auth', 
                f"Password changed for user: {current_user['username']}"
            )
            
            return {
                "success": True,
                "message": "Password changed successfully"
            }
            
    except Exception as e:
        print(f"Error changing password: {e}")
        raise HTTPException(status_code=500, detail="Failed to change password")

@app.get("/admin/users/check-availability")
async def check_user_availability(
    username: str = None,
    email: str = None,
    current_user: dict = Depends(get_current_user)
):
    """Check if username or email is available (admin only)"""
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not username and not email:
        raise HTTPException(status_code=400, detail="Username or email must be provided")
    
    result = {"available": True, "message": "Available"}
    
    if username:
        username_check = check_user_exists(username, "__dummy__")
        if username_check["exists"]:
            result = {"available": False, "message": "Username already exists"}
    
    if email and result["available"]:
        email_check = check_user_exists("__dummy__", email)
        if email_check["exists"]:
            result = {"available": False, "message": "Email already exists"}
    
    return result

# Export utility functions for modules
__all__ = [
    'get_db_connection',
    'get_current_user',
    'log_action',
    'notify_module_users',
    'track_module_activity',
    'end_module_activity',
    'session_manager',
    'manager'
]

# analytics_router = create_analytics_router(db)
# app.mount("/analytics", analytics_app)

if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting server...")
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=8000,
        workers=1,  # Use 1 worker for WebSocket support
        log_level="info"
    )