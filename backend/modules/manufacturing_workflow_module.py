# modules/manufacturing_workflow_module.py
"""
Manufacturing Workflow Module for MAQ Lab Manager

This module provides functionality for managing Manufacturing Orders (MOs), device testing workflows, and device type requirements.
Updated to work with actual database schema.
"""

from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, validator
from typing import Dict, List, Optional, Any
from datetime import datetime, date
from enum import Enum
import json
import asyncio
import logging
import uuid
import os
import psycopg2
import psycopg2.extras
import psycopg2.pool
import jwt
from contextlib import contextmanager
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(tags=["manufacturing"])

# Security
security = HTTPBearer()
SECRET_KEY = os.getenv('SECRET_KEY', 'default-dev-key-change-in-production')

# Database Configuration
DATABASE_CONFIG = {
    'host': os.getenv('DB_HOST', '192.168.99.121'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', 'karthi')
}

# Global connection pool and db function
db_pool = None
get_db_connection_func = None

def init_db_pool():
    """Initialize database connection pool"""
    global db_pool
    try:
        db_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            **DATABASE_CONFIG
        )
        logger.info("Manufacturing Workflow DB pool initialized")
        return True
    except Exception as e:
        logger.error(f"Database pool initialization failed: {e}")
        return False

@contextmanager
def get_db_connection():
    """Get PostgreSQL database connection from pool or use injected function"""
    if get_db_connection_func:
        # Use the injected function from main.py
        with get_db_connection_func() as conn:
            yield conn
    else:
        # Fallback to local pool
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

def set_db_connection(db_func):
    """Set the database connection function from main.py"""
    global get_db_connection_func
    get_db_connection_func = db_func

def verify_jwt_token(token: str) -> dict:
    """Verify JWT token"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired. Please login again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token. Please login again.")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Get current user from token"""
    token = credentials.credentials
    user_data = verify_jwt_token(token)
    return user_data

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
        logger.error(f"Error logging action: {e}")

# Helper function to determine device type from serial number
def get_device_type_from_serial(serial_number: str) -> str:
    """Extract device type from serial number"""
    if '-' in serial_number:
        return serial_number.split('-')[0]
    
    # Handle cases like LNA6213002 (no dash)
    known_types = ['LNA6213', 'LNP4216', 'LNP6118', 'LNA2124', 'LNA2322', 'LNA6112', 
                   'LN53S-FC', 'LN65S-FC', 'LNLVL-IM-Z', 'LNP4217', 'LNP6119', 'LNQ4314']
    
    for device_type in known_types:
        if serial_number.startswith(device_type):
            return device_type
    
    return None

# Enums
class Priority(str, Enum):
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"

class MOStatus(str, Enum):
    ACTIVE = "Active"
    COMPLETED = "Completed"
    CANCELLED = "Cancelled"
    ON_HOLD = "On Hold"

# Pydantic Models for Manufacturing Orders
class DeviceTypeRequirement(BaseModel):
    device_type: str
    required: int
    completed: int = 0
    in_progress: int = 0
    description: str = ""

class ManufacturingOrder(BaseModel):
    manufacturing_order_number: str
    product_name: str
    device_types: Dict[str, DeviceTypeRequirement]
    priority: Priority
    due_date: date
    operator: str
    status: MOStatus = MOStatus.ACTIVE
    created_at: datetime
    notes: str = ""

# Pydantic Models for Testing Workflow
class TestSequenceItem(BaseModel):
    test_id: str
    sequence_order: int
    is_required: bool
    test_number: Optional[str] = None

class TestSequenceResponse(BaseModel):
    test_sequences: List[TestSequenceItem]

class DeviceRegistration(BaseModel):
    manufacturing_order_number: str
    device_type: str
    serial_number: str
    test_sequence: List[str]

class DeviceInfo(BaseModel):
    serial_number: str
    device_type: str
    manufacturing_order_number: Optional[str] = None
    status: str
    current_step: Optional[str] = None
    completed_steps: List[str] = []
    required_tests: List[str] = []
    created_at: Optional[str] = None

class DeviceResponse(BaseModel):
    device: DeviceInfo

class ManufacturingOrderResponse(BaseModel):
    manufacturing_orders: List[Dict[str, Any]]

class ApiResponse(BaseModel):
    message: str
    data: Optional[Dict[str, Any]] = None

