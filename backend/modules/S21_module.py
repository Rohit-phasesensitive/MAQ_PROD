# modules/s21_module.py - S-Parameter Testing Backend Module

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
import pandas as pd
import matplotlib.pyplot as plt
import time
import csv
from fpdf import FPDF
from pathlib import Path
import uuid

# Load environment variables
load_dotenv()

# Router for S-parameter testing
s21_router = APIRouter()

# Security
security = HTTPBearer()
SECRET_KEY = os.getenv('SECRET_KEY', 'default-dev-key-change-in-production')

# File storage configuration
RESULTS_DIR = Path('./test_results/s21')
GRAPHS_DIR = RESULTS_DIR / 'graphs'
REPORTS_DIR = RESULTS_DIR / 'reports'
RESOURCES_DIR = Path('./test_resources/s21')

# Create directories if they don't exist
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
GRAPHS_DIR.mkdir(parents=True, exist_ok=True)
REPORTS_DIR.mkdir(parents=True, exist_ok=True)
RESOURCES_DIR.mkdir(parents=True, exist_ok=True)

# Database configuration
DATABASE_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'database': os.getenv('DB_NAME', 'MAQ_Lab_Manager'),
    'user': os.getenv('DB_USER', 'karthi'),
    'password': os.getenv('DB_PASSWORD', 'maq001')
}

# VNA configuration
VNA_ADDRESS = 'TCPIP0::127.0.0.1::5025::SOCKET'

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
class SParamTestRequest(BaseModel):
    serial_number: str
    device_type: str
    product_number: Optional[str] = ""
    operator: str
    notes: Optional[str] = ""

class RippleTestRequest(BaseModel):
    serial_number: str
    device_type: str
    operator: str

class ReportRequest(BaseModel):
    serial_number: str
    device_type: str
    product_number: Optional[str] = ""
    operator: str
    s21_bandwidth: str
    frequency_3db: str
    ripple_result: str
    overall_result: str

# VNA Control Class
class SParamVNAController:
    def __init__(self):
        self.vna = None
        self.connected = False
        
    def connect(self):
        """Connect to VNA"""
        try:
            import pyvisa
            rm = pyvisa.ResourceManager()
            self.vna = rm.open_resource(VNA_ADDRESS)
            self.vna.read_termination = '\n'
            self.vna.timeout = 10000
            self.connected = True
            print(f"✅ Connected to VNA at {VNA_ADDRESS}")
            return True
        except Exception as e:
            print(f"❌ Failed to connect to VNA: {e}")
            self.connected = False
            return False
    
    def setup_vna(self):
        """Setup VNA for S-parameter measurements"""
        if not self.connected or not self.vna:
            raise Exception("VNA not connected")
        
        try:
            # Set frequency range
            self.vna.write('SENSe1:FREQuency:STARt 0.05E10')  # 0.5 GHz
            self.vna.write('SENSe1:FREQuency:STOP 4.00e10')   # 40 GHz
            time.sleep(1)
            
            # Setup display and measurements
            self.vna.write('DISP:WIND:SPL 2')     # Split display
            self.vna.write('CALC1:PAR:COUN 2')    # 2 parameters
            self.vna.write('CALC1:PAR1:DEF S11')  # Parameter 1: S11
            self.vna.write('CALC1:PAR2:DEF S21')  # Parameter 2: S21
            self.vna.write('CALC1:PAR1:SEL')      # Select S11
            self.vna.write('CALC1:FORM MLOG')     # Log magnitude format
            self.vna.query('*OPC?')               # Wait for completion
            
            print("✅ VNA setup completed")
            return True
        except Exception as e:
            print(f"❌ VNA setup failed: {e}")
            raise Exception(f"VNA setup failed: {str(e)}")
    
    def measure_s11(self):
        """Measure S11 parameters"""
        if not self.connected or not self.vna:
            raise Exception("VNA not connected")
        
        try:
            self.vna.write('CALC1:PAR1:SEL')  # Select S11
            self.vna.write('TRIG:SING')       # Single trigger
            self.vna.query('*OPC?')           # Wait for completion
            
            # Get data
            mags11 = self.vna.query_ascii_values("CALC1:DATA:FDAT?")
            freqs11 = self.vna.query_ascii_values("SENS1:FREQ:DATA?")
            
            # Extract magnitude data (every other point)
            mags11 = mags11[::2]
            
            print("✅ S11 measurement completed")
            return freqs11, mags11
        except Exception as e:
            print(f"❌ S11 measurement failed: {e}")
            raise Exception(f"S11 measurement failed: {str(e)}")
    
    def measure_s21(self, device_type: str, serial_number: str):
        """Measure S21 parameters and save data"""
        if not self.connected or not self.vna:
            raise Exception("VNA not connected")
        
        try:
            self.vna.write('CALC1:PAR2:SEL')  # Select S21
            self.vna.write('TRIG:SING')       # Single trigger
            self.vna.query('*OPC?')           # Wait for completion
            
            # Get data
            mags21 = self.vna.query_ascii_values("CALC1:DATA:FDAT?")
            freqs21 = self.vna.query_ascii_values("SENS1:FREQ:DATA?")
            
            # Convert frequencies to GHz
            freqs21_ghz = [freq / 1e9 for freq in freqs21]
            mags21 = mags21[::2]  # Extract magnitude data
            
            # Save raw S21 data to CSV
            current_date = time.strftime('%Y-%m-%d')
            filename = RESULTS_DIR / f'S21_data_{device_type}_{serial_number}_{current_date}_raw.csv'
            
            with open(filename, 'w', newline='') as file:
                writer = csv.writer(file)
                writer.writerow(['Frequency (GHz)', 'Magnitude (dB)'])
                for freq, mag in zip(freqs21_ghz, mags21):
                    writer.writerow([freq, mag])
            
            print("✅ S21 measurement completed")
            return freqs21, mags21
        except Exception as e:
            print(f"❌ S21 measurement failed: {e}")
            raise Exception(f"S21 measurement failed: {str(e)}")

