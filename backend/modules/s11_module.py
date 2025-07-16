# modules/s11_module.py - S11 Testing Module (Fixed Imports)

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import List, Optional
import pyvisa
import time
import numpy as np
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')
import os
import json
import uuid
import datetime
import asyncio
import pyodbc
from fpdf import FPDF
from concurrent.futures import ThreadPoolExecutor
import jwt
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Router for S11 module
s11_router = APIRouter()

# Security
security = HTTPBearer()
SECRET_KEY = os.getenv('SECRET_KEY', 'default-dev-key-change-in-production')

# Database configuration
DATABASE_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'database': os.getenv('DB_NAME', 'MAQ_Lab_Manager'),
    'user': os.getenv('DB_USER', 'karthi'),
    'password': os.getenv('DB_PASSWORD', 'maq001')
}

# Global variables
executor = ThreadPoolExecutor(max_workers=2)

# Database connection (local copy to avoid circular import)
@contextmanager
def get_db_connection():
    """Get PostgreSQL database connection"""
    conn = None
    try:
        conn = psycopg2.connect(**DATABASE_CONFIG)
        yield conn
    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database connection failed: {str(e)}")
    finally:
        if conn:
            conn.close()

# Authentication functions (local copy to avoid circular import)
def verify_jwt_token(token: str) -> dict:
    """Verify JWT token and return user data"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired. Please login again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token. Please login again.")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Get current user from JWT token"""
    return verify_jwt_token(credentials.credentials)

# Utility functions (local copies)
def log_action(user_id: int, action: str, module: str, details: str):
    """Log user action"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO system_logs (user_id, action, module, details)
                VALUES (%s, %s, %s, %s)
            """, (user_id, action, module, details))
            conn.commit()
    except Exception as e:
        print(f"Error logging action: {e}")

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

# Notification functions (simplified for now)
async def notify_module_users(module: str, message_type: str, data: dict):
    """Simplified notification function"""
    print(f"📢 S11 Notification - {message_type}: {data}")
    # In production, this would integrate with the WebSocket manager

def track_module_activity(token: str, module: str, operation: str):
    """Track module activity"""
    print(f"👤 S11 Activity: {operation}")

def end_module_activity(token: str, module: str):
    """End module activity"""
    print(f"👤 S11 Activity ended for {module}")

# Pydantic models
class TestParameters(BaseModel):
    device_type: str
    chips_no: str
    housing_sno: str
    housing_lno: str
    operator: str

class TestResult(BaseModel):
    test_id: str
    device_type: str
    chips_no: str
    housing_sno: str
    housing_lno: str
    operator: str
    result: str
    frequency_data: List[float]
    magnitude_data: List[float]
    limit_data: List[dict]
    plot_path: str
    timestamp: str

