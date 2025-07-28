# modules/modulator_module.py - Modulator Testing Backend Module

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
import pyvisa
from scipy.signal import find_peaks, savgol_filter
from scipy import stats
import pyodbc

# Load environment variables
load_dotenv()

# Router for modulator testing
modulator_router = APIRouter()

# Security
security = HTTPBearer()
SECRET_KEY = os.getenv('SECRET_KEY', 'default-dev-key-change-in-production')

# File storage configuration
RESULTS_DIR = Path('./test_results/modulator')
GRAPHS_DIR = RESULTS_DIR / 'graphs'
REPORTS_DIR = RESULTS_DIR / 'reports'
RESOURCES_DIR = Path('./test_resources/modulator')

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

# Instrument addresses
SCOPE_ADDRESS = 'USB0::0x0699::0x03C7::C021517::INSTR'
POWER_METER_ADDRESS = 'USB0::0x1313::0x80BB::M01217713::INSTR'
FUNC_GEN_ADDRESS = 'USB0::0x0699::0x0356::B011373::INSTR'
AMP_ADDRESS = 'USB0::0x0957::0x2207::MY62000390::INSTR'

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

@contextmanager
def get_sql_server_connection():
    """Get SQL Server database connection for VPI ranges"""
    conn = None
    try:
        conn = pyodbc.connect(
            'DRIVER={ODBC Driver 17 for SQL Server};'
            'SERVER=tcp:PSI-SVR-TQESQL,49172;'
            'DATABASE=modulator_assembly_lab;'
            'UID=karthi;'
            'PWD=modulatorassembly@PSI;'
        )
        yield conn
    except pyodbc.Error as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"SQL Server connection failed: {str(e)}")
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
class ModulatorTestRequest(BaseModel):
    device_type: str
    serial_number: str
    operator: str
    input_power: float
    notes: Optional[str] = ""

class TestResultResponse(BaseModel):
    vpi_value: Optional[float]
    extinction_ratio: Optional[float]
    insertion_loss: Optional[float]
    phase_angle: Optional[float]
    result: str
    drift: bool
    plot_filename: Optional[str]

class ReportRequest(BaseModel):
    device_type: str
    serial_number: str
    operator: str
    vpi_value: float
    insertion_loss: float
    extinction_ratio: float
    phase_angle: float
    result: str

