# modules/twotone_module.py - Two-Tone Testing Backend Module

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import os
import json
import datetime
import jwt
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from dotenv import load_dotenv
import numpy as np
import time
from fpdf import FPDF
from pathlib import Path
import uuid

# Load environment variables
load_dotenv()

# Router for two-tone testing
twotone_router = APIRouter()

# Security
security = HTTPBearer()
SECRET_KEY = os.getenv('SECRET_KEY', 'default-dev-key-change-in-production')

# File storage configuration
RESULTS_DIR = Path('./test_results/twotone')
GRAPHS_DIR = RESULTS_DIR / 'graphs'
REPORTS_DIR = RESULTS_DIR / 'reports'

# Create directories if they don't exist
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
GRAPHS_DIR.mkdir(parents=True, exist_ok=True)
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# Database configuration
DATABASE_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'database': os.getenv('DB_NAME', 'MAQ_Lab_Manager'),
    'user': os.getenv('DB_USER', 'karthi'),
    'password': os.getenv('DB_PASSWORD', 'maq001')
}

# Instrument configuration
INSTRUMENT_ADDRESS = 'TCPIP0::169.254.187.99::inst0::INSTR'

# Database connection
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

# Authentication functions
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

# Utility functions
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

# Pydantic models
class TestConfigurationRequest(BaseModel):
    serial_number: str
    device_type: str
    input_rf_power: float
    operator: str
    notes: Optional[str] = ""

class TestResult(BaseModel):
    mixterm1: float
    fterm1: float
    mixterm2: float
    fterm2: float
    vpi: float
    test_result: str
    graph_path: str

class ReportRequest(BaseModel):
    serial_number: str
    device_type: str
    operator: str
    mixterm1: str
    fterm1: str
    mixterm2: str
    fterm2: str
    vpi: str
    result: str

# ESA Instrument Control Class
class TwoToneESAController:
    def __init__(self):
        self.analyzer = None
        self.connected = False
        
    def connect(self):
        """Connect to ESA instrument"""
        try:
            import pyvisa
            rm = pyvisa.ResourceManager()
            self.analyzer = rm.open_resource(INSTRUMENT_ADDRESS)
            self.connected = True
            print(f"✅ Connected to ESA at {INSTRUMENT_ADDRESS}")
            return True
        except Exception as e:
            print(f"❌ Failed to connect to ESA: {e}")
            self.connected = False
            return False
    
    def initialize_esa(self):
        """Initialize ESA with proper settings for two-tone test"""
        if not self.connected or not self.analyzer:
            raise Exception("ESA not connected")
        
        try:
            # ESA Setup for Two-Tone Test
            self.analyzer.write("FREQ:STAR 999.998 MHz")
            self.analyzer.write("FREQ:STOP 1.000002 GHz")
            self.analyzer.write("AVER:STATE ON")
            self.analyzer.write("AVER:TYPE LOG")
            self.analyzer.write("AVER:COUNT 1")
            
            # Turn off existing markers
            self.analyzer.write("CALC:MARK1 OFF")
            self.analyzer.write("CALC:MARK2 OFF") 
            self.analyzer.write("CALC:MARK3 OFF")
            self.analyzer.write("CALC:MARK4 OFF")
            
            print("✅ ESA initialized for two-tone testing")
            return True
        except Exception as e:
            print(f"❌ ESA initialization failed: {e}")
            raise Exception(f"ESA initialization failed: {str(e)}")
    
    def find_peaks(self):
        """Find the four peaks (mixterms and fundamentals)"""
        if not self.connected or not self.analyzer:
            raise Exception("ESA not connected")
        
        try:
            # Enable peak search for 4 peaks
            self.analyzer.write("CALC:MARK:FUNC:FPE:State ON")
            self.analyzer.write("CALC:MARK:FUNC:FPE 4")
            
            # Get peak values
            peak_values_str = self.analyzer.query("CALCulate:MARKer:FUNCtion:FPEaks:Y?")
            peak_values = peak_values_str.split(",")
            peak_values = [float(num) for num in peak_values]
            
            if len(peak_values) != 4:
                raise Exception(f"Expected 4 peaks, got {len(peak_values)}")
            
            print(f"✅ Found peaks: {peak_values}")
            return peak_values
        except Exception as e:
            print(f"❌ Peak detection failed: {e}")
            raise Exception(f"Peak detection failed: {str(e)}")
    
    def capture_graph(self, device_type: str, serial_number: str):
        """Capture and save the test graph"""
        if not self.connected or not self.analyzer:
            raise Exception("ESA not connected")
        
        try:
            # Generate unique filename
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            graph_filename = f"TwoToneGraph_{device_type}_{serial_number}_{timestamp}.png"
            local_path = GRAPHS_DIR / graph_filename
            instrument_path = f"C:/R_S/instr/user/{graph_filename}"
            
            # Save screenshot on instrument
            self.analyzer.write(f'MMEM:NAME "{instrument_path}"')
            self.analyzer.write('HCOP:DEST "MMEM"')
            self.analyzer.write('HCOP:IMM')
            
            # Wait for screenshot to complete
            time.sleep(2)
            
            # Retrieve screenshot as binary data
            screenshot = self.analyzer.query_binary_values(
                f'MMEM:DATA? "{instrument_path}"', 
                datatype='B', 
                container=bytearray
            )
            
            # Save locally
            with open(local_path, 'wb') as file:
                file.write(bytearray(screenshot))
            
            print(f"✅ Graph saved: {local_path}")
            return str(local_path)
        except Exception as e:
            print(f"❌ Graph capture failed: {e}")
            raise Exception(f"Graph capture failed: {str(e)}")