# Global VNA controller instance
vna_controller = SParamVNAController()

# Analysis functions
def calculate_bandwidth(device_type: str, serial_number: str, freqs21, mags21):
    """Calculate S21 bandwidth with PD response correction"""
    try:
        current_date = time.strftime('%Y-%m-%d')
        
        # Load PD response data
        pd_response_file = RESOURCES_DIR / 'PDresponse_133_05_30.csv'
       
        
        df_diff = pd.read_csv(pd_response_file)
        mag_diff = df_diff['Magnitude Difference (dB)'].values
        
        # Load S21 data
        s21_data_file = RESULTS_DIR / f'S21_data_{device_type}_{serial_number}_{current_date}_raw.csv'
        df = pd.read_csv(s21_data_file)
        freq = df['Frequency (GHz)'].values
        mag = df['Magnitude (dB)'].values
        
        # Ensure arrays have same length
        length = min(len(mag_diff), len(mag))
        mag_diff = mag_diff[:length]
        mag = mag[:length]
        freq = freq[:length]
        
        # Correct magnitude
        corrected_mag = mag - mag_diff
        
        # Get linear fit range for device type
        linear_fit_file = RESOURCES_DIR / 'Linear_Fit_Range.csv'
        
        
        lf_df = pd.read_csv(linear_fit_file)
        device_data = lf_df[lf_df['DeviceType'] == device_type]
        
        if device_data.empty:
            # Use default values if device not found
            start_freq = 0.5
            end_freq = 30.0
        else:
            start_freq = device_data['StartFrequency(GHz)'].values[0]
            end_freq = device_data['StopFrequency(GHz)'].values[0]
        
        # Find indices for linear fit range
        start_index = np.argmin(np.abs(freq - start_freq))
        end_index = np.argmin(np.abs(freq - end_freq))
        
        # Linear fit
        x_fit = freq[start_index:end_index + 1]
        y_fit = corrected_mag[start_index:end_index + 1]
        slope, intercept = np.polyfit(x_fit, y_fit, 1)
        
        # Normalize magnitude
        normalized_mag = corrected_mag - intercept
        normalized_mag = normalized_mag - normalized_mag[0]
        
        # Find -3dB point
        max_magnitude = normalized_mag[0]
        db_3 = max_magnitude - 3
        
        indices_below_3db = np.where(normalized_mag <= db_3)[0]
        if len(indices_below_3db) > 0:
            closest_idx = indices_below_3db[0]
            frequency_at_3db = freq[closest_idx]
        else:
            frequency_at_3db = freq[-1]  # Use last frequency if no -3dB point found
        
        # Generate plot
        plot_path = create_sparam_plot(freq, normalized_mag, frequency_at_3db, 
                                     device_type, serial_number, freqs21, mags21)
        
        print(f"✅ Bandwidth calculation completed: {frequency_at_3db:.2f} GHz")
        return normalized_mag, frequency_at_3db, plot_path
        
    except Exception as e:
        print(f"❌ Bandwidth calculation failed: {e}")
        raise Exception(f"Bandwidth calculation failed: {str(e)}")