# Helper Functions
def get_mo_by_number(manufacturing_order_number: str) -> Optional[dict]:
    """Get Manufacturing Order by number"""
    try:
        manufacturing_order_number = manufacturing_order_number.strip()
        logger.info(f"Querying database for MO: '{manufacturing_order_number}'")
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM manufacturing_orders 
                WHERE TRIM(manufacturing_order_number) = %s
            """, (manufacturing_order_number,))
            
            row = cursor.fetchone()
            logger.info(f"Database query result: {row is not None}")
            
            if row:
                columns = [desc[0] for desc in cursor.description]
                mo_data = dict(zip(columns, row))
                
                # Trim manufacturing_order_number
                if 'manufacturing_order_number' in mo_data and mo_data['manufacturing_order_number']:
                    mo_data['manufacturing_order_number'] = mo_data['manufacturing_order_number'].strip()
                
                # Convert date and datetime objects to strings for JSON serialization
                import datetime as dt
                for key, value in mo_data.items():
                    if isinstance(value, (dt.date, dt.datetime)):
                        mo_data[key] = value.isoformat()
                
                # Map schema fields for compatibility
                mo_data['product_name'] = mo_data.get('product_line', 'Unknown Product')
                mo_data['operator'] = str(mo_data.get('created_by', 'Unknown'))
                
                return mo_data
            else:
                logger.warning(f"No MO found with number: '{manufacturing_order_number}'")
                return None
    except Exception as e:
        logger.error(f"Error getting MO {manufacturing_order_number}: {e}", exc_info=True)
        return None

# Manufacturing Orders API Endpoints
@router.get("/manufacturing-orders", response_model=ManufacturingOrderResponse)
async def get_manufacturing_orders(current_user: dict = Depends(get_current_user)):
    """Get all Manufacturing Orders with device type summaries"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Get manufacturing orders
            cursor.execute("""
                SELECT * FROM manufacturing_orders 
                WHERE LOWER(status) NOT IN ('cancelled', 'canceled')
                ORDER BY created_at DESC
            """)
            
            manufacturing_orders = []
            for row in cursor.fetchall():
                mo_data = dict(row)
                
                # Trim manufacturing_order_number
                if 'manufacturing_order_number' in mo_data and mo_data['manufacturing_order_number']:
                    mo_data['manufacturing_order_number'] = mo_data['manufacturing_order_number'].strip()
                
                # Handle date serialization
                import datetime as dt
                for key, value in mo_data.items():
                    if isinstance(value, (dt.date, dt.datetime)):
                        mo_data[key] = value.isoformat()
                
                # Map schema fields for compatibility
                mo_data['product_name'] = mo_data.get('product_line', 'Unknown Product')
                mo_data['operator'] = str(mo_data.get('created_by', 'Unknown'))
                mo_data['priority'] = mo_data.get('priority', 'medium')
                
                # Get device type requirements
                cursor.execute("""
                    SELECT device_type, quantity 
                    FROM manufacturing_order_devices 
                    WHERE manufacturing_order_number = %s
                """, (mo_data['manufacturing_order_number'],))
                
                device_types = {}
                for dt_row in cursor.fetchall():
                    device_types[dt_row['device_type']] = {
                        "required": dt_row['quantity'] or 0,
                        "completed": 0,  # We'll calculate this later when devices table is populated
                        "in_progress": 0
                    }
                
                mo_data['device_types'] = device_types
                manufacturing_orders.append(mo_data)
        
        logger.info(f"Retrieved {len(manufacturing_orders)} manufacturing orders")
        log_action(current_user['user_id'], 'list_mos', 'manufacturing_workflow', f"Retrieved {len(manufacturing_orders)} manufacturing orders")
        
        return ManufacturingOrderResponse(manufacturing_orders=manufacturing_orders)
        
    except Exception as e:
        logger.error(f"Error getting MOs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve manufacturing orders")