# Global ESA controller instance
esa_controller = TwoToneESAController()

# Database helper functions
def get_vpi_ranges_from_db(device_type: str):
    """Get Vπ ranges for device type from database"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT rf_vpi_min, rf_vpi_max 
                FROM twotone_test_Spec 
                WHERE device_type = %s
            """, (device_type,))
            row = cursor.fetchone()
            
            if row:
                return {"min_vpi": row[0], "max_vpi": row[1]}
            else:
                # Default ranges if not found in database
                print(f"⚠️ No Vπ ranges found for {device_type}, using defaults")
                return {"min_vpi": 1.0, "max_vpi": 10.0}
    except Exception as e:
        print(f"❌ Error fetching Vπ ranges: {e}")
        return {"min_vpi": 1.0, "max_vpi": 10.0}

def save_test_result(test_data: dict):
    """Save test result to database"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO twotone_test_results 
                (device_type, serial_number, rf_vpi_1ghz, mixterm1, mixterm2, 
                 fundamental_term1, fundamental_term2, result, operator, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                test_data['device_type'],
                test_data['serial_number'],
                test_data['vpi'],
                test_data['mixterm1'],
                test_data['mixterm2'],
                test_data['fterm1'],
                test_data['fterm2'],
                test_data['result'],
                test_data['operator'],
                test_data['notes']
            ))
            
            test_id = cursor.fetchone()[0]
            conn.commit()
            print(f"✅ Test result saved with ID: {test_id}")
            return test_id
    except Exception as e:
        print(f"❌ Error saving test result: {e}")
        raise Exception(f"Failed to save test result: {str(e)}")

def calculate_vpi(peak_values: list, input_rf_power_dbm: float):
    """Calculate Vπ from peak values and input RF power"""
    try:
        mixterm1, fterm1, fterm2, mixterm2 = peak_values
        
        # Convert input RF power to voltage
        voltage = np.sqrt((10 ** (input_rf_power_dbm / 10)) / 10)
        
        # Calculate Vπ using the two-tone algorithm
        x = ((fterm1 - mixterm1) + (fterm2 - mixterm2)) / 2
        y = 10 ** (x / 10.0)
        vpi = (y ** 0.25) * 1.11 * voltage
        
        return round(vpi, 3)
    except Exception as e:
        print(f"❌ Vπ calculation failed: {e}")
        raise Exception(f"Vπ calculation failed: {str(e)}")

# API Endpoints

@twotone_router.get("/status")
async def get_instrument_status(current_user: dict = Depends(get_current_user)):
    """Check ESA instrument connection status"""
    try:
        if not esa_controller.connected:
            connected = esa_controller.connect()
        else:
            connected = esa_controller.connected
        
        return {
            "connected": connected,
            "instrument_address": INSTRUMENT_ADDRESS,
            "status": "Connected" if connected else "Disconnected"
        }
    except Exception as e:
        return {
            "connected": False,
            "instrument_address": INSTRUMENT_ADDRESS,
            "status": f"Error: {str(e)}"
        }

@twotone_router.get("/device-types")
async def get_device_types(current_user: dict = Depends(get_current_user)):
    """Get available device types for two-tone testing"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT DISTINCT device_type 
                FROM twotone_test_Spec 
                ORDER BY device_type
            """)
            rows = cursor.fetchall()
            
            device_types = [row[0] for row in rows]
            
            # Add some default device types if none in database
            if not device_types:
                device_types = ['LNA2322', 'LNA2124', 'LNA6213', 'LNA6112', 'LNLVL-IM-Z']
            
            return {"device_types": device_types}
    except Exception as e:
        print(f"❌ Error fetching device types: {e}")
        # Return default types on error
        return {"device_types": ['LNA2322', 'LNA2124', 'LNA6213', 'LNA6112', 'LNLVL-IM-Z']}

@twotone_router.post("/initialize")
async def initialize_esa(current_user: dict = Depends(get_current_user)):
    """Initialize ESA for two-tone testing"""
    if current_user['role'] not in ['admin', 'operator']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        if not esa_controller.connected:
            if not esa_controller.connect():
                raise HTTPException(status_code=500, detail="Failed to connect to ESA")
        
        esa_controller.initialize_esa()
        
        log_action(current_user['user_id'], 'initialize_esa', 'twotone', 
                  "ESA initialized for two-tone testing")
        
        return {"success": True, "message": "ESA initialized successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@twotone_router.post("/run-test")
async def run_twotone_test(
    test_config: TestConfigurationRequest,
    current_user: dict = Depends(get_current_user)
):
    """Run two-tone test and return results"""
    if current_user['role'] not in ['admin', 'operator']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        # Ensure ESA is connected and initialized
        if not esa_controller.connected:
            if not esa_controller.connect():
                raise HTTPException(status_code=500, detail="Failed to connect to ESA")
        
        esa_controller.initialize_esa()
        
        # Find peaks
        peak_values = esa_controller.find_peaks()
        mixterm1, fterm1, fterm2, mixterm2 = peak_values
        
        # Calculate Vπ
        vpi = calculate_vpi(peak_values, test_config.input_rf_power)
        
        # Get pass/fail criteria
        vpi_ranges = get_vpi_ranges_from_db(test_config.device_type)
        min_vpi = vpi_ranges["min_vpi"]
        max_vpi = vpi_ranges["max_vpi"]
        
        # Determine pass/fail
        test_result = "PASS" if min_vpi <= vpi <= max_vpi else "FAIL"
        
        # Capture graph
        graph_path = esa_controller.capture_graph(test_config.device_type, test_config.serial_number)
        
        # Prepare test data for saving
        test_data = {
            'device_type': test_config.device_type,
            'serial_number': test_config.serial_number,
            'vpi': vpi,
            'mixterm1': mixterm1,
            'mixterm2': mixterm2,
            'fterm1': fterm1,
            'fterm2': fterm2,
            'result': test_result,
            'operator': test_config.operator,
            'notes': test_config.notes
        }
        
        # Save to database
        test_id = save_test_result(test_data)
        
        log_action(current_user['user_id'], 'run_twotone_test', 'twotone',
                  f"Test completed: {test_config.device_type} {test_config.serial_number} - {test_result}")
        
        return {
            "test_id": test_id,
            "mixterm1": mixterm1,
            "fterm1": fterm1,
            "mixterm2": mixterm2,
            "fterm2": fterm2,
            "vpi": vpi,
            "test_result": test_result,
            "graph_path": f"/modules/twotone/graph/{Path(graph_path).name}",
            "min_vpi": min_vpi,
            "max_vpi": max_vpi
        }
        
    except Exception as e:
        print(f"❌ Test execution failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@twotone_router.get("/history")
async def get_test_history(
    limit: int = 50,
    device_type: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get test history"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            where_clause = ""
            params = []
            
            if device_type:
                where_clause = "WHERE device_type = %s"
                params.append(device_type)
            
            query = f"""
                SELECT * FROM twotone_test_results 
                {where_clause}
                ORDER BY test_date DESC 
                LIMIT %s
            """
            params.append(limit)
            
            cursor.execute(query, params)
            rows = cursor.fetchall()
            
            tests = []
            for row in rows:
                tests.append({
                    "id": row['id'],
                    "device_type": row['device_type'],
                    "serial_number": row['serial_number'],
                    "vpi": float(row['rf_vpi_1ghz']) if row['rf_vpi_1ghz'] else 0,
                    "result": row['result'],
                    "operator": row['operator'],
                    "test_date": row['test_date'].isoformat() if row['test_date'] else None,
                    "notes": row['notes']
                })
            
            return {"tests": tests}
    except Exception as e:
        print(f"❌ Error fetching test history: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch test history")

@twotone_router.get("/graph/{filename}")
async def get_graph_image(filename: str):
    """Serve graph image files"""
    try:
        file_path = GRAPHS_DIR / filename
        if file_path.exists():
            return FileResponse(file_path)
        else:
            raise HTTPException(status_code=404, detail="Graph image not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@twotone_router.post("/generate-report")
async def generate_pdf_report(
    report_data: ReportRequest,
    current_user: dict = Depends(get_current_user)
):
    """Generate PDF test report"""
    try:
        # Create PDF
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=12)
        
        # Add title
        pdf.cell(200, 10, txt="Two-Tone Test Report", ln=True, align='C')
        pdf.ln(10)
        
        # Add date and operator info
        current_datetime = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        pdf.cell(200, 10, txt=f"Date/Time: {current_datetime}", ln=True)
        pdf.cell(200, 10, txt=f"Tested By: {report_data.operator}", ln=True)
        pdf.ln(10)
        
        # Add test details
        pdf.cell(200, 10, txt=f"Device Type: {report_data.device_type}", ln=True)
        pdf.cell(200, 10, txt=f"Serial Number: {report_data.serial_number}", ln=True)
        pdf.cell(200, 10, txt=f"Vπ Value: {report_data.vpi} V", ln=True)
        pdf.cell(200, 10, txt=f"Test Result: {report_data.result}", ln=True)
        pdf.ln(10)
        
        # Add measurement details
        pdf.cell(200, 10, txt="Measurement Details:", ln=True)
        pdf.cell(200, 10, txt=f"  Mix Term 1: {report_data.mixterm1} dBm", ln=True)
        pdf.cell(200, 10, txt=f"  F Term 1: {report_data.fterm1} dBm", ln=True)
        pdf.cell(200, 10, txt=f"  Mix Term 2: {report_data.mixterm2} dBm", ln=True)
        pdf.cell(200, 10, txt=f"  F Term 2: {report_data.fterm2} dBm", ln=True)
        
        # Save PDF
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        pdf_filename = f"1GHzVpi_Test_Report_{report_data.device_type}_{report_data.serial_number}_{timestamp}.pdf"
        pdf_path = REPORTS_DIR / pdf_filename
        pdf.output(str(pdf_path))
        
        log_action(current_user['user_id'], 'generate_report', 'twotone',
                  f"Generated report for {report_data.device_type} {report_data.serial_number}")
        
        return FileResponse(
            path=str(pdf_path),
            filename=pdf_filename,
            media_type='application/pdf'
        )
        
    except Exception as e:
        print(f"❌ Report generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {str(e)}")

# Initialize database tables
def init_twotone_tables():
    """Initialize two-tone testing tables"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
    
            
            # Test ranges table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS twotone_test_Spec (
                    device_type VARCHAR(100) PRIMARY KEY,
                    rf_vpi_min DECIMAL(8,3) NOT NULL,
                    rf_vpi_max DECIMAL(8,3) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Insert default test ranges if table is empty
            cursor.execute("SELECT COUNT(*) FROM twotone_test_Spec")
            if cursor.fetchone()[0] == 0:
                default_ranges = [
                    ('LNA2322', 4.0, 5.0),
                    ('LNA2124', 3.8, 4.8),
                    ('LNA6213', 5.0, 6.0),
                    ('LNA6112', 5.0, 6.0),
                    ('LNLVL-IM-Z', 1.7, 2.7),
                    ('LNQ4314', 5.5, 6.5)
                ]
                
                cursor.executemany("""
                    INSERT INTO twotone_test_Spec (device_type, rf_vpi_min, rf_vpi_max)
                    VALUES (%s, %s, %s)
                """, default_ranges)
            
            # Create indexes
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_twotone_results_device_type 
                ON twotone_test_results(device_type)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_twotone_results_test_date 
                ON twotone_test_results(test_date)
            """)
            
            conn.commit()
            print("✅ Two-tone testing tables initialized")
            
    except Exception as e:
        print(f"❌ Two-tone table initialization error: {e}")

# Initialize tables on module load
init_twotone_tables()

# Export router
__all__ = ['twotone_router']

print("✅ Two-tone testing module loaded successfully")