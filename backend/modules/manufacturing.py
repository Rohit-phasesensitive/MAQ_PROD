# app/routers/manufacturing.py
# Updated to work with your existing database schema and new requirements

from fastapi import APIRouter, HTTPException, status
from typing import List, Dict, Any, Optional
import json
import logging
from datetime import datetime

from .database import get_db_cursor
from .models import (
    TestSequenceResponse, DeviceRegistration, DeviceResponse, 
    DeviceListResponse, ManufacturingOrderResponse, TestDefinitionsResponse,
    TestStatusResponse, TestResult, ApiResponse
)

router = APIRouter(tags=["manufacturing"])
logger = logging.getLogger(__name__)

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

@router.get("/device-types/{device_type}/test-sequences", response_model=TestSequenceResponse)
async def get_device_test_sequences(device_type: str):
    """
    Get test sequences for a specific device type from your existing table
    """
    try:
        with get_db_cursor() as cursor:
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
            
            # Parse the JSONB test_sequence
            test_sequences = result['test_sequence']
            
            if isinstance(test_sequences, list):
                test_sequences.sort(key=lambda x: int(x.get('sequence_order', 0)))
                
                formatted_sequences = []
                for seq in test_sequences:
                    formatted_sequences.append({
                        "test_id": seq.get("test_id"),
                        "sequence_order": int(seq.get("sequence_order", 0)),
                        "is_required": str(seq.get("is_required", "false")).lower() == "true",
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
        with get_db_cursor() as cursor:
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
                    is_required = str(test.get('is_required', 'false')).lower() == 'true'
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

@router.post("/devices/create")
async def create_device_simple(serial_number: str, device_type: str):
    """Create a new device with default test sequence for the device type"""
    try:
        with get_db_cursor() as cursor:
            # Verify device type exists and get test sequence
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
                # Get first required test
                first_test = None
                for test in test_sequences:
                    if str(test.get('is_required', 'false')).lower() == 'true':
                        first_test = test['test_id']
                        break
            else:
                first_test = None
            
            # Insert device into your actual devices table structure
            cursor.execute("""
                INSERT INTO devices (serial_number, current_stage, completed_tests)
                VALUES (%s, %s, %s)
            """, (serial_number, first_test, []))
            
            return {
                "message": f"Device {serial_number} created successfully",
                "device": {
                    "serial_number": serial_number,
                    "device_type": device_type,
                    "status": "not_started",
                    "current_stage": first_test
                }
            }
            
    except Exception as e:
        if "already exists" in str(e) or "duplicate" in str(e):
            raise HTTPException(status_code=409, detail=f"Device {serial_number} already exists")
        logger.error(f"Error creating device {serial_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/manufacturing-orders", response_model=ManufacturingOrderResponse)
async def get_manufacturing_orders():
    """
    Get list of all manufacturing orders with device type summaries
    """
    try:
        with get_db_cursor() as cursor:
            # Get manufacturing orders (fix field names based on your actual schema)
            simple_query = """
            SELECT 
                manufacturing_order_number,
                product_line as product_name,
                priority,
                due_date,
                created_by as operator
            FROM manufacturing_orders
            ORDER BY due_date, manufacturing_order_number
            """
            
            cursor.execute(simple_query)
            results = cursor.fetchall()
            
            manufacturing_orders = []
            for row in results:
                mo_data = {
                    "manufacturing_order_number": row['manufacturing_order_number'],
                    "product_name": row['product_name'],
                    "priority": row['priority'] or 'medium',
                    "due_date": row['due_date'].isoformat() if row['due_date'] else None,
                    "operator": row['operator'],
                    "device_types": {}
                }
                
                # Get device type requirements (fix field name)
                mod_query = """
                SELECT device_type, quantity 
                FROM manufacturing_order_devices 
                WHERE manufacturing_order_number = %s
                """
                cursor.execute(mod_query, (row['manufacturing_order_number'],))
                device_types = cursor.fetchall()
                
                for dt in device_types:
                    mo_data["device_types"][dt['device_type']] = {
                        "required": dt['quantity'] or 0,
                        "completed": 0,
                        "in_progress": 0
                    }
                
                manufacturing_orders.append(mo_data)
            
            return ManufacturingOrderResponse(manufacturing_orders=manufacturing_orders)
            
    except Exception as e:
        logger.error(f"Error getting manufacturing orders: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/devices/{serial_number}", response_model=DeviceResponse)
async def get_device_details(serial_number: str):
    """
    Get device details and progress - fetch required tests from device_test_sequences table
    """
    try:
        with get_db_cursor() as cursor:
            # 1. Determine device type from serial number
            device_type = get_device_type_from_serial(serial_number)
            if not device_type:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Cannot determine device type from serial number: {serial_number}"
                )
            
            # 2. Get required tests from device_test_sequences table
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
            
            # Parse the JSONB test sequence
            test_sequences = test_seq_result['test_sequence']
            required_tests = []
            
            if isinstance(test_sequences, list):
                test_sequences.sort(key=lambda x: int(x.get('sequence_order', 0)))
                required_tests = [
                    test['test_id'] for test in test_sequences 
                    if str(test.get('is_required', 'false')).lower() == 'true'
                ]
            
            # 3. Check if device exists in devices table
            cursor.execute("""
                SELECT serial_number, current_stage, completed_tests
                FROM devices 
                WHERE serial_number = %s
            """, (serial_number,))
            
            device_row = cursor.fetchone()
            
            if not device_row:
                raise HTTPException(
                    status_code=404, 
                    detail=f"Device {serial_number} not found"
                )
            
            # 4. Process existing device
            completed_steps = list(device_row['completed_tests'] or [])
            
            # Determine status
            if not completed_steps:
                status = "not_started"
            elif len(completed_steps) >= len(required_tests):
                status = "completed" 
            else:
                status = "in_progress"
            
            device_info = {
                "serial_number": device_row['serial_number'],
                "device_type": device_type,
                "manufacturing_order_number": None,  # Not in your actual table
                "status": status,
                "current_step": device_row['current_stage'],
                "completed_steps": completed_steps,
                "required_tests": required_tests,
                "created_at": None  # Not in your actual table
            }
            
            return DeviceResponse(device=device_info)
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting device details for {serial_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/test-definitions", response_model=TestDefinitionsResponse)
async def get_test_definitions():
    """
    Get all test definitions from your existing table
    """
    try:
        with get_db_cursor() as cursor:
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
            
            return TestDefinitionsResponse(test_definitions=test_definitions)
            
    except Exception as e:
        logger.error(f"Error getting test definitions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/devices/{serial_number}/tests/{test_id}/start")
async def start_test(serial_number: str, test_id: str):
    """
    Start a test for a device using your actual table structure
    """
    try:
        with get_db_cursor() as cursor:
            # Update current_stage in your devices table
            update_device = """
            UPDATE devices 
            SET current_stage = %s
            WHERE serial_number = %s
            """
            
            cursor.execute(update_device, (test_id, serial_number))
            
            if cursor.rowcount == 0:
                raise HTTPException(
                    status_code=404,
                    detail=f"Device {serial_number} not found"
                )
            
            return ApiResponse(
                message="Test started successfully",
                data={"test_id": test_id, "status": "running"}
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting test {test_id} for device {serial_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/devices/{serial_number}/tests/{test_id}/status")
async def get_test_status(serial_number: str, test_id: str):
    """
    Get current status of a test using your actual table structure
    """
    try:
        with get_db_cursor() as cursor:
            query = """
            SELECT current_stage, completed_tests
            FROM devices 
            WHERE serial_number = %s
            """
            
            cursor.execute(query, (serial_number,))
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
    """
    Complete a test for a device using your actual table structure
    """
    try:
        with get_db_cursor() as cursor:
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
            
            # Get device type and required tests to find next test
            device_type = get_device_type_from_serial(serial_number)
            if device_type:
                cursor.execute("""
                    SELECT test_sequence 
                    FROM device_test_sequences 
                    WHERE device_type = %s
                """, (device_type,))
                
                test_seq_result = cursor.fetchone()
                if test_seq_result:
                    test_sequences = test_seq_result['test_sequence']
                    if isinstance(test_sequences, list):
                        test_sequences.sort(key=lambda x: int(x.get('sequence_order', 0)))
                        required_tests = [
                            test['test_id'] for test in test_sequences 
                            if str(test.get('is_required', 'false')).lower() == 'true'
                        ]
                        
                        # Find next test
                        try:
                            current_index = required_tests.index(test_id)
                            next_test = required_tests[current_index + 1] if current_index + 1 < len(required_tests) else 'completed'
                        except ValueError:
                            next_test = 'completed'
                    else:
                        next_test = 'completed'
                else:
                    next_test = 'completed'
            else:
                next_test = 'completed'
            
            # Update device
            cursor.execute("""
                UPDATE devices 
                SET completed_tests = %s, current_stage = %s
                WHERE serial_number = %s
            """, (completed_tests, next_test, serial_number))
            
            return ApiResponse(
                message=f"Test {test_id} completed successfully",
                data={"test_id": test_id, "status": "completed", "next_test": next_test}
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error completing test {test_id} for device {serial_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Debug endpoints
@router.get("/debug/devices")
async def debug_existing_devices():
    """Debug endpoint to see existing devices in your actual table"""
    try:
        with get_db_cursor() as cursor:
            query = """
            SELECT serial_number, current_stage, completed_tests
            FROM devices 
            ORDER BY serial_number
            LIMIT 20
            """
            
            cursor.execute(query)
            devices = cursor.fetchall()
            
            device_list = []
            for device in devices:
                device_type = get_device_type_from_serial(device['serial_number'])
                completed_count = len(device['completed_tests'] or [])
                
                device_list.append({
                    "serial_number": device['serial_number'],
                    "device_type": device_type,
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
    """
    Debug endpoint to see raw data structure from your existing table
    """
    try:
        with get_db_cursor() as cursor:
            query = "SELECT * FROM device_test_sequences WHERE device_type = %s"
            cursor.execute(query, (device_type,))
            result = cursor.fetchone()
            
            return {"raw_data": dict(result) if result else None}
            
    except Exception as e:
        return {"error": str(e)}

@router.get("/debug/table-structure/{table_name}")
async def debug_table_structure(table_name: str):
    """
    Debug endpoint to check table structure
    """
    try:
        with get_db_cursor() as cursor:
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