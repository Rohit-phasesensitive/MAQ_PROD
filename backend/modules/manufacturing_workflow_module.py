# modules/manufacturing_orders_module.py
"""
Manufacturing Orders Module for MAQ Lab Manager

This module provides functionality for managing Manufacturing Orders (MOs) and device type requirements.
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
po_mo_router = APIRouter()

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

# Global connection pool
db_pool = None

def init_db_pool():
    """Initialize database connection pool"""
    global db_pool
    try:
        db_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            **DATABASE_CONFIG
        )
        logger.info("Manufacturing Orders DB pool initialized")
        return True
    except Exception as e:
        logger.error(f"Database pool initialization failed: {e}")
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

# Pydantic Models
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

# API Endpoints
@po_mo_router.get("/manufacturing-orders")
async def get_manufacturing_orders(current_user: dict = Depends(get_current_user)):
    """Get all Manufacturing Orders - basic info only"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM manufacturing_orders 
                WHERE LOWER(status) NOT IN ('cancelled', 'canceled')
                ORDER BY created_at DESC
            """)
            
            mos = []
            for row in cursor.fetchall():
                columns = [desc[0] for desc in cursor.description]
                mo_data = dict(zip(columns, row))
                
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
                
                # Initialize empty device_types for list view
                mo_data['device_types'] = {}
                        
                mos.append(mo_data)
        
        logger.info(f"Retrieved {len(mos)} manufacturing orders")
        log_action(current_user['user_id'], 'list_mos', 'po_mo', f"Retrieved {len(mos)} manufacturing orders")
        return {"manufacturing_orders": mos}
        
    except Exception as e:
        logger.error(f"Error getting MOs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve manufacturing orders")

@po_mo_router.get("/manufacturing-orders/{manufacturing_order_number}")
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
            cursor = conn.cursor()
            
            # Get device type requirements from manufacturing_order_devices table
            logger.info(f"Fetching device types from manufacturing_order_devices for MO: {manufacturing_order_number}")
            cursor.execute("""
                SELECT device_type, quantity, description 
                FROM manufacturing_order_devices 
                WHERE manufacturing_order_number = %s
                ORDER BY device_type
            """, (manufacturing_order_number,))
            
            device_type_requirements = {}
            device_types_rows = cursor.fetchall()
            logger.info(f"Found {len(device_types_rows)} device types in manufacturing_order_devices")
            
            for row in device_types_rows:
                device_type, quantity, description = row
                device_type_requirements[device_type] = {
                    'device_type': device_type,
                    'required': quantity,
                    'completed': 0,
                    'in_progress': 0,
                    'description': description or ''
                }
                logger.info(f"Device type: {device_type}, Required: {quantity}")
            
            # Add device_types to MO data
            mo['device_types'] = device_type_requirements
            
            # Since no devices are started yet, devices_by_type is empty
            devices_by_type = {}
            
            # Log summary
            logger.info(f"MO {manufacturing_order_number} has {len(device_type_requirements)} device types:")
            for device_type, data in device_type_requirements.items():
                logger.info(f"  {device_type}: 0/{data['required']} (Not started)")
        
        logger.info(f"Successfully retrieved MO {manufacturing_order_number} with device type requirements")
        
        return {
            "manufacturing_order": mo,
            "devices_by_type": devices_by_type
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting MO {manufacturing_order_number}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve manufacturing order: {str(e)}")

# Initialize DB pool on module load
init_db_pool()