# Modulator Test Controller Class
class ModulatorTestController:
    def __init__(self):
        self.rm = None
        self.scope = None
        self.power_meter = None
        self.func_gen = None
        self.amp = None
        self.connected = False
        self.current_wavelength = 1310
        self.vpi_values = []
        self.phaseangle = 0
        self.result = None
        self.slope = None
        self.voltage_range = [10]
        
    def connect_instruments(self):
        """Connect to all instruments"""
        try:
            self.rm = pyvisa.ResourceManager()
            
            # Initialize instruments
            self.scope = self._initialize_scope()
            time.sleep(2)
            self.func_gen = self._initialize_function_generator()
            time.sleep(2)
            self.amp = self._initialize_amplifier()
            time.sleep(2)
            self.power_meter = self._initialize_power_meter()
            time.sleep(2)
            
            # Set default wavelength
            self._set_power_meter_wavelength(self.current_wavelength)
            time.sleep(0.1)
            
            self.connected = True
            print("✅ All instruments connected successfully")
            return True
            
        except Exception as e:
            print(f"❌ Failed to connect instruments: {e}")
            self.connected = False
            return False
    
    def _initialize_scope(self):
        """Initialize oscilloscope"""
        try:
            scope = self.rm.open_resource(SCOPE_ADDRESS)
            scope.timeout = 10000
            scope.clear()
            scope.write("HORizontal:MAIn:SCAle 400e-6")
            scope.write("ACQuire:MODE sample")
            scope.write("HORizontal:RESOlution 2000")
            print("✅ Scope initialized successfully")
            return scope
        except pyvisa.errors.VisaIOError as e:
            print(f"❌ Error initializing scope: {e}")
            raise Exception(f"Scope initialization failed: {str(e)}")
    
    def _initialize_function_generator(self):
        """Initialize function generator"""
        try:
            func_gen = self.rm.open_resource(FUNC_GEN_ADDRESS)
            func_gen.timeout = 10000
            func_gen.write('source1:Frequency 1000')
            func_gen.write('source1:FUNCtion:SHAPe RAMP')
            time.sleep(0.1)
            func_gen.write('source1:FUNCtion:RAMP:SYMMetry 0')
            time.sleep(0.1)
            func_gen.write('OUTPut1:STATe ON')
            func_gen.clear()
            print("✅ Function generator initialized successfully")
            return func_gen
        except pyvisa.errors.VisaIOError as e:
            print(f"❌ Error initializing function generator: {e}")
            raise Exception(f"Function generator initialization failed: {str(e)}")
    
    def _initialize_power_meter(self):
        """Initialize power meter"""
        try:
            power_meter = self.rm.open_resource(POWER_METER_ADDRESS)
            power_meter.timeout = 10000
            power_meter.clear()
            print("✅ Power meter initialized successfully")
            return power_meter
        except pyvisa.errors.VisaIOError as e:
            print(f"❌ Error initializing power meter: {e}")
            raise Exception(f"Power meter initialization failed: {str(e)}")
    
    def _initialize_amplifier(self):
        """Initialize amplifier"""
        try:
            amp = self.rm.open_resource(AMP_ADDRESS)
            amp.write(f'route1:path AMPLifier')
            amp.write(f'input1:impedance 50')
            amp.write(f'output1:state ON')
            print("✅ Amplifier initialized successfully")
            return amp
        except pyvisa.errors.VisaIOError as e:
            print(f"❌ Error initializing amplifier: {e}")
            raise Exception(f"Amplifier initialization failed: {str(e)}")
    
    def _set_power_meter_wavelength(self, wavelength):
        """Set power meter wavelength"""
        try:
            if self.power_meter:
                self.power_meter.write(f'SENS:CORR:WAV {wavelength}')
                self.power_meter.write('SENS:POW:RANG:SEAR')
                time.sleep(2)
                optimal_range = self.power_meter.query('SENS:POW:RANG?')
                self.power_meter.write(f'SENS:POW:RANG {optimal_range}')
                self.current_wavelength = wavelength
                print(f"✅ Power meter wavelength set to {wavelength}nm")
        except pyvisa.errors.VisaIOError as e:
            print(f"❌ Error setting power meter wavelength: {e}")
    
    def get_vpi_ranges_from_db(self, device_type):
        """Get VPI ranges from database"""
        try:
            with get_sql_server_connection() as conn:
                cursor = conn.cursor()
                query = "SELECT Vpimin, Vpimax FROM VpiRanges WHERE DeviceType = ?"
                cursor.execute(query, device_type)
                row = cursor.fetchone()
                if row:
                    return {"min_vpi": row[0], "max_vpi": row[1]}
                else:
                    raise Exception(f"No Vπ range data found for device type {device_type}")
        except Exception as e:
            print(f"❌ Error fetching VPI ranges: {e}")
            # Return default ranges
            return {"min_vpi": 2.0, "max_vpi": 8.0}
    
    def set_modulator_bias_voltage(self, voltage):
        """Set modulator bias voltage"""
        try:
            command = f"SOURce1:VOLTage:AMPLitude {voltage} VPP"
            self.func_gen.write(command)
            print(f"✅ Modulator bias voltage set to {voltage} V")
        except pyvisa.errors.VisaIOError as e:
            print(f"❌ Error setting modulator bias voltage: {e}")
    
    def fetch_waveform(self, channel, start_idx, end_idx):
        """Fetch waveform data from oscilloscope"""
        try:
            self.scope.write(f"DATA:SOURCE {channel}")
            self.scope.write('DATA:ENCdg ASCii')
            self.scope.write(f"DATA:START {start_idx}")
            self.scope.write(f"DATA:STOP {end_idx}")

            waveform_data = self.scope.query("CURVe?")
            waveform_data = np.array(waveform_data.split(','), dtype=float)

            x_increment = float(self.scope.query('WFMOutpre:XINcr?'))
            x_origin = float(self.scope.query('WFMOutpre:XZEro?'))
            y_increment = float(self.scope.query('WFMOutpre:YMUlt?'))
            y_origin = float(self.scope.query('WFMOutpre:YZEro?'))
            y_reference = float(self.scope.query('WFMOutpre:YOFf?'))

            time_data = (np.arange(len(waveform_data))) * x_increment + x_origin
            waveform_data = (waveform_data - y_reference) * y_increment + y_origin

            return time_data, waveform_data

        except pyvisa.errors.VisaIOError as e:
            print(f"❌ VISA IO Error while fetching waveform: {e}")
            return None, None
    
    def detect_transitions(self, time_data, waveform_data):
        """Detect peaks and nulls in waveform data"""
        peaks, _ = find_peaks(waveform_data, distance=30)
        peaks_time = time_data[peaks]
        nulls, _ = find_peaks(-waveform_data, distance=30)
        nulls_time = time_data[nulls]
        
        return peaks, nulls, peaks_time, nulls_time
    
    def run_vpi_measurement(self, device_type, serial_number):
        """Run VPI measurement"""
        if not self.connected:
            raise Exception("Instruments not connected")
        
        try:
            # Set voltage and capture waveforms
            for voltage in self.voltage_range:
                self.set_modulator_bias_voltage(voltage)
                time.sleep(0.5)
                result = self._plot_waveforms_with_transitions(device_type, serial_number)
                if result:
                    return result
            
            return None
            
        except Exception as e:
            print(f"❌ VPI measurement failed: {e}")
            raise Exception(f"VPI measurement failed: {str(e)}")
    
    def _plot_waveforms_with_transitions(self, device_type, serial_number):
        """Plot waveforms and calculate VPI"""
        try:
            channel1 = 'CH1'  # Used for Vπ calculation
            channel2 = 'CH2'  # Used for waveform plotting
            
            samplerate = float(self.scope.query("HORizontal:MAIn:SAMPLERate?"))
            max_iterations = 5
            iteration_count = 0
            vpi_found = False
            
            # Load VPI ranges
            vpi_ranges = self.get_vpi_ranges_from_db(device_type)
            min_vpi = vpi_ranges["min_vpi"]
            max_vpi = vpi_ranges["max_vpi"]
            
            while iteration_count < max_iterations and not vpi_found:
                iteration_count += 1
                
                # Fetch waveforms
                start_idx = 1
                end_idx = int(samplerate)
                
                time_data1, waveform_data1 = self.fetch_waveform(channel1, start_idx, end_idx)
                time_data2, waveform_data2 = self.fetch_waveform(channel2, start_idx, end_idx)
                
                if time_data1 is not None and waveform_data1 is not None and time_data2 is not None and waveform_data2 is not None:
                    # Smooth the data
                    smoothed_waveform_data1 = savgol_filter(waveform_data1, window_length=31, polyorder=3)
                    smoothed_waveform_data2 = savgol_filter(waveform_data2, window_length=31, polyorder=3)
                    
                    # Save data to CSV
                    np.savetxt("waveform_data1.csv", 
                              np.column_stack([smoothed_waveform_data1, smoothed_waveform_data2]), 
                              delimiter=",", header="Voltage,Power", comments='')
                    
                    # Read and filter data
                    df = pd.read_csv('waveform_data1.csv')
                    df_filtered = df.loc[77:356, ['Voltage', 'Power']]
                    
                    # Create plot
                    fig, ax = plt.subplots(figsize=(10, 6))
                    drive_voltage_values = df_filtered['Voltage'].values
                    output_power_values = df_filtered['Power'].values
                    
                    # Detect transitions
                    peaks, nulls, peaks_time, nulls_time = self.detect_transitions(drive_voltage_values, output_power_values)
                    
                    # Plot data
                    ax.plot(drive_voltage_values, output_power_values, label='Optical Output')
                    ax.plot(drive_voltage_values[peaks], output_power_values[peaks], 'ro', label='Peaks')
                    ax.plot(drive_voltage_values[nulls], output_power_values[nulls], 'g*', label='Nulls')
                    ax.set_xlabel('Drive Voltage (V)')
                    ax.set_ylabel('Optical Amplitude (V)')
                    ax.legend()
                    ax.grid(True)
                    plt.suptitle(f'Drive Voltage vs Optical Amplitude (λ = {self.current_wavelength}nm)')
                    plt.tight_layout()
                    
                    # VPI calculation
                    self.scope.write('MEASUREMENT:IMMED:SOURCE1 CH1')
                    self.scope.write('MEASUrement:IMMed:TYPe FREQUENCY')
                    frequency = float(self.scope.query("MEASUrement:IMMed:VALue?"))
                    time_period = 1 / frequency
                    sample_rate = float(self.scope.query("HORizontal:MAIn:SAMPLERate?"))
                    samples_per_period = int(time_period * sample_rate)
                    
                    start_index = 0
                    end_index = int(samples_per_period)
                    
                    while end_index <= len(waveform_data1):
                        ramp_segment = waveform_data1[start_index:end_index]
                        t_segment = time_data1[start_index:end_index]
                        self.slope, intercept, r_value, p_value, std_err = stats.linregress(t_segment, ramp_segment)
                        
                        peak_indices, _ = find_peaks(output_power_values[start_index:end_index], distance=30)
                        null_indices, _ = find_peaks(-output_power_values[start_index:end_index], distance=30)
                        
                        if len(peak_indices) > 0 and len(null_indices) > 0:
                            ramp_values_at_peaks = ramp_segment[peak_indices]
                            ramp_values_at_nulls = ramp_segment[null_indices]
                            
                            for peak, null in zip(ramp_values_at_peaks, ramp_values_at_nulls):
                                vpi = abs(peak - null)
                                if min_vpi <= vpi <= max_vpi:
                                    self.vpi_values.append(vpi)
                                    vpi_found = True
                                    
                                    # Calculate phase angle
                                    closest_peak_index = np.argmin(np.abs(drive_voltage_values[peak_indices]))
                                    bias_voltage_at_peak = drive_voltage_values[peak_indices[closest_peak_index]]
                                    phase_angle = (bias_voltage_at_peak / vpi) * 180
                                    self.phaseangle = phase_angle
                                    break
                        
                        if vpi_found:
                            # Save plot
                            current_date = time.strftime('%Y-%m-%d')
                            plot_filename = f'DCvpiplot_{device_type}_{serial_number}_{current_date}.png'
                            plot_path = GRAPHS_DIR / plot_filename
                            plt.savefig(plot_path)
                            plt.close(fig)
                            self.result = "PASS"
                            return plot_filename
                        
                        start_index = end_index
                        end_index += samples_per_period
                    
                    plt.close(fig)
                
                if vpi_found:
                    break
            
            if not self.vpi_values:
                self.result = "FAIL"
                return None
            
            return None
            
        except Exception as e:
            print(f"❌ Error in waveform plotting: {e}")
            raise Exception(f"Waveform plotting failed: {str(e)}")
    
    def run_power_measurement(self, input_power, device_type, serial_number):
        """Run power measurement at 0.1Hz"""
        try:
            # Change frequency to 0.1Hz
            self.func_gen.write('source1:Frequency 0.1')
            time.sleep(2)
            
            # Collect power data
            x_data, y_data = [], []
            
            for i in range(3000):  # Collect for ~10 seconds
                time_point = i * 0.001
                power = self._read_power_meter()
                if np.isfinite(power):
                    x_data.append(time_point)
                    y_data.append(power)
                time.sleep(0.002)
            
            # Save data
            current_date = time.strftime('%Y-%m-%d')
            np.savetxt(RESULTS_DIR / f"waveform_data_{device_type}_{serial_number}_{current_date}.csv", 
                      np.column_stack([x_data, y_data]), 
                      delimiter=",", header="Time,Power", comments='')
            
            # Filter valid data
            y_data = np.array(y_data)
            y_data = y_data[np.isfinite(y_data)]
            
            if len(y_data) == 0:
                return 0, 0, False
            
            # Calculate metrics
            peak_power = np.max(y_data)
            null_power = np.min(y_data)
            
            # Find peaks and nulls
            peaks, _ = find_peaks(y_data, prominence=0.1)
            threshold = 0.9
            nulls = []
            
            # Detect nulls
            for i in range(len(y_data)-1):
                if y_data[i] < threshold and (i == 0 or y_data[i] < y_data[i-1]) and (i == len(y_data)-1 or y_data[i] < y_data[i+1]):
                    nulls.append(i)
            
            if len(peaks) == 0 or len(nulls) == 0:
                return 0, 0, False
            
            # Calculate extinction ratio and insertion loss
            peak_values = y_data[peaks]
            null_values = y_data[nulls]
            
            er = abs(max(peak_values) - min(null_values))
            i_loss = abs(peak_power - input_power)
            
            # Check for drift
            drift = False
            null_times = np.array([x_data[n] for n in nulls if n < len(x_data)])
            if len(null_times) > 1:
                time_differences = np.diff(null_times[::2])
                threshold = 0.02
                if not np.all(np.abs(time_differences - time_differences[0]) <= threshold):
                    drift = True
            
            return i_loss, er, drift
            
        except Exception as e:
            print(f"❌ Power measurement failed: {e}")
            raise Exception(f"Power measurement failed: {str(e)}")
    
    def _read_power_meter(self):
        """Read power from power meter"""
        try:
            self.power_meter.write("SENS:POW:UNIT DBM")
            power = float(self.power_meter.query("meas?"))
            return power
        except pyvisa.VisaIOError as e:
            print(f"❌ Error reading power meter: {e}")
            return np.nan
    
    def close_instruments(self):
        """Close all instrument connections"""
        try:
            if self.scope:
                self.scope.close()
            if self.func_gen:
                self.func_gen.write('OUTPut1:STATe OFF')
                self.func_gen.close()
            if self.power_meter:
                self.power_meter.close()
            if self.amp:
                self.amp.write(f'output1:state OFF')
                self.amp.close()
            if self.rm:
                self.rm.close()
            
            self.connected = False
            print("✅ All instruments closed")
        except Exception as e:
            print(f"❌ Error closing instruments: {e}")