# VNA Controller Class
class VNAController:
    def __init__(self):
        self.rm = None
        self.vna = None
        self.is_connected = False
        self.lock = asyncio.Lock()
        
    async def connect(self):
        """Connect to VNA with thread safety"""
        async with self.lock:
            try:
                vna_address = os.getenv('VNA_ADDRESS', "TCPIP0::127.0.0.1::5025::SOCKET")
                print(f"🔌 Attempting to connect to VNA at {vna_address}...")
                
                self.rm = pyvisa.ResourceManager()
                self.vna = self.rm.open_resource(vna_address)
                self.vna.read_termination = '\n'
                self.vna.timeout = 10000
                
                # Test connection
                try:
                    idn = self.vna.query('*IDN?')
                    print(f"✅ Connected to VNA: {idn.strip()}")
                except:
                    print("✅ Connected to VNA (IDN query failed but connection established)")
                
                # Set frequency range
                self.vna.write('SENSe1:FREQuency:STARt 0.05E10')
                self.vna.write('SENSe1:FREQuency:STOP 4.00e10')
                await asyncio.sleep(1)
                
                if await self.setup_vna():
                    self.is_connected = True
                    print("✅ VNA connected and configured successfully")
                    return True
                else:
                    print("❌ VNA connection failed during setup")
                    return False
                    
            except Exception as e:
                print(f"❌ VNA connection error: {e}")
                self.is_connected = False
                return False
    
    async def setup_vna(self):
        """Configure VNA settings"""
        if not self.vna:
            return False
        try:
            print("⚙️  Configuring VNA parameters...")
            self.vna.write('DISP:WIND:SPL 1')
            self.vna.write('CALC1:PAR:COUN 1')
            self.vna.write("Sense1:Sweep:Points 801")
            self.vna.write('CALC1:PAR1:DEF S11')
            self.vna.write('CALC1:PAR1:SEL')
            self.vna.write('CALC1:FORM MLOG')
            self.vna.query('*OPC?')
            print("✅ VNA configuration completed")
            return True
        except Exception as e:
            print(f"❌ VNA setup error: {e}")
            return False
    
    async def disconnect(self):
        """Disconnect from VNA"""
        async with self.lock:
            try:
                if self.vna:
                    self.vna.close()
                if self.rm:
                    self.rm.close()
                self.is_connected = False
                print("🔌 VNA disconnected")
            except Exception as e:
                print(f"❌ VNA disconnect error: {e}")
    
    async def measure_s11(self):
        """Run S11 measurement with thread safety"""
        async with self.lock:
            print("📊 Starting S11 measurement...")
            if not self.vna or not self.is_connected:
                print("❌ VNA not connected - cannot run measurement")
                return [], []
            try:
                print("🔄 Triggering VNA sweep...")
                self.vna.write('CALC1:PAR1:SEL')
                self.vna.write('TRIG:SING')
                self.vna.query('*OPC?')
                
                print("📈 Retrieving measurement data...")
                mags11 = self.vna.query_ascii_values("CALC1:DATA:FDAT?")
                freqs11 = self.vna.query_ascii_values("SENS1:FREQ:DATA?")
                mags11 = mags11[::2]  # Take every second value
                
                print(f"✅ Measurement complete: {len(freqs11)} frequency points")
                return freqs11, mags11
            except Exception as e:
                print(f"❌ Measurement error: {e}")
                return [], []

# Global VNA instance
vna_controller = VNAController()

# Database functions for SQL Server (S11 limits)
def connect_to_s11_database():
    """Connect to SQL Server for S11 limits data"""
    try:
        conn = pyodbc.connect(
            'DRIVER={ODBC Driver 17 for SQL Server};'
            'SERVER=tcp:PSI-SVR-TQESQL,49172;'
            'DATABASE=modulator_assembly_lab;'
            'UID=karthi;'
            'PWD=modulatorassembly@PSI;',
            autocommit=True
        )
        return conn
    except pyodbc.Error as e:
        raise HTTPException(status_code=500, detail=f"S11 Database connection error: {str(e)}")

def get_chip_limits(device_type: str):
    """Get limits from SQL Server database"""
    try:
        conn = connect_to_s11_database()
        cursor = conn.cursor()
        
        query = """
        SELECT 
            CAST(DeviceType AS NVARCHAR(50)) AS DeviceType,
            CAST(Startfreq AS FLOAT) AS Startfreq,
            CAST(Stopfreq AS FLOAT) AS Stopfreq,
            CAST(S11min AS FLOAT) AS S11min,
            CAST(S11max AS FLOAT) AS S11max
        FROM S11values 
        WHERE DeviceType = ?
        ORDER BY Startfreq
        """
        
        cursor.execute(query, (device_type,))
        rows = cursor.fetchall()
        
        limit_data = []
        for row in rows:
            limit_data.append({
                "device_type": str(row[0]),
                "start_freq": float(row[1]),
                "stop_freq": float(row[2]),
                "s11_min": float(row[3]),
                "s11_max": float(row[4])
            })
        
        cursor.close()
        conn.close()
        
        print(f"📋 Retrieved {len(limit_data)} limit records for {device_type}")
        return limit_data
    except Exception as e:
        print(f"❌ Database error: {e}")
        return []