@router.get("/manufacturing-orders/{manufacturing_order_number}")
async def get_manufacturing_order(
    manufacturing_order_number: str,
    current_user: dict = Depends(get_current_user)
):
    """Get specific Manufacturing Order with device type requirements"""
    try:
        logger.info(f"Fetching MO details for: {manufacturing_order_number}")
        
        # Get basic MO info from manufacturing_orders table
        mo = get_mo_by_number(manufacturing_order_number)
        if not mo:
            logger.warning(f"Manufacturing Order not found: {manufacturing_order_number}")
            raise HTTPException(status_code=404, detail=f"Manufacturing Order {manufacturing_order_number} not found")
        
        logger.info(f"Found MO: {mo['manufacturing_order_number']}")
        
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Get device type requirements from manufacturing_order_devices table
            cursor.execute("""
                SELECT device_type, quantity, description 
                FROM manufacturing_order_devices 
                WHERE manufacturing_order_number = %s
                ORDER BY device_type
            """, (manufacturing_order_number,))
            
            device_type_requirements = {}
            device_types_rows = cursor.fetchall()
            
            for row in device_types_rows:
                device_type_requirements[row['device_type']] = {
                    'device_type': row['device_type'],
                    'required': row['quantity'],
                    'completed': 0,
                    'in_progress': 0,
                    'description': row['description'] or ''
                }
            
            mo['device_types'] = device_type_requirements
            devices_by_type = {}
        
        return {
            "manufacturing_order": mo,
            "devices_by_type": devices_by_type
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting MO {manufacturing_order_number}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve manufacturing order: {str(e)}")

# Testing Workflow API Endpoints
@router.get("/device-types/{device_type}/test-sequences", response_model=TestSequenceResponse)
async def get_device_test_sequences(device_type: str):
    """Get test sequences for a specific device type from your existing table"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            query = """
            SELECT test_sequence 
            FROM device_test_sequences 
            WHERE device_type = %s
            """
            
            cursor.execute(query, (device_type,))
            result = cursor.fetchone()
            
            if not result:
                raise HTTPException(
                    status_code=404, 
                    detail=f"Device type {device_type} not found"
                )
            
            test_sequences = result['test_sequence']
            
            if isinstance(test_sequences, list):
                test_sequences.sort(key=lambda x: int(x.get('sequence_order', 0)))
                
                formatted_sequences = []
                for seq in test_sequences:
                    formatted_sequences.append({
                        "test_id": seq.get("test_id"),
                        "sequence_order": int(seq.get("sequence_order", 0)),
                        "is_required": seq.get("is_required", True),
                        "test_number": seq.get("test_number")
                    })
                
                return TestSequenceResponse(test_sequences=formatted_sequences)
            else:
                raise HTTPException(
                    status_code=500,
                    detail="Invalid test sequence format in database"
                )
                
    except Exception as e:
        logger.error(f"Error getting test sequences for {device_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/device-types/{device_type}/tests-preview")
async def get_device_type_tests_preview(device_type: str):
    """Get all tests for a device type to show operators what's involved"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Get test sequences
            cursor.execute("""
                SELECT test_sequence 
                FROM device_test_sequences 
                WHERE device_type = %s
            """, (device_type,))
            
            result = cursor.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail=f"Device type {device_type} not found")
            
            test_sequences = result['test_sequence']
            if isinstance(test_sequences, list):
                test_sequences.sort(key=lambda x: int(x.get('sequence_order', 0)))
                
                # Get test definitions for descriptions
                test_ids = [test['test_id'] for test in test_sequences]
                
                if test_ids:
                    placeholders = ','.join(['%s'] * len(test_ids))
                    cursor.execute(f"""
                        SELECT test_id, test_name, description, estimated_duration_minutes
                        FROM test_definitions 
                        WHERE test_id IN ({placeholders})
                    """, test_ids)
                    
                    test_definitions = {row['test_id']: row for row in cursor.fetchall()}
                else:
                    test_definitions = {}
                
                # Combine test sequence with definitions
                detailed_tests = []
                total_required_time = 0
                total_optional_time = 0
                
                for test in test_sequences:
                    test_def = test_definitions.get(test['test_id'], {})
                    is_required = test.get('is_required', True)  # Default to True since your data uses boolean
                    if isinstance(is_required, str):
                        is_required = is_required.lower() == 'true'
                    duration = test_def.get('estimated_duration_minutes', 0) or 0
                    
                    if is_required:
                        total_required_time += duration
                    else:
                        total_optional_time += duration
                    
                    detailed_tests.append({
                        "test_id": test['test_id'],
                        "test_name": test_def.get('test_name', test['test_id']),
                        "description": test_def.get('description', ''),
                        "sequence_order": test['sequence_order'],
                        "is_required": is_required,
                        "estimated_duration_minutes": duration
                    })
                
                return {
                    "device_type": device_type,
                    "tests": detailed_tests,
                    "summary": {
                        "total_tests": len(detailed_tests),
                        "required_tests": sum(1 for t in detailed_tests if t['is_required']),
                        "optional_tests": sum(1 for t in detailed_tests if not t['is_required']),
                        "total_required_time_minutes": total_required_time,
                        "total_optional_time_minutes": total_optional_time,
                        "estimated_total_hours": round((total_required_time + total_optional_time) / 60, 1)
                    }
                }
            
            return {"device_type": device_type, "tests": [], "summary": {}}
            
    except Exception as e:
        logger.error(f"Error getting tests preview for {device_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/test-definitions")