# Global controller instance
modulator_controller = ModulatorTestController()

# Database functions
def save_test_result(test_data: dict):
    """Save test result to database"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO modulator_test_results 
                (device_type, serial_number, vpi_value, insertion_loss, extinction_ratio, 
                 phase_angle, result, drift, operator, notes, plot_path, test_date)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                test_data['device_type'],
                test_data['serial_number'],
                test_data['vpi_value'],
                test_data['insertion_loss'],
                test_data['extinction_ratio'],
                test_data['phase_angle'],
                test_data['result'],
                test_data['drift'],
                test_data['operator'],
                test_data['notes'],
                test_data['plot_path'],
                datetime.datetime.now()
            ))
            
            test_id = cursor.fetchone()[0]
            conn.commit()
            print(f"✅ Test result saved with ID: {test_id}")
            return test_id
    except Exception as e:
        print(f"❌ Error saving test result: {e}")
        raise Exception(f"Failed to save test result: {str(e)}")

# API Endpoints

@modulator_router.get("/status")
async def get_instrument_status(current_user: dict = Depends(get_current_user)):
    """Check instrument connection status"""
    try:
        if not modulator_controller.connected:
            connected = modulator_controller.connect_instruments()
        else:
            connected = modulator_controller.connected
        
        return {
            "connected": connected,
            "instruments": {
                "scope": SCOPE_ADDRESS,
                "power_meter": POWER_METER_ADDRESS,
                "function_generator": FUNC_GEN_ADDRESS,
                "amplifier": AMP_ADDRESS
            },
            "status": "Connected" if connected else "Disconnected",
            "wavelength": modulator_controller.current_wavelength
        }
    except Exception as e:
        return {
            "connected": False,
            "status": f"Error: {str(e)}",
            "wavelength": 1310
        }

@modulator_router.get("/device-types")
async def get_device_types(current_user: dict = Depends(get_current_user)):
    """Get available device types"""
    try:
        # Try to get from database
        with get_sql_server_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT DeviceType FROM VpiRanges")
            rows = cursor.fetchall()
            device_types = [row[0] for row in rows]
        
        if not device_types:
            # Default device types
            device_types = ['LNLVL-IM-Z', 'LN65S-FC', 'LN53S-FC', 'LNP6118', 'LNP6119']
        
        return {"device_types": device_types}
    except Exception as e:
        print(f"❌ Error fetching device types: {e}")
        return {"device_types": ['LNLVL-IM-Z', 'LN65S-FC', 'LN53S-FC', 'LNP6118', 'LNP6119']}

@modulator_router.post("/run-test")
async def run_modulator_test(
    test_config: ModulatorTestRequest,
    current_user: dict = Depends(get_current_user)
):
    """Run complete modulator test"""
    if current_user['role'] not in ['admin', 'operator']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        # Ensure instruments are connected
        if not modulator_controller.connected:
            if not modulator_controller.connect_instruments():
                raise HTTPException(status_code=500, detail="Failed to connect to instruments")
        
        # Run VPI measurement
        plot_filename = modulator_controller.run_vpi_measurement(
            test_config.device_type, test_config.serial_number
        )
        
        # Run power measurement
        insertion_loss, extinction_ratio, drift = modulator_controller.run_power_measurement(
            test_config.input_power, test_config.device_type, test_config.serial_number
        )
        
        # Get results
        vpi_value = np.mean(modulator_controller.vpi_values) if modulator_controller.vpi_values else None
        phase_angle = modulator_controller.phaseangle
        result = modulator_controller.result
        
        # Determine final result
        if extinction_ratio < 20 or insertion_loss > 5:
            result = "FAIL"
        
        # Save to database
        test_data = {
            'device_type': test_config.device_type,
            'serial_number': test_config.serial_number,
            'vpi_value': vpi_value,
            'insertion_loss': insertion_loss,
            'extinction_ratio': extinction_ratio,
            'phase_angle': phase_angle,
            'result': result,
            'drift': drift,
            'operator': test_config.operator,
            'notes': test_config.notes,
            'plot_path': str(GRAPHS_DIR / plot_filename) if plot_filename else None
        }
        
        test_id = save_test_result(test_data)
        
        log_action(current_user['user_id'], 'run_modulator_test', 'modulator',
                  f"Test: {test_config.device_type} {test_config.serial_number} - {result}")
        
        return TestResultResponse(
            vpi_value=vpi_value,
            extinction_ratio=extinction_ratio,
            insertion_loss=insertion_loss,
            phase_angle=phase_angle,
            result=result,
            drift=drift,
            plot_filename=plot_filename
        )
        
    except Exception as e:
        print(f"❌ Modulator test failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@modulator_router.get("/history")
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
                SELECT * FROM modulator_test_results 
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
                    "vpi_value": float(row['vpi_value']) if row['vpi_value'] else None,
                    "insertion_loss": float(row['insertion_loss']) if row['insertion_loss'] else None,
                    "extinction_ratio": float(row['extinction_ratio']) if row['extinction_ratio'] else None,
                    "phase_angle": float(row['phase_angle']) if row['phase_angle'] else None,
                    "result": row['result'],
                    "drift": row['drift'],
                    "operator": row['operator'],
                    "test_date": row['test_date'].isoformat() if row['test_date'] else None,
                    "notes": row['notes']
                })
            
            return {"tests": tests}
    except Exception as e:
        print(f"❌ Error fetching test history: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch test history")

@modulator_router.get("/graph/{filename}")
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

@modulator_router.post("/generate-report")
async def generate_pdf_report(
    report_data: ReportRequest,
    current_user: dict = Depends(get_current_user)
):
    """Generate PDF test report"""
    try:
        current_date = time.strftime('%Y-%m-%d')
        current_datetime = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Create PDF
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=12)
        
        # Add title
        pdf.cell(200, 10, txt="Modulator Test Report", ln=True, align='C')
        pdf.ln(10)
        
        # Add test info
        pdf.cell(200, 10, txt=f"Inspection Date: {current_datetime}", ln=True)
        pdf.cell(200, 10, txt=f"Serial No: {report_data.serial_number}", ln=True)
        pdf.cell(200, 10, txt=f"Product Number: {report_data.device_type}", ln=True)
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
            ("DC Vπ", f"{report_data.vpi_value:.2f}", "VDC"),
            ("Insertion Loss", f"{report_data.insertion_loss:.2f}", "dB"),
            ("Extinction Ratio", f"{report_data.extinction_ratio:.2f}", "dB"),
            ("Phase Angle", f"{report_data.phase_angle:.2f}", "Degrees"),
            ("Test Wavelength", str(modulator_controller.current_wavelength), "nm"),
            ("Result", report_data.result, ""),
            ("Operator", report_data.operator, ""),
            ("Date", current_date, "")
        ]
        
        for param, value, unit in test_data:
            pdf.cell(60, 10, param, 1)
            pdf.cell(60, 10, str(value), 1)
            pdf.cell(60, 10, unit, 1, 1)
        
        pdf.ln(10)
        
        # Add plot if available
        plot_path = GRAPHS_DIR / f'DCvpiplot_{report_data.device_type}_{report_data.serial_number}_{current_date}.png'
        if plot_path.exists():
            pdf.image(str(plot_path), x=10, y=None, w=180)
        
        # Save PDF
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        pdf_filename = f"ModulatorTest_Report_{report_data.device_type}_{report_data.serial_number}_{timestamp}.pdf"
        pdf_path = REPORTS_DIR / pdf_filename
        pdf.output(str(pdf_path))
        
        log_action(current_user['user_id'], 'generate_report', 'modulator',
                  f"Generated report for {report_data.device_type} {report_data.serial_number}")
        
        return FileResponse(
            path=str(pdf_path),
            filename=pdf_filename,
            media_type='application/pdf'
        )
        
    except Exception as e:
        print(f"❌ Report generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {str(e)}")

# # Initialize database tables
# def init_modulator_tables():
#     """Initialize modulator testing tables"""
#     try:
#         with get_db_connection() as conn:
#             cursor = conn.cursor()
            
#             # Create modulator test results table if it doesn't exist
#             cursor.execute("""
#                 CREATE TABLE IF NOT EXISTS modulator_test_results (
#                     id SERIAL PRIMARY KEY,
#                     device_type VARCHAR(50) NOT NULL,
#                     serial_number VARCHAR(100) NOT NULL,
#                     vpi_value DECIMAL(10,3),
#                     insertion_loss DECIMAL(10,3),
#                     extinction_ratio DECIMAL(10,3),
#                     phase_angle DECIMAL(10,3),
#                     result VARCHAR(20) NOT NULL,
#                     drift BOOLEAN DEFAULT FALSE,
#                     operator VARCHAR(100) NOT NULL,
#                     notes TEXT,
#                     plot_path TEXT,
#                     test_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
#                     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
#                 )
#             """)
            
#             # Create indexes
#             cursor.execute("""
#                 CREATE INDEX IF NOT EXISTS idx_modulator_results_device_type 
#                 ON modulator_test_results(device_type)
#             """)
            
#             cursor.execute("""
#                 CREATE INDEX IF NOT EXISTS idx_modulator_results_test_date 
#                 ON modulator_test_results(test_date)
#             """)
            
#             conn.commit()
#             print("✅ Modulator testing tables initialized")
            
#     except Exception as e:
#         print(f"❌ Modulator table initialization error: {e}")

# # Initialize tables on module load
# init_modulator_tables()

# Export router
__all__ = ['modulator_router']

print("✅ Modulator testing module loaded successfully")