# S11 utility functions
def check_limits(freqs, mags, limit_data):
    """Check if measurements are within limits"""
    try:
        freqs_array = np.array(freqs)
        mags_array = np.array(mags)
        freqs_ghz = freqs_array / 1e9
        
        any_failures = False
        failure_details = []
        
        for limit in limit_data:
            freq_start = limit['start_freq']
            freq_end = limit['stop_freq']
            s11_max = limit['s11_max']
            
            mask = (freqs_ghz >= freq_start) & (freqs_ghz <= freq_end)
            if not np.any(mask):
                continue
                
            mags_in_range = mags_array[mask]
            violations = mags_in_range > s11_max
            
            if np.any(violations):
                any_failures = True
                max_violation = np.max(mags_in_range[violations])
                failure_details.append({
                    "freq_range": f"{freq_start}-{freq_end} GHz",
                    "limit": s11_max,
                    "max_measured": float(max_violation),
                    "violation": float(max_violation - s11_max)
                })
        
        result = "FAIL" if any_failures else "PASS"
        print(f"📊 Limit check result: {result}")
        if failure_details:
            print(f"❌ Failures: {failure_details}")
        
        return result, failure_details
    except Exception as e:
        print(f"❌ Limit check error: {e}")
        return "FAIL", [{"error": str(e)}]

def generate_plot(freqs, mags, limit_data, test_params, test_id):
    """Generate S11 measurement plot"""
    try:
        # Ensure results directory exists
        os.makedirs('results', exist_ok=True)
        
        fig, ax = plt.subplots(figsize=(12, 8))
        
        freqs_array = np.array(freqs)
        mags_array = np.array(mags)
        freqs_ghz = freqs_array / 1e9
        
        # Plot S11 measurement
        ax.plot(freqs_ghz, mags_array, label='S11 Measurement', color='blue', linewidth=2)
        
        # Plot limit lines
        colors = ['red', 'orange', 'green', 'purple', 'brown', 'pink', 'gray']
        color_idx = 0
        
        for limit in limit_data:
            freq_start = limit['start_freq']
            freq_stop = limit['stop_freq']
            s11_max = limit['s11_max']
            
            freq_range = np.linspace(freq_start, freq_stop, 100)
            ax.plot(freq_range, [s11_max] * len(freq_range), 
                    linestyle='-.', color=colors[color_idx % len(colors)],
                    linewidth=2, label=f"Max Limit ({freq_start}-{freq_stop} GHz)")
            color_idx += 1
        
        ax.set_xlabel('Frequency (GHz)', fontsize=14)
        ax.set_ylabel('S11 Magnitude (dB)', fontsize=14)
        ax.set_title(f'S11 Measurement for {test_params["device_type"]} - Chip: {test_params["chips_no"]}', fontsize=16, fontweight='bold')
        ax.grid(True, linestyle='--', alpha=0.7)
        ax.legend(loc='best', fontsize=10)
        
        # Add test info as text
        info_text = f"Housing S/N: {test_params['housing_sno']}\nHousing L/N: {test_params['housing_lno']}\nOperator: {test_params['operator']}"
        ax.text(0.02, 0.98, info_text, transform=ax.transAxes, fontsize=10,
                verticalalignment='top', bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.8))
        
        plt.tight_layout()
        
        plot_filename = f'S11graph_{test_id}.png'
        plot_path = os.path.join('results', plot_filename)
        plt.savefig(plot_path, dpi=150, bbox_inches='tight')
        plt.close()
        
        print(f"📊 Plot saved: {plot_path}")
        return plot_path
    except Exception as e:
        print(f"❌ Plot generation error: {e}")
        return None