async def get_test_definitions():
    """Get all test definitions from your existing table"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            query = """
            SELECT test_id, test_name, description, estimated_duration_minutes
            FROM test_definitions
            ORDER BY test_id
            """
            
            cursor.execute(query)
            results = cursor.fetchall()
            
            test_definitions = {}
            for row in results:
                test_definitions[row['test_id']] = {
                    "test_name": row['test_name'],
                    "description": row['description'],
                    "estimated_duration_minutes": row['estimated_duration_minutes']
                }
            
            return {"test_definitions": test_definitions}
            
    except Exception as e:
        logger.error(f"Error getting test definitions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/devices/{serial_number}")
async def get_device_details(serial_number: str):
    """Get device details - now uses stored device_type and required_tests"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Get device with all fields including device_type and required_tests
            cursor.execute("""
                SELECT serial_number, current_stage, completed_tests, device_type, required_tests
                FROM devices 
                WHERE serial_number = %s
            """, (serial_number,))
            
            device_row = cursor.fetchone()
            
            if not device_row:
                raise HTTPException(
                    status_code=404, 
                    detail=f"Device {serial_number} not found"
                )
            
            # Use stored data
            completed_steps = list(device_row['completed_tests'] or [])
            required_tests = list(device_row['required_tests'] or [])
            device_type = device_row['device_type']
            
            # Determine status
            if device_row['current_stage'] == 'completed':
                status = "completed"
            elif completed_steps:
                status = "in_progress"
            else:
                status = "not_started"
            
            device_info = {
                "serial_number": device_row['serial_number'],
                "device_type": device_type,
                "manufacturing_order_number": None,
                "status": status,
                "current_step": device_row['current_stage'],
                "completed_steps": completed_steps,
                "required_tests": required_tests,
                "created_at": None
            }
            
            return {"device": device_info}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting device details for {serial_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/devices/create")
async def create_device_simple(
    serial_number: str,
    device_type: str,  # NOW REQUIRED
    current_user: dict = Depends(get_current_user)
):
    """Create a new device with test sequence based on device type"""
    try:
        logger.info(f"Creating device: {serial_number} of type: {device_type}")
        
        # Validate inputs
        if not serial_number or not serial_number.strip():
            raise HTTPException(status_code=400, detail="Serial number is required")
        
        if not device_type or not device_type.strip():
            raise HTTPException(status_code=400, detail="Device type is required")
        
        serial_number = serial_number.strip()
        device_type = device_type.strip()
        
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Check if device already exists
            cursor.execute("""
                SELECT serial_number FROM devices WHERE serial_number = %s
            """, (serial_number,))
            
            if cursor.fetchone():
                raise HTTPException(
                    status_code=409, 
                    detail=f"Device {serial_number} already exists"
                )
            
            # Get test sequence for this device type
            cursor.execute("""
                SELECT test_sequence 
                FROM device_test_sequences 
                WHERE device_type = %s
            """, (device_type,))
            
            test_seq_result = cursor.fetchone()
            if not test_seq_result:
                raise HTTPException(
                    status_code=404, 
                    detail=f"No test sequence found for device type: {device_type}"
                )
            
            # Parse the test sequence
            test_sequences = test_seq_result['test_sequence']
            required_tests = []
            first_test = 'not_started'
            
            if isinstance(test_sequences, list):
                test_sequences.sort(key=lambda x: int(x.get('sequence_order', 0)))
                
                # Get required tests in order
                for test in test_sequences:
                    is_required = test.get('is_required', True)
                    if isinstance(is_required, str):
                        is_required = is_required.lower() == 'true'
                    if is_required:
                        required_tests.append(test['test_id'])
                
                # Set first test as current stage
                if required_tests:
                    first_test = required_tests[0]
            
            # Insert device with test sequence
            cursor.execute("""
                INSERT INTO devices (
                    serial_number, 
                    current_stage, 
                    completed_tests,
                    device_type,
                    required_tests
                )
                VALUES (%s, %s, %s, %s, %s)
                RETURNING serial_number, current_stage, completed_tests, device_type, required_tests
            """, (serial_number, first_test, [], device_type, required_tests))
            
            new_device = cursor.fetchone()
            conn.commit()
            
            logger.info(f"Device created successfully: {dict(new_device)}")
            
            # Log the action
            log_action(
                current_user['user_id'],
                'create_device',
                'manufacturing_workflow',
                f"Created {device_type} device {serial_number} with {len(required_tests)} required tests"
            )
            
            return {
                "message": f"Device {serial_number} created successfully",
                "device": {
                    "serial_number": new_device['serial_number'],
                    "device_type": new_device['device_type'],
                    "status": "not_started",
                    "current_stage": new_device['current_stage'],
                    "completed_tests": new_device['completed_tests'],
                    "required_tests": new_device['required_tests']
                }
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating device {serial_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/devices/register")
async def register_device(device_data: DeviceRegistration):
    """Register a new device - don't store required_tests, get them from device_test_sequences"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Insert into devices table without required_tests
            insert_device = """
            INSERT INTO devices (
                serial_number, current_stage, completed_tests
            ) VALUES (%s, %s, %s)
            """
            
            first_test = device_data.test_sequence[0] if device_data.test_sequence else None
            
            cursor.execute(insert_device, (
                device_data.serial_number,
                first_test,
                []  # Empty array for completed tests
            ))
            
            conn.commit()
            
            return ApiResponse(
                message=f"Device {device_data.serial_number} registered successfully",
                data={"serial_number": device_data.serial_number}
            )
            
    except Exception as e:
        logger.error(f"Error registering device {device_data.serial_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/devices/{serial_number}/tests/{test_id}/start")
async def start_test(serial_number: str, test_id: str):
    """Start a test for a device - No device type validation"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check if device exists
            cursor.execute("""
                SELECT serial_number FROM devices WHERE serial_number = %s
            """, (serial_number,))
            
            if not cursor.fetchone():
                raise HTTPException(
                    status_code=404,
                    detail=f"Device {serial_number} not found"
                )
            
            # Update current_stage
            cursor.execute("""
                UPDATE devices 
                SET current_stage = %s
                WHERE serial_number = %s
            """, (test_id, serial_number))
            
            conn.commit()
            
            return {
                "message": "Test started successfully",
                "data": {"test_id": test_id, "status": "running"}
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting test {test_id} for device {serial_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/devices/{serial_number}/tests/{test_id}/status")
async def get_test_status(serial_number: str, test_id: str):
    """Get current status of a test - No device type validation"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            cursor.execute("""
                SELECT current_stage, completed_tests
                FROM devices 
                WHERE serial_number = %s
            """, (serial_number,))
            
            result = cursor.fetchone()
            
            if not result:
                raise HTTPException(
                    status_code=404,
                    detail=f"Device {serial_number} not found"
                )
            
            completed_tests = result['completed_tests'] or []
            current_stage = result['current_stage']
            
            # Determine test status
            if test_id in completed_tests:
                status = "completed"
            elif test_id == current_stage:
                status = "running"
            else:
                status = "pending"
            
            return {
                "test_id": test_id,
                "status": status,
                "start_time": None,
                "end_time": None,
                "result": "pass" if test_id in completed_tests else None,
                "error_message": None
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting test status for {serial_number}/{test_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/devices/{serial_number}/tests/{test_id}/complete")
async def complete_test(serial_number: str, test_id: str):
    """Complete a test for a device - No device type validation"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Get current device state
            cursor.execute("""
                SELECT completed_tests, current_stage
                FROM devices 
                WHERE serial_number = %s
            """, (serial_number,))
            
            result = cursor.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail=f"Device {serial_number} not found")
            
            completed_tests = list(result['completed_tests'] or [])
            
            # Add test to completed if not already there
            if test_id not in completed_tests:
                completed_tests.append(test_id)
            
            # Set next stage to 'completed' or manual selection
            # Since we don't have device type validation, operator will manually select next test
            next_stage = 'completed'  # Default to completed, operator can change manually
            
            # Update device
            cursor.execute("""
                UPDATE devices 
                SET completed_tests = %s, current_stage = %s
                WHERE serial_number = %s
            """, (completed_tests, next_stage, serial_number))
            
            conn.commit()
            
            return {
                "message": f"Test {test_id} completed successfully",
                "data": {"test_id": test_id, "status": "completed", "next_test": next_stage}
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error completing test {test_id} for device {serial_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/devices")
async def get_all_devices(limit: int = 50, offset: int = 0):
    """Get all devices - No device type validation"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Get devices with pagination
            cursor.execute("""
                SELECT serial_number, current_stage, completed_tests
                FROM devices 
                ORDER BY serial_number
                LIMIT %s OFFSET %s
            """, (limit, offset))
            
            devices = cursor.fetchall()
            
            device_list = []
            for device in devices:
                completed_tests = device['completed_tests'] or []
                
                # Get test name for current stage if it exists
                current_test_name = None
                if device['current_stage'] and device['current_stage'] not in ['not_started', 'completed']:
                    cursor.execute("""
                        SELECT test_name FROM test_definitions 
                        WHERE test_id = %s
                    """, (device['current_stage'],))
                    test_def = cursor.fetchone()
                    if test_def:
                        current_test_name = test_def['test_name']
                
                # Determine status
                if device['current_stage'] == 'completed':
                    status = "completed"
                elif completed_tests:
                    status = "in_progress"
                else:
                    status = "not_started"
                
                device_list.append({
                    "serial_number": device['serial_number'],
                    "device_type": None,  # Not needed
                    "current_stage": device['current_stage'],
                    "current_test_name": current_test_name,
                    "completed_tests_count": len(completed_tests),
                    "completed_tests": completed_tests,
                    "status": status
                })
            
            # Get total count
            cursor.execute("SELECT COUNT(*) FROM devices")
            total_count = cursor.fetchone()['count']
            
            return {
                "devices": device_list,
                "total_count": total_count,
                "limit": limit,
                "offset": offset
            }
            
    except Exception as e:
        logger.error(f"Error getting all devices: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Additional backend endpoints to support the enhanced frontend

# Add these endpoints to manufacturing_workflow_module.py

# @router.get("/devices/by-type/{device_type}")
# async def get_devices_by_type(
#     device_type: str,
#     mo_number: Optional[str] = None,
#     current_user: dict = Depends(get_current_user)
# ):
#     """Get all devices for a specific device type, optionally filtered by MO"""
#     try:
#         with get_db_connection() as conn:
#             cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
#             # Base query to get devices
#             base_query = """
#                 SELECT d.serial_number, d.current_stage, d.completed_tests,
#                        CASE 
#                            WHEN d.current_stage = 'completed' THEN 'completed'
#                            WHEN array_length(d.completed_tests, 1) > 0 THEN 'in_progress'
#                            ELSE 'not_started'
#                        END as status
#                 FROM devices d
#                 WHERE 1=1
#             """
            
#             params = []
            
#             # Filter by device type - check if serial number starts with device type
#             # Since we removed device type validation, we'll use pattern matching
#             if device_type:
#                 base_query += " AND (d.serial_number LIKE %s OR d.serial_number LIKE %s)"
#                 params.extend([f"{device_type}%", f"{device_type}-%"])
            
#             # Add MO filtering if needed (you can implement this based on your schema)
#             # For now, we'll skip MO filtering since devices table doesn't have MO reference
            
#             base_query += " ORDER BY d.serial_number"
            
#             cursor.execute(base_query, params)
#             devices = cursor.fetchall()
            
#             device_list = []
#             for device in devices:
#                 completed_tests = device['completed_tests'] or []
                
#                 # Get current test name if available
#                 current_test_name = None
#                 if device['current_stage'] and device['current_stage'] not in ['not_started', 'completed']:
#                     cursor.execute("""
#                         SELECT test_name FROM test_definitions 
#                         WHERE test_id = %s
#                     """, (device['current_stage'],))
#                     test_def = cursor.fetchone()
#                     if test_def:
#                         current_test_name = test_def['test_name']
                
#                 device_list.append({
#                     "serial_number": device['serial_number'],
#                     "device_type": device_type,
#                     "current_stage": device['current_stage'],
#                     "current_test_name": current_test_name,
#                     "completed_tests_count": len(completed_tests),
#                     "completed_tests": completed_tests,
#                     "status": device['status']
#                 })
            
#             log_action(
#                 current_user['user_id'], 
#                 'list_devices_by_type', 
#                 'manufacturing_workflow', 
#                 f"Retrieved {len(device_list)} devices for type {device_type}"
#             )
            
#             return {
#                 "device_type": device_type,
#                 "mo_number": mo_number,
#                 "devices": device_list,
#                 "total_count": len(device_list)
#             }
            
#     except Exception as e:
#         logger.error(f"Error getting devices for type {device_type}: {e}")
#         raise HTTPException(status_code=500, detail=str(e))
@router.get("/pdf/{filename}")
async def serve_pdf(filename: str):
    """Serve PDF files"""
    file_path = os.path.join("procedures", filename)
    if os.path.exists(file_path):
        return FileResponse(
            file_path,
            media_type='application/pdf',
            headers={"Content-Disposition": f"inline; filename={filename}"}
        )
    else:
        raise HTTPException(status_code=404, detail="PDF not found")
@router.get("/devices/{serial_number}/next-step")
async def get_device_next_step(
    serial_number: str,
    current_user: dict = Depends(get_current_user)
):
    """Get the next test step for a device"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Get device details
            cursor.execute("""
                SELECT serial_number, current_stage, completed_tests
                FROM devices 
                WHERE serial_number = %s
            """, (serial_number,))
            
            device = cursor.fetchone()
            if not device:
                raise HTTPException(status_code=404, detail=f"Device {serial_number} not found")
            
            current_stage = device['current_stage']
            completed_tests = device['completed_tests'] or []
            
            # Determine next step
            if current_stage == 'completed':
                next_step = None
                next_step_name = "All tests completed"
            elif current_stage == 'not_started':
                next_step = "not_started"
                next_step_name = "Ready to start first test"
            elif current_stage:
                # Get test name for current stage
                cursor.execute("""
                    SELECT test_name FROM test_definitions 
                    WHERE test_id = %s
                """, (current_stage,))
                test_def = cursor.fetchone()
                next_step = current_stage
                next_step_name = test_def['test_name'] if test_def else current_stage
            else:
                next_step = None
                next_step_name = "No next step defined"
            
            return {
                "serial_number": serial_number,
                "current_stage": current_stage,
                "next_step": next_step,
                "next_step_name": next_step_name,
                "completed_tests_count": len(completed_tests),
                "can_continue": next_step is not None and next_step != "completed"
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting next step for {serial_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/devices/{serial_number}/continue")
async def continue_device_testing(
    serial_number: str,
    current_user: dict = Depends(get_current_user)
):
    """Mark that user wants to continue testing this device"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Get device current stage
            cursor.execute("""
                SELECT current_stage FROM devices 
                WHERE serial_number = %s
            """, (serial_number,))
            
            device = cursor.fetchone()
            if not device:
                raise HTTPException(status_code=404, detail=f"Device {serial_number} not found")
            
            current_stage = device['current_stage']
            
            if not current_stage or current_stage in ['completed', 'not_started']:
                raise HTTPException(
                    status_code=400, 
                    detail="Device has no active test to continue"
                )
            
            # Log the continue action
            log_action(
                current_user['user_id'],
                'continue_testing',
                'manufacturing_workflow',
                f"User continued testing for device {serial_number} at stage {current_stage}"
            )
            
            return {
                "message": f"Continuing testing for device {serial_number}",
                "current_stage": current_stage,
                "redirect_to": f"test_module_{current_stage}",  # Frontend can use this
                "device_serial": serial_number
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error continuing testing for {serial_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/manufacturing-orders/{mo_number}/device-types/{device_type}/summary")
async def get_device_type_summary(
    mo_number: str,
    device_type: str,
    current_user: dict = Depends(get_current_user)
):
    """Get summary of devices for a specific device type in an MO"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Get devices for this device type
            cursor.execute("""
                SELECT d.serial_number, d.current_stage, d.completed_tests,
                       CASE 
                           WHEN d.current_stage = 'completed' THEN 'completed'
                           WHEN array_length(d.completed_tests, 1) > 0 THEN 'in_progress'
                           ELSE 'not_started'
                       END as status
                FROM devices d
                WHERE (d.serial_number LIKE %s OR d.serial_number LIKE %s)
                ORDER BY d.serial_number
            """, (f"{device_type}%", f"{device_type}-%"))
            
            devices = cursor.fetchall()
            
            # Calculate summary statistics
            total_devices = len(devices)
            completed_count = sum(1 for d in devices if d['status'] == 'completed')
            in_progress_count = sum(1 for d in devices if d['status'] == 'in_progress')
            not_started_count = sum(1 for d in devices if d['status'] == 'not_started')
            
            # Get requirement from MO
            cursor.execute("""
                SELECT quantity FROM manufacturing_order_devices 
                WHERE manufacturing_order_number = %s AND device_type = %s
            """, (mo_number, device_type))
            
            requirement_row = cursor.fetchone()
            required_quantity = requirement_row['quantity'] if requirement_row else 0
            
            return {
                "mo_number": mo_number,
                "device_type": device_type,
                "required_quantity": required_quantity,
                "actual_devices": total_devices,
                "completed": completed_count,
                "in_progress": in_progress_count,
                "not_started": not_started_count,
                "completion_percentage": (completed_count / required_quantity * 100) if required_quantity > 0 else 0,
                "devices": [dict(device) for device in devices]
            }
            
    except Exception as e:
        logger.error(f"Error getting device type summary for {mo_number}/{device_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Enhanced device search with better filtering
@router.get("/devices/search")
async def search_devices(
    q: Optional[str] = None,
    device_type: Optional[str] = None,
    status: Optional[str] = None,
    mo_number: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user)
):
    """Enhanced device search with multiple filters"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Build dynamic query
            base_query = """
                SELECT d.serial_number, d.current_stage, d.completed_tests,
                       CASE 
                           WHEN d.current_stage = 'completed' THEN 'completed'
                           WHEN array_length(d.completed_tests, 1) > 0 THEN 'in_progress'
                           ELSE 'not_started'
                       END as status
                FROM devices d
                WHERE 1=1
            """
            
            params = []
            
            # Add filters
            if q:
                base_query += " AND d.serial_number ILIKE %s"
                params.append(f"%{q}%")
            
            if device_type:
                base_query += " AND (d.serial_number LIKE %s OR d.serial_number LIKE %s)"
                params.extend([f"{device_type}%", f"{device_type}-%"])
            
            # Add status filter in HAVING clause since status is calculated
            having_clause = ""
            if status:
                having_clause = f" HAVING status = %s"
                params.append(status)
            
            # Add ordering and pagination
            base_query += having_clause + " ORDER BY d.serial_number LIMIT %s OFFSET %s"
            params.extend([limit, offset])
            
            cursor.execute(base_query, params)
            devices = cursor.fetchall()
            
            # Get total count for pagination
            count_query = base_query.replace("LIMIT %s OFFSET %s", "").replace(
                "SELECT d.serial_number, d.current_stage, d.completed_tests, CASE WHEN d.current_stage = 'completed' THEN 'completed' WHEN array_length(d.completed_tests, 1) > 0 THEN 'in_progress' ELSE 'not_started' END as status",
                "SELECT COUNT(*)"
            )
            cursor.execute(count_query, params[:-2])  # Remove limit/offset params
            total_count = cursor.fetchone()['count']
            
            return {
                "devices": [dict(device) for device in devices],
                "total_count": total_count,
                "limit": limit,
                "offset": offset,
                "filters": {
                    "search_query": q,
                    "device_type": device_type,
                    "status": status,
                    "mo_number": mo_number
                }
            }
            
    except Exception as e:
        logger.error(f"Error searching devices: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Debug Endpoints
@router.get("/debug/devices")
async def debug_existing_devices():
    """Debug endpoint to see existing devices - No device type validation"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            cursor.execute("""
                SELECT serial_number, current_stage, completed_tests
                FROM devices 
                ORDER BY serial_number
                LIMIT 20
            """)
            
            devices = cursor.fetchall()
            
            device_list = []
            for device in devices:
                completed_count = len(device['completed_tests'] or [])
                
                device_list.append({
                    "serial_number": device['serial_number'],
                    "device_type": None,  # Not needed
                    "current_stage": device['current_stage'],
                    "completed_tests_count": completed_count,
                    "completed_tests": device['completed_tests']
                })
            
            return {
                "total_devices": len(device_list),
                "devices": device_list
            }
            
    except Exception as e:
        return {"error": str(e)}

@router.get("/debug/device-types/{device_type}")
async def debug_device_type_data(device_type: str):
    """Debug endpoint to see raw data structure from your existing table"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            query = "SELECT * FROM device_test_sequences WHERE device_type = %s"
            cursor.execute(query, (device_type,))
            result = cursor.fetchone()
            
            return {"raw_data": dict(result) if result else None}
            
    except Exception as e:
        return {"error": str(e)}

@router.get("/debug/table-structure/{table_name}")
async def debug_table_structure(table_name: str):
    """Debug endpoint to check table structure"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            query = """
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = %s
            ORDER BY ordinal_position
            """
            cursor.execute(query, (table_name,))
            columns = cursor.fetchall()
            
            return {
                "table_name": table_name,
                "columns": [dict(col) for col in columns]
            }
            
    except Exception as e:
        return {"error": str(e)}
# Simplified Manufacturing Workflow Module
# Add these endpoints to your existing manufacturing_workflow_module.py

@router.get("/device-types/{device_type}/test-sequence-with-instructions")
async def get_test_sequence_with_instructions(device_type: str):
    """Get test sequence with work instruction PDFs"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Get test sequence
            cursor.execute("""
                SELECT test_sequence 
                FROM device_test_sequences 
                WHERE device_type = %s
            """, (device_type,))
            
            result = cursor.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail=f"Device type {device_type} not found")
            
            test_sequences = result['test_sequence']
            if isinstance(test_sequences, list):
                test_sequences.sort(key=lambda x: int(x.get('sequence_order', 0)))
                
                # Get test definitions with work instructions
                test_ids = [test['test_id'] for test in test_sequences]
                
                if test_ids:
                    placeholders = ','.join(['%s'] * len(test_ids))
                    cursor.execute(f"""
                        SELECT test_id, test_name, description, 
                               estimated_duration_minutes, work_instruction_pdf
                        FROM test_definitions 
                        WHERE test_id IN ({placeholders})
                    """, test_ids)
                    
                    test_definitions = {row['test_id']: row for row in cursor.fetchall()}
                else:
                    test_definitions = {}
                
                # Combine test sequence with definitions and PDFs
                detailed_tests = []
                for test in test_sequences:
                    test_def = test_definitions.get(test['test_id'], {})
                    is_required = test.get('is_required', True)
                    if isinstance(is_required, str):
                        is_required = is_required.lower() == 'true'
                    
                    detailed_tests.append({
                        "test_id": test['test_id'],
                        "test_name": test_def.get('test_name', test['test_id']),
                        "description": test_def.get('description', ''),
                        "sequence_order": test['sequence_order'],
                        "is_required": is_required,
                        "estimated_duration_minutes": test_def.get('estimated_duration_minutes', 0),
                        "work_instruction_pdf": test_def.get('work_instruction_pdf')
                    })
                
                return {"test_sequence": detailed_tests}
            
            return {"test_sequence": []}
            
    except Exception as e:
        logger.error(f"Error getting test sequence for {device_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/devices/by-type/{device_type}")
async def get_devices_by_type_simple(device_type: str):
    """Get all devices for a device type with simplified info"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Get devices that match this device type
            cursor.execute("""
                SELECT d.serial_number, d.current_stage, d.completed_tests, 
                       d.created_at, d.device_type,
                       CASE 
                           WHEN d.current_stage = 'completed' THEN 'completed'
                           WHEN array_length(d.completed_tests, 1) > 0 THEN 'in_progress'
                           ELSE 'not_started'
                       END as status
                FROM devices d
                WHERE d.device_type = %s
                ORDER BY d.created_at DESC
            """, (device_type,))
            
            devices = cursor.fetchall()
            
            # Enhance with current test name
            enhanced_devices = []
            for device in devices:
                device_dict = dict(device)
                
                # Get current test name if available
                if device['current_stage'] and device['current_stage'] not in ['not_started', 'completed']:
                    cursor.execute("""
                        SELECT test_name FROM test_definitions 
                        WHERE test_id = %s
                    """, (device['current_stage'],))
                    test_def = cursor.fetchone()
                    device_dict['current_test_name'] = test_def['test_name'] if test_def else device['current_stage']
                else:
                    device_dict['current_test_name'] = None
                
                # Convert datetime to string
                if device_dict['created_at']:
                    device_dict['created_at'] = device_dict['created_at'].isoformat()
                
                enhanced_devices.append(device_dict)
            
            return {"devices": enhanced_devices}
            
    except Exception as e:
        logger.error(f"Error getting devices for type {device_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/devices/create")
async def create_device_simplified(
    serial_number: str,
    device_type: str,
    current_user: dict = Depends(get_current_user)
):
    """Create a new device with automatic test sequence setup"""
    try:
        serial_number = serial_number.strip()
        device_type = device_type.strip()
        
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Check if device already exists
            cursor.execute("""
                SELECT serial_number FROM devices WHERE serial_number = %s
            """, (serial_number,))
            
            if cursor.fetchone():
                raise HTTPException(status_code=409, detail=f"Device {serial_number} already exists")
            
            # Get test sequence for this device type
            cursor.execute("""
                SELECT test_sequence FROM device_test_sequences WHERE device_type = %s
            """, (device_type,))
            
            test_seq_result = cursor.fetchone()
            if not test_seq_result:
                raise HTTPException(status_code=404, detail=f"No test sequence found for device type: {device_type}")
            
            # Parse the test sequence
            test_sequences = test_seq_result['test_sequence']
            required_tests = []
            first_test = 'not_started'
            
            if isinstance(test_sequences, list):
                test_sequences.sort(key=lambda x: int(x.get('sequence_order', 0)))
                
                # Get required tests in order
                for test in test_sequences:
                    is_required = test.get('is_required', True)
                    if isinstance(is_required, str):
                        is_required = is_required.lower() == 'true'
                    if is_required:
                        required_tests.append(test['test_id'])
                
                # Set first test as current stage
                if required_tests:
                    first_test = required_tests[0]
            
            # Insert device
            cursor.execute("""
                INSERT INTO devices (
                    serial_number, 
                    device_type,
                    current_stage, 
                    completed_tests,
                    required_tests,
                    created_at
                )
                VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                RETURNING serial_number, device_type, current_stage, created_at
            """, (serial_number, device_type, first_test, [], required_tests))
            
            new_device = cursor.fetchone()
            conn.commit()
            
            # Log the action
            log_action(
                current_user['user_id'],
                'create_device',
                'manufacturing_workflow',
                f"Created device {serial_number} of type {device_type}"
            )
            
            return {
                "message": f"Device {serial_number} created successfully",
                "device": {
                    "serial_number": new_device['serial_number'],
                    "device_type": new_device['device_type'],
                    "current_stage": new_device['current_stage'],
                    "created_at": new_device['created_at'].isoformat()
                }
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating device {serial_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Initialize DB pool on module load
init_db_pool()