def create_sparam_plot(freq, normalized_mag, frequency_3db, device_type, serial_number, freqs11, mags11):
    """Create S-parameter plot"""
    try:
        current_date = time.strftime('%Y-%m-%d')
        
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 6))
        
        # S11 plot
        freqs11_ghz = [f/1e9 for f in freqs11[:len(mags11)]]
        ax1.plot(freqs11_ghz, mags11, label='S11', color='blue')
        ax1.set_xlabel('Frequency (GHz)')
        ax1.set_ylabel('Magnitude (dB)')
        ax1.set_title(f'S11 Measurement {device_type}_{serial_number}')
        ax1.grid(True)
        ax1.legend()
        
        # S21 plot with -3dB point
        ax2.plot(freq, normalized_mag, label='Normalized S21', color='green')
        ax2.scatter(frequency_3db, -3, color='red', zorder=5, s=100)
        ax2.text(frequency_3db, -3, f'{frequency_3db:.2f} GHz\n-3 dB', 
                verticalalignment='bottom', horizontalalignment='right', 
                color='red', fontsize=10, fontweight='bold')
        ax2.set_ylim(-40, 5)
        ax2.set_xlabel('Frequency (GHz)')
        ax2.set_ylabel('Magnitude (dB)')
        ax2.set_title(f'S21 Measurement {device_type}_{serial_number}')
        ax2.grid(True)
        ax2.legend()
        
        plt.tight_layout()
        
        plot_path = GRAPHS_DIR / f'Sparam_plot_{device_type}_{serial_number}_{current_date}.png'
        plt.savefig(plot_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        return str(plot_path)
    except Exception as e:
        print(f"❌ Plot creation failed: {e}")
        raise Exception(f"Plot creation failed: {str(e)}")

def run_ripple_test(device_type: str, serial_number: str):
    """Run ripple test analysis"""
    try:
        current_date = time.strftime('%Y-%m-%d')
        
        # Load S21 data
        s21_data_file = RESULTS_DIR / f'S21_data_{device_type}_{serial_number}_{current_date}_raw.csv'
        df = pd.read_csv(s21_data_file)
        freq = df['Frequency (GHz)'].values
        mag = df['Magnitude (dB)'].values
        
        # Load PD response
        pd_response_file = RESOURCES_DIR / 'PDresponse_133_05_30.csv'
        dfpd = pd.read_csv(pd_response_file)
        magpd = dfpd['Magnitude Difference (dB)'].values
        
        # Calculate normalized data
        normalized_data = mag - magpd
        
        # Load ripple check parameters
        ripple_file = RESOURCES_DIR / 'ripplecheck.csv'
       
        
        df_ripple = pd.read_csv(ripple_file)
        device_data = df_ripple[df_ripple["DeviceType"] == device_type]
        
        if device_data.empty:
            return "INVALID_DEVICE", None
        
        fit_order = int(device_data['fitorder'].iloc[0])
        start_freq = device_data['start'].iloc[0]
        end_freq = device_data['stop'].iloc[0]
        fit_x = np.array([float(x) for x in device_data['freqpoints'].iloc[0].split(",")])
        fit_py = np.array([float(y) for y in device_data['maglimit'].iloc[0].split(",")])
        fit_ny = -fit_py
        
        # Find analysis range
        start_index = np.argmin(np.abs(freq - start_freq))
        end_index = np.argmin(np.abs(freq - end_freq))
        
        # Polynomial fit
        analysis_freq = freq[start_index:end_index + 1]
        analysis_data = normalized_data[start_index:end_index + 1]
        coefficients = np.polyfit(analysis_freq, analysis_data, fit_order)
        polynomial = np.poly1d(coefficients)
        polynomial_values = polynomial(freq)
        
        # Calculate ripple data
        ripple_data = normalized_data - polynomial_values
        
        # Create ripple plot
        ripple_plot_path = create_ripple_plot(freq, ripple_data, start_freq, end_freq, 
                                            fit_py, fit_ny, device_type, serial_number)
        
        # Evaluate pass/fail
        fit_indices = [np.argmin(np.abs(freq - x)) for x in fit_x]
        pass_count = 0
        
        for i, idx in enumerate(fit_indices):
            if idx < len(ripple_data):
                y_value = ripple_data[idx]
                if fit_ny[i] <= y_value <= fit_py[i]:
                    pass_count += 1
        
        result = "PASS" if pass_count == len(fit_x) else "FAIL"
        
        print(f"✅ Ripple test completed: {result}")
        return result, ripple_plot_path
        
    except Exception as e:
        print(f"❌ Ripple test failed: {e}")
        raise Exception(f"Ripple test failed: {str(e)}")

def create_ripple_plot(freq, ripple_data, start_freq, end_freq, fit_py, fit_ny, device_type, serial_number):
    """Create ripple test plot"""
    try:
        current_date = time.strftime('%Y-%m-%d')
        
        fig, ax = plt.subplots(1, 1, figsize=(10, 6))
        
        # Plot ripple data
        ax.plot(freq, ripple_data, label='Ripple', color='green')
        
        # Create limit lines
        freq_mask = (freq >= start_freq) & (freq <= end_freq)
        plot_freq = freq[freq_mask]
        upper_limit = np.ones_like(plot_freq) * fit_py[0]
        lower_limit = np.ones_like(plot_freq) * fit_ny[0]
        
        ax.plot(plot_freq, upper_limit, label='Upper Limit', color='red', linestyle='--')
        ax.plot(plot_freq, lower_limit, label='Lower Limit', color='red', linestyle='--')
        
        ax.set_xlabel('Frequency (GHz)')
        ax.set_ylabel('Magnitude (dB)')
        ax.set_title(f'Ripple Test - {device_type}_{serial_number}')
        ax.grid(True)
        ax.legend()
        
        plot_path = GRAPHS_DIR / f'Ripple_plot_{device_type}_{serial_number}_{current_date}.png'
        plt.savefig(plot_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        return str(plot_path)
    except Exception as e:
        print(f"❌ Ripple plot creation failed: {e}")
        raise Exception(f"Ripple plot creation failed: {str(e)}")


# Database functions
def save_test_result(test_data: dict):
    """Save test result to database"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO s21_test_results 
                (device_type, serial_number, product_number, s21_bandwidth, frequency_3db, 
                 ripple_result, overall_result, operator, notes, sparam_plot_path, ripple_plot_path)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                test_data['device_type'],
                test_data['serial_number'],
                test_data.get('product_number', ''),
                test_data['s21_bandwidth'],
                test_data['frequency_3db'],
                test_data.get('ripple_result', ''),
                test_data['overall_result'],
                test_data['operator'],
                test_data['notes'],
                test_data.get('sparam_plot_path', ''),
                test_data.get('ripple_plot_path', '')
            ))
            
            test_id = cursor.fetchone()[0]
            conn.commit()
            print(f"✅ Test result saved with ID: {test_id}")
            return test_id
    except Exception as e:
        print(f"❌ Error saving test result: {e}")
        raise Exception(f"Failed to save test result: {str(e)}")

# API Endpoints

@s21_router.get("/status")
async def get_vna_status(current_user: dict = Depends(get_current_user)):
    """Check VNA connection status"""
    try:
        if not vna_controller.connected:
            connected = vna_controller.connect()
        else:
            connected = vna_controller.connected
        
        return {
            "connected": connected,
            "vna_address": VNA_ADDRESS,
            "status": "Connected" if connected else "Disconnected"
        }
    except Exception as e:
        return {
            "connected": False,
            "vna_address": VNA_ADDRESS,
            "status": f"Error: {str(e)}"
        }

@s21_router.get("/device-types")
async def get_device_types(current_user: dict = Depends(get_current_user)):
    """Get available device types for S-parameter testing"""
    try:
        # Try to get from ripple check file first
        ripple_file = RESOURCES_DIR / 'ripplecheck.csv'
        if ripple_file.exists():
            df = pd.read_csv(ripple_file)
            device_types = df['DeviceType'].unique().tolist()
        else:
            # Default device types
            device_types = ['LNLVL-IM-Z', 'LN65S-FC', 'LN53S-FC', 'LNP6118', 'LNP6119', 
                          'LNP4216', 'LNP4217', 'LNQ4314']
        
        return {"device_types": device_types}
    except Exception as e:
        print(f"❌ Error fetching device types: {e}")
        # Return default types on error
        return {"device_types": ['LNLVL-IM-Z', 'LN65S-FC', 'LN53S-FC', 'LNP6118', 'LNP6119']}

@s21_router.post("/run-sparam-test")
async def run_sparam_test(
    test_config: SParamTestRequest,
    current_user: dict = Depends(get_current_user)
):
    """Run S11 and S21 measurements"""
    if current_user['role'] not in ['admin', 'operator']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        # Ensure VNA is connected
        if not vna_controller.connected:
            if not vna_controller.connect():
                raise HTTPException(status_code=500, detail="Failed to connect to VNA")
        
        # Setup VNA
        vna_controller.setup_vna()
        
        # Run S11 measurement
        freqs11, mags11 = vna_controller.measure_s11()
        
        # Run S21 measurement
        freqs21, mags21 = vna_controller.measure_s21(test_config.device_type, test_config.serial_number)
        
        # Calculate bandwidth
        normalized_mag, frequency_3db, plot_path = calculate_bandwidth(
            test_config.device_type, test_config.serial_number, freqs21, mags21
        )
        
        log_action(current_user['user_id'], 'run_sparam_test', 's21',
                  f"S-Parameter test: {test_config.device_type} {test_config.serial_number}")
        
        return {
            "s11_data": {"frequencies": freqs11, "magnitudes": mags11},
            "s21_data": {"frequencies": freqs21, "magnitudes": mags21},
            "s21_bandwidth": frequency_3db,
            "frequency_3db": frequency_3db,
            "sparam_plot_path": f"/modules/s21/graph/{Path(plot_path).name}",
            "normalized_magnitude": normalized_mag.tolist()
        }
        
    except Exception as e:
        print(f"❌ S-Parameter test failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@s21_router.post("/run-ripple-test")
async def run_ripple_test_endpoint(
    ripple_config: RippleTestRequest,
    current_user: dict = Depends(get_current_user)
):
    """Run ripple test analysis"""
    if current_user['role'] not in ['admin', 'operator']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        # Run ripple test
        ripple_result, ripple_plot_path = run_ripple_test(
            ripple_config.device_type, ripple_config.serial_number
        )
        
        # Determine overall result
        overall_result = ripple_result if ripple_result != "INVALID_DEVICE" else "FAIL"
        
        # Save complete test result
        current_date = time.strftime('%Y-%m-%d')
        sparam_plot_path = GRAPHS_DIR / f'Sparam_plot_{ripple_config.device_type}_{ripple_config.serial_number}_{current_date}.png'
        
        # Get S21 bandwidth from previous test
        s21_data_file = RESULTS_DIR / f'S21_data_{ripple_config.device_type}_{ripple_config.serial_number}_{current_date}_raw.csv'
        if s21_data_file.exists():
            # Extract bandwidth from file or calculate it
            frequency_3db = 0.0  # This should be calculated from the actual data
        else:
            frequency_3db = 0.0
        
        test_data = {
            'device_type': ripple_config.device_type,
            'serial_number': ripple_config.serial_number,
            's21_bandwidth': frequency_3db,
            'frequency_3db': frequency_3db,
            'ripple_result': ripple_result,
            'overall_result': overall_result,
            'operator': ripple_config.operator,
            'notes': '',
            'sparam_plot_path': str(sparam_plot_path),
            'ripple_plot_path': ripple_plot_path
        }
        
        test_id = save_test_result(test_data)
        
        log_action(current_user['user_id'], 'run_ripple_test', 's21',
                  f"Ripple test: {ripple_config.device_type} {ripple_config.serial_number} - {ripple_result}")
        
        return {
            "test_id": test_id,
            "ripple_result": ripple_result,
            "overall_result": overall_result,
            "ripple_plot_path": f"/modules/s21/graph/{Path(ripple_plot_path).name}" if ripple_plot_path else None
        }
        
    except Exception as e:
        print(f"❌ Ripple test failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@s21_router.get("/history")
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
                SELECT * FROM s21_test_results 
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
                    "product_number": row['product_number'],
                    "s21_bandwidth": float(row['s21_bandwidth']) if row['s21_bandwidth'] else 0,
                    "frequency_3db": float(row['frequency_3db']) if row['frequency_3db'] else 0,
                    "ripple_result": row['ripple_result'],
                    "overall_result": row['overall_result'],
                    "operator": row['operator'],
                    "test_date": row['test_date'].isoformat() if row['test_date'] else None,
                    "notes": row['notes']
                })
            
            return {"tests": tests}
    except Exception as e:
        print(f"❌ Error fetching test history: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch test history")

@s21_router.get("/graph/{filename}")
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

@s21_router.post("/generate-report")
async def generate_pdf_report(
    report_data: ReportRequest,
    current_user: dict = Depends(get_current_user)
):
    """Generate PDF test report"""
    try:
        current_date = time.strftime('%Y-%m-%d')
        
        # Create PDF
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=12)
        
        # Add title
        pdf.cell(200, 10, txt="S-Parameter Test Report", ln=True, align='C')
        pdf.ln(10)
        
        # Add test info
        current_datetime = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        pdf.cell(200, 10, txt=f"Inspection Date: {current_datetime}", ln=True)
        pdf.cell(200, 10, txt=f"Serial No: {report_data.serial_number}", ln=True)
        pdf.cell(200, 10, txt=f"Operator: {report_data.operator}", ln=True)
        pdf.ln(10)
        
        # Create results table
        pdf.set_font("Arial", 'B', 10)
        pdf.set_fill_color(200, 200, 200)
        pdf.cell(60, 10, "Parameter", 1, 0, 'C', 1)
        pdf.cell(60, 10, "Measured Value", 1, 0, 'C', 1)
        pdf.cell(60, 10, "Units", 1, 1, 'C', 1)
        
        # Add table data
        pdf.set_font("Arial", size=10)
        
        test_data = [
            ("Device Type", report_data.device_type, ""),
            ("Serial Number", report_data.serial_number, ""),
            ("S21 Bandwidth", report_data.s21_bandwidth, "GHz"),
            ("Frequency at -3dB", report_data.frequency_3db, "GHz"),
            ("Ripple Result", report_data.ripple_result, ""),
            ("Overall Result", report_data.overall_result, ""),
            ("Operator", report_data.operator, ""),
            ("Date", current_date, "")
        ]
        
        for param, value, unit in test_data:
            pdf.cell(60, 10, param, 1)
            pdf.cell(60, 10, str(value), 1)
            pdf.cell(60, 10, unit, 1, 1)
        
        pdf.ln(10)
        
        # Add plots if they exist
        sparam_plot = GRAPHS_DIR / f'Sparam_plot_{report_data.device_type}_{report_data.serial_number}_{current_date}.png'
        if sparam_plot.exists():
            pdf.image(str(sparam_plot), x=10, y=None, w=180)
        
        ripple_plot = GRAPHS_DIR / f'Ripple_plot_{report_data.device_type}_{report_data.serial_number}_{current_date}.png'
        if ripple_plot.exists():
            pdf.ln(10)
            pdf.image(str(ripple_plot), x=10, y=None, w=180)
        
        # Save PDF
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        pdf_filename = f"SParam_Test_Report_{report_data.device_type}_{report_data.serial_number}_{timestamp}.pdf"
        pdf_path = REPORTS_DIR / pdf_filename
        pdf.output(str(pdf_path))
        
        log_action(current_user['user_id'], 'generate_report', 's21',
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
def init_s21_tables():
    """Initialize S21 testing tables"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Create indexes
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_s21_results_device_type 
                ON s21_test_results(device_type)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_s21_results_test_date 
                ON s21_test_results(test_date)
            """)
            
            conn.commit()
            print("✅ S21 testing tables initialized")
            
    except Exception as e:
        print(f"❌ S21 table initialization error: {e}")


init_s21_tables()



# Export router
__all__ = ['s21_router']

print("✅ S21 testing module loaded successfully")