def save_test_results_pg(test_data: dict, user_id: int):
    """Save test results to PostgreSQL"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Ensure S11 results table exists
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS s11_test_results (
                    id SERIAL PRIMARY KEY,
                    test_id VARCHAR(255) UNIQUE NOT NULL,
                    device_type VARCHAR(100) NOT NULL,
                    chips_no VARCHAR(100) NOT NULL,
                    housing_sno VARCHAR(100) NOT NULL,
                    housing_lno VARCHAR(100) NOT NULL,
                    operator VARCHAR(100) NOT NULL,
                    result VARCHAR(20) NOT NULL,
                    plot_path TEXT,
                    frequency_data TEXT,
                    magnitude_data TEXT,
                    limit_data TEXT,
                    failure_details TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_by INTEGER REFERENCES users(id)
                )
            """)
            
            insert_query = """
            INSERT INTO s11_test_results 
            (test_id, device_type, chips_no, housing_sno, housing_lno, operator, 
             result, plot_path, frequency_data, magnitude_data, limit_data, failure_details, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            
            values = (
                test_data['test_id'],
                test_data['device_type'],
                test_data['chips_no'],
                test_data['housing_sno'],
                test_data['housing_lno'],
                test_data['operator'],
                test_data['result'],
                test_data.get('plot_path'),
                json.dumps(test_data.get('frequency_data', [])),
                json.dumps(test_data.get('magnitude_data', [])),
                json.dumps(test_data.get('limit_data', [])),
                json.dumps(test_data.get('failure_details', [])),
                user_id
            )
            
            cursor.execute(insert_query, values)
            conn.commit()
            print(f"💾 Test results saved to PostgreSQL: {test_data['test_id']}")
            return True
    except Exception as e:
        print(f"❌ PostgreSQL save error: {e}")
        return False

# S11 API Endpoints
@s11_router.get("/status")
async def s11_module_status(current_user: dict = Depends(get_current_user)):
    """Get S11 module status"""
    return {
        "module": "s11",
        "vna_connected": vna_controller.is_connected,
        "status": "operational" if vna_controller.is_connected else "vna_disconnected",
        "active_users": 0  # Will be populated by main system
    }

@s11_router.get("/vna/status")
async def vna_status(current_user: dict = Depends(get_current_user)):
    """Get VNA connection status"""
    return {
        "connected": vna_controller.is_connected,
        "module": "s11"
    }

@s11_router.post("/vna/connect")
async def connect_vna(current_user: dict = Depends(get_current_user)):
    """Connect to VNA instrument"""
    if current_user['role'] == 'viewer':
        raise HTTPException(status_code=403, detail="Viewers cannot connect to VNA")
    
    try:
        # Track activity
        track_module_activity('', 's11', 'connecting_vna')
        
        success = await vna_controller.connect()
        status = "connected" if success else "disconnected"
        message = "VNA connected successfully" if success else "Failed to connect to VNA"
        
        # Update system status
        update_component_status("s11_vna", status, message)
        
        # Log action
        log_action(current_user['user_id'], 'vna_connect', 's11',
                  f"VNA connection {'successful' if success else 'failed'}")
        
        # Notify other S11 users
        await notify_module_users('s11', 'vna_status_change', {
            'connected': success,
            'user': current_user['username'],
            'message': message
        })
        
        end_module_activity('', 's11')
        
        return {
            "success": success, 
            "connected": vna_controller.is_connected,
            "message": message
        }
    except Exception as e:
        error_msg = f"Connection error: {str(e)}"
        update_component_status("s11_vna", "error", error_msg)
        log_action(current_user['user_id'], 'vna_connect_error', 's11', error_msg)
        
        return {
            "success": False,
            "connected": False,
            "message": error_msg
        }

@s11_router.get("/limits/{device_type}")
async def get_limits(device_type: str, current_user: dict = Depends(get_current_user)):
    """Get test limits for device type"""
    limits = get_chip_limits(device_type)
    if not limits:
        raise HTTPException(status_code=404, detail=f"No limits found for device type: {device_type}")
    
    log_action(current_user['user_id'], 'get_limits', 's11', f"Retrieved limits for {device_type}")
    return {"limits": limits}

@s11_router.post("/test/start")
async def start_test(
    test_params: TestParameters, 
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """Start S11 test"""
    if current_user['role'] == 'viewer':
        raise HTTPException(status_code=403, detail="Viewers cannot run tests")
    
    if not vna_controller.is_connected:
        raise HTTPException(status_code=400, detail="VNA not connected")
    
    test_id = str(uuid.uuid4())
    
    try:
        # Track module usage
        track_module_activity('', 's11', 'test_running')
        
        # Notify other users that a test is starting
        await notify_module_users('s11', 'test_started', {
            "user": current_user['username'],
            "test_id": test_id,
            "device_type": test_params.device_type,
            "chips_no": test_params.chips_no
        })
        
        log_action(current_user['user_id'], 'test_start', 's11',
                  f"Started S11 test for {test_params.device_type}")
        
        # Get limits
        limit_data = get_chip_limits(test_params.device_type)
        if not limit_data:
            raise HTTPException(status_code=404, detail=f"No limits found for device type: {test_params.device_type}")
        
        # Run measurement
        freqs, mags = await vna_controller.measure_s11()
        if not freqs or not mags:
            raise HTTPException(status_code=500, detail="Measurement failed")
        
        # Check limits
        result, failure_details = check_limits(freqs, mags, limit_data)
        
        # Generate plot
        plot_path = generate_plot(freqs, mags, limit_data, test_params.dict(), test_id)
        
        test_result = {
            "test_id": test_id,
            "device_type": test_params.device_type,
            "chips_no": test_params.chips_no,
            "housing_sno": test_params.housing_sno,
            "housing_lno": test_params.housing_lno,
            "operator": test_params.operator,
            "result": result,
            "frequency_data": freqs,
            "magnitude_data": mags,
            "limit_data": limit_data,
            "failure_details": failure_details,
            "plot_path": plot_path,
            "timestamp": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }
        
        # End module usage
        end_module_activity('', 's11')
        
        # Log completion
        log_action(current_user['user_id'], 'test_complete', 's11',
                  f"S11 test completed: {result} for {test_params.device_type}")
        
        # Notify completion
        await notify_module_users('s11', 'test_completed', {
            "user": current_user['username'],
            "test_id": test_id,
            "result": result,
            "device_type": test_params.device_type
        })
        
        return test_result
        
    except Exception as e:
        end_module_activity('', 's11')
        log_action(current_user['user_id'], 'test_error', 's11', f"Test failed: {str(e)}")
        
        # Notify error
        await notify_module_users('s11', 'test_error', {
            "user": current_user['username'],
            "test_id": test_id,
            "error": str(e)
        })
        
        raise HTTPException(status_code=500, detail=str(e))

@s11_router.post("/test/save")
async def save_test(test_data: dict, current_user: dict = Depends(get_current_user)):
    """Save test results to database"""
    try:
        success = save_test_results_pg(test_data, current_user['user_id'])
        
        if success:
            log_action(current_user['user_id'], 'test_save', 's11',
                      f"Saved test results for {test_data.get('device_type', 'unknown')}")
            
            # Notify users about save
            await notify_module_users('s11', 'test_saved', {
                "user": current_user['username'],
                "test_id": test_data.get('test_id'),
                "device_type": test_data.get('device_type')
            })
            
            return {"success": True, "message": "Test results saved successfully"}
        else:
            raise HTTPException(status_code=500, detail="Failed to save test results")
            
    except Exception as e:
        log_action(current_user['user_id'], 'test_save_error', 's11', f"Save failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Save error: {str(e)}")

@s11_router.get("/plot/{test_id}")
async def get_plot(test_id: str, current_user: dict = Depends(get_current_user)):
    """Get test plot file"""
    plot_path = os.path.join('results', f'S11graph_{test_id}.png')
    if not os.path.exists(plot_path):
        raise HTTPException(status_code=404, detail="Plot not found")
    return FileResponse(plot_path)

@s11_router.post("/pdf/generate")
async def generate_pdf_report(test_data: dict, current_user: dict = Depends(get_current_user)):
    """Generate PDF report"""
    try:
        # Ensure results directory exists
        os.makedirs('results', exist_ok=True)
        
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=12)
        
        # Title
        pdf.set_font("Arial", 'B', 16)
        pdf.cell(200, 10, txt="S11 Parameter Test Report", ln=True, align='C')
        pdf.ln(10)
        
        # Test Information
        pdf.set_font("Arial", 'B', 12)
        pdf.cell(200, 8, txt="Test Information", ln=True)
        pdf.set_font("Arial", size=10)
        pdf.cell(200, 6, txt=f"Date: {test_data['timestamp']}", ln=True)
        pdf.cell(200, 6, txt=f"Tested By: {test_data['operator']}", ln=True)
        pdf.cell(200, 6, txt=f"Test ID: {test_data['test_id']}", ln=True)
        pdf.ln(5)
        
        # Device Information
        pdf.set_font("Arial", 'B', 12)
        pdf.cell(200, 8, txt="Device Under Test", ln=True)
        pdf.set_font("Arial", size=10)
        pdf.cell(200, 6, txt=f"Device Type: {test_data['device_type']}", ln=True)
        pdf.cell(200, 6, txt=f"Chip Serial Number: {test_data['chips_no']}", ln=True)
        pdf.cell(200, 6, txt=f"Housing Serial Number: {test_data['housing_sno']}", ln=True)
        pdf.cell(200, 6, txt=f"Housing Lot Number: {test_data['housing_lno']}", ln=True)
        pdf.ln(5)
        
        # Test Result
        pdf.set_font("Arial", 'B', 14)
        result_color = (0, 128, 0) if test_data['result'] == 'PASS' else (255, 0, 0)
        pdf.set_text_color(*result_color)
        pdf.cell(200, 10, txt=f"Test Result: {test_data['result']}", ln=True)
        pdf.set_text_color(0, 0, 0)  # Reset to black
        pdf.ln(5)
        
        # Add plot if available
        if test_data.get('plot_path') and os.path.exists(test_data['plot_path']):
            pdf.set_font("Arial", 'B', 12)
            pdf.cell(200, 8, txt="S11 Measurement Chart", ln=True)
            pdf.ln(5)
            
            # Calculate image position to center it
            img_width = 180
            x_position = (210 - img_width) / 2  # A4 width is 210mm
            
            pdf.image(test_data['plot_path'], x=x_position, y=None, w=img_width)
        
        pdf_filename = f"S11_test_report_{test_data['test_id']}.pdf"
        pdf_path = os.path.join('results', pdf_filename)
        pdf.output(pdf_path)
        
        log_action(current_user['user_id'], 'pdf_generate', 's11',
                  f"Generated PDF for test {test_data['test_id']}")
        
        return FileResponse(pdf_path, filename=pdf_filename)
        
    except Exception as e:
        log_action(current_user['user_id'], 'pdf_error', 's11', f"PDF generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")

@s11_router.get("/test/history")
async def get_test_history(
    limit: int = 50,
    device_type: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get S11 test history"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            base_query = """
                SELECT test_id, device_type, chips_no, housing_sno, housing_lno, 
                       operator, result, timestamp, created_by
                FROM s11_test_results
            """
            
            if device_type:
                query = base_query + " WHERE device_type = %s ORDER BY timestamp DESC LIMIT %s"
                cursor.execute(query, (device_type, limit))
            else:
                query = base_query + " ORDER BY timestamp DESC LIMIT %s"
                cursor.execute(query, (limit,))
            
            rows = cursor.fetchall()
            
            history = []
            for row in rows:
                history.append({
                    "test_id": row[0],
                    "device_type": row[1],
                    "chips_no": row[2],
                    "housing_sno": row[3],
                    "housing_lno": row[4],
                    "operator": row[5],
                    "result": row[6],
                    "timestamp": str(row[7]),
                    "created_by": row[8]
                })
            
            return {"history": history, "count": len(history)}
            
    except Exception as e:
        print(f"❌ Error getting test history: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve test history")

@s11_router.get("/statistics")
async def get_s11_statistics(current_user: dict = Depends(get_current_user)):
    """Get S11 module statistics"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Total tests
            cursor.execute("SELECT COUNT(*) FROM s11_test_results")
            total_tests = cursor.fetchone()[0] or 0
            
            # Pass/Fail counts
            cursor.execute("SELECT result, COUNT(*) FROM s11_test_results GROUP BY result")
            result_counts = dict(cursor.fetchall())
            
            # Tests by device type
            cursor.execute("""
                SELECT device_type, COUNT(*) as count, 
                       SUM(CASE WHEN result = 'PASS' THEN 1 ELSE 0 END) as pass_count
                FROM s11_test_results 
                GROUP BY device_type 
                ORDER BY count DESC
            """)
            device_stats = []
            for row in cursor.fetchall():
                device_stats.append({
                    "device_type": row[0],
                    "total_tests": row[1],
                    "pass_count": row[2],
                    "pass_rate": (row[2] / row[1] * 100) if row[1] > 0 else 0
                })
            
            # Recent activity (last 24 hours)
            cursor.execute("""
                SELECT COUNT(*) FROM s11_test_results 
                WHERE timestamp > NOW() - INTERVAL '24 hours'
            """)
            recent_tests = cursor.fetchone()[0] or 0
            
            return {
                "total_tests": total_tests,
                "pass_count": result_counts.get('PASS', 0),
                "fail_count": result_counts.get('FAIL', 0),
                "pass_rate": (result_counts.get('PASS', 0) / total_tests * 100) if total_tests > 0 else 0,
                "device_statistics": device_stats,
                "recent_tests_24h": recent_tests,
                "vna_connected": vna_controller.is_connected
            }
            
    except Exception as e:
        print(f"❌ Error getting statistics: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve statistics")

@s11_router.post("/vna/disconnect")
async def disconnect_vna(current_user: dict = Depends(get_current_user)):
    """Disconnect from VNA"""
    if current_user['role'] == 'viewer':
        raise HTTPException(status_code=403, detail="Viewers cannot disconnect VNA")
    
    try:
        await vna_controller.disconnect()
        
        # Update system status
        update_component_status("s11_vna", "disconnected", "VNA manually disconnected")
        
        # Log action
        log_action(current_user['user_id'], 'vna_disconnect', 's11', "VNA disconnected")
        
        # Notify other S11 users
        await notify_module_users('s11', 'vna_status_change', {
            'connected': False,
            'user': current_user['username'],
            'message': 'VNA disconnected'
        })
        
        return {
            "success": True,
            "connected": vna_controller.is_connected,
            "message": "VNA disconnected successfully"
        }
        
    except Exception as e:
        error_msg = f"Disconnect error: {str(e)}"
        log_action(current_user['user_id'], 'vna_disconnect_error', 's11', error_msg)
        raise HTTPException(status_code=500, detail=error_msg)

# Module cleanup on shutdown
async def cleanup_s11_module():
    """Clean up S11 module resources"""
    print("🧹 Cleaning up S11 module...")
    try:
        await vna_controller.disconnect()
        print("✅ S11 VNA disconnected")
    except Exception as e:
        print(f"❌ S11 cleanup error: {e}")

# Export the router and cleanup function
__all__ = ['s11_router', 'cleanup_s11_module']

print("✅ S11 module loaded successfully")