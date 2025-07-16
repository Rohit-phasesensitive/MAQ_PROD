# modules/manufacturing_orders_module.py - Manufacturing Order Management (No ID Column)

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import os
import json
import uuid
import datetime
import jwt
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from dotenv import load_dotenv
import shutil
from pathlib import Path

# Load environment variables
load_dotenv()

# Router for manufacturing orders
mo_router = APIRouter()

# Security
security = HTTPBearer()
SECRET_KEY = os.getenv('SECRET_KEY', 'default-dev-key-change-in-production')

# File storage configuration
UPLOAD_DIR = Path(os.getenv('UPLOAD_DIR', './uploads/manufacturing_orders'))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Database configuration
DATABASE_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'database': os.getenv('DB_NAME', 'MAQ_Lab_Manager'),
    'user': os.getenv('DB_USER', 'karthi'),
    'password': os.getenv('DB_PASSWORD', 'maq001')
}

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
class DeviceDetail(BaseModel):
    device_type: str
    quantity: int
    description: Optional[str] = ""

class ManufacturingOrderCreate(BaseModel):
    manufacturing_order_number: str
    customer_name: str
    product_line: str
    device_details: List[DeviceDetail]
    priority: str = "medium"
    due_date: Optional[str] = None
    notes: Optional[str] = ""

class OrderStatusUpdate(BaseModel):
    status: str

class DeviceTypeValidation(BaseModel):
    product_line: str
    device_types: List[str]

# Helper functions
def save_uploaded_file(file: UploadFile, mo_number: str) -> tuple:
    """Save uploaded file and return file path and original filename"""
    try:
        # Create unique filename
        file_extension = Path(file.filename).suffix
        unique_filename = f"{mo_number}_{uuid.uuid4()}{file_extension}"
        file_path = UPLOAD_DIR / unique_filename
        
        # Save file
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        return str(file_path), file.filename
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

def validate_device_types_for_product_line(product_line: str, device_types: List[str]) -> bool:
    """Validate device types against product line"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT device_type FROM device_types 
                WHERE product_line = %s AND device_type = ANY(%s)
            """, (product_line, device_types))
            
            valid_types = [row[0] for row in cursor.fetchall()]
            return len(valid_types) == len(device_types)
            
    except Exception as e:
        print(f"Error validating device types: {e}")
        return False

# API Endpoints

@mo_router.get("/product-lines")
async def get_product_lines(current_user: dict = Depends(get_current_user)):
    """Get available product lines"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT product_line FROM product_lines ORDER BY product_line")
            rows = cursor.fetchall()
            
            product_lines = [row[0] for row in rows]
            return {"product_lines": product_lines}
            
    except Exception as e:
        print(f"❌ Error getting product lines: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve product lines")

@mo_router.get("/device-types")
async def get_device_types(
    product_line: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get available device types, optionally filtered by product line"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            if product_line:
                cursor.execute("""
                    SELECT device_type, description FROM device_types 
                    WHERE product_line = %s ORDER BY device_type
                """, (product_line,))
            else:
                cursor.execute("""
                    SELECT device_type, description FROM device_types 
                    ORDER BY device_type
                """)
            
            rows = cursor.fetchall()
            device_types = [{"device_type": row[0], "description": row[1]} for row in rows]
            return {"device_types": device_types}
            
    except Exception as e:
        print(f"❌ Error getting device types: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve device types")

@mo_router.post("/validate-device-types")
async def validate_device_types(
    validation_data: DeviceTypeValidation,
    current_user: dict = Depends(get_current_user)
):
    """Validate device types against product line"""
    try:
        is_valid = validate_device_types_for_product_line(
            validation_data.product_line, 
            validation_data.device_types
        )
        return {"valid": is_valid}
    except Exception as e:
        print(f"❌ Error validating device types: {e}")
        raise HTTPException(status_code=500, detail="Failed to validate device types")

@mo_router.post("/manufacturing-orders")
async def create_manufacturing_order(
    manufacturing_order_number: str = Form(...),
    customer_name: str = Form(...),
    product_line: str = Form(...),
    device_details: str = Form(""),  # JSON string of device details
    priority: str = Form("medium"),
    due_date: Optional[str] = Form(None),
    notes: Optional[str] = Form(""),
    file: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    """Create new manufacturing order (admin only)"""
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    try:
        print("=== DEBUG: Manufacturing Order Creation ===")
        print(f"manufacturing_order_number: '{manufacturing_order_number}'")
        print(f"customer_name: '{customer_name}'")
        print(f"product_line: '{product_line}'")
        print(f"device_details: '{device_details}'")
        print(f"priority: '{priority}'")
        print(f"due_date: '{due_date}'")
        print(f"notes: '{notes}'")
        print(f"file: {file}")
        print(f"current_user: {current_user}")
        print("=== END DEBUG ===")

        # Parse device details
        device_list = []
        if device_details:
            try:
                device_list = json.loads(device_details)
                print(f"✅ Parsed device_list: {device_list}")
            except json.JSONDecodeError as json_err:
                print(f"❌ JSON decode error: {json_err}")
                raise HTTPException(status_code=400, detail="Invalid device details format")
        
        # Validate device types for product line
        device_types_to_validate = [d['device_type'] for d in device_list]
        if device_types_to_validate:
            print(f"🔍 Validating device types: {device_types_to_validate}")
            is_valid = validate_device_types_for_product_line(product_line, device_types_to_validate)
            print(f"✅ Device validation result: {is_valid}")
            if not is_valid:
                raise HTTPException(status_code=400, detail="Some device types are not valid for the selected product line")
        
        file_path = None
        original_filename = None
        
        # Handle file upload
        if file and file.filename:
            print(f"📁 Processing file upload: {file.filename}")
            file_path, original_filename = save_uploaded_file(file, manufacturing_order_number)
            print(f"✅ File saved to: {file_path}")
        
        print("🔗 Connecting to database...")
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check if MO number already exists
            print(f"🔍 Checking if MO number exists: {manufacturing_order_number}")
            try:
                cursor.execute(
                    "SELECT manufacturing_order_number FROM manufacturing_orders WHERE manufacturing_order_number = %s",
                    (manufacturing_order_number,)
                )
                existing_mo = cursor.fetchone()
                print(f"✅ MO check completed, existing: {existing_mo}")
                if existing_mo:
                    raise HTTPException(status_code=400, detail="Manufacturing order number already exists")
            except Exception as check_error:
                print(f"❌ MO check failed: {check_error}")
                raise check_error
            
            # Insert manufacturing order
            print("💾 Inserting manufacturing order...")
            print(f"📊 Insert values:")
            print(f"  manufacturing_order_number: '{manufacturing_order_number}'")
            print(f"  customer_name: '{customer_name}'")
            print(f"  product_line: '{product_line}'")
            print(f"  priority: '{priority}'")
            print(f"  due_date: '{due_date}' -> {due_date if due_date != 'None' else None}")
            print(f"  file_path: {file_path}")
            print(f"  original_filename: {original_filename}")
            print(f"  notes: '{notes}'")
            print(f"  created_by: {current_user['user_id']}")
            
            # Prepare the values tuple
            insert_values = (
                manufacturing_order_number, 
                customer_name, 
                product_line, 
                priority,
                due_date if due_date != 'None' else None,
                file_path, 
                original_filename, 
                notes, 
                current_user['user_id']
            )
            print(f"🔧 Prepared insert values: {insert_values}")
            
            try:
                print("🚀 Executing INSERT statement...")
                cursor.execute("""
                    INSERT INTO manufacturing_orders 
                    (manufacturing_order_number, customer_name, product_line, priority, due_date, 
                     file_path, original_filename, notes, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, insert_values)
                print("✅ INSERT executed successfully")
                
            except Exception as insert_error:
                print(f"❌ INSERT failed: {insert_error}")
                print(f"❌ INSERT error type: {type(insert_error).__name__}")
                print(f"❌ INSERT error args: {insert_error.args}")
                import traceback
                print(f"❌ Full traceback:\n{traceback.format_exc()}")
                raise insert_error
            
            # Insert device details
            print("💾 Inserting device details...")
            for i, device in enumerate(device_list):
                print(f"  - Inserting device {i+1}: {device}")
                try:
                    cursor.execute("""
                        INSERT INTO manufacturing_order_devices 
                        (manufacturing_order_number, device_type, quantity, description)
                        VALUES (%s, %s, %s, %s)
                    """, (manufacturing_order_number, device['device_type'], device['quantity'], device.get('description', '')))
                    print(f"    ✅ Device {i+1} inserted successfully")
                except Exception as device_error:
                    print(f"    ❌ Device {i+1} insert failed: {device_error}")
                    raise device_error
            
            conn.commit()
            print("✅ Transaction committed successfully")
            
        # Log the action
        try:
            log_action(current_user['user_id'], 'create_manufacturing_order', 'mo_management',
                      f"Created MO: {manufacturing_order_number} for product line: {product_line}")
            print("✅ Action logged successfully")
        except Exception as log_error:
            print(f"⚠️ Logging failed (non-critical): {log_error}")
        
        print("🎉 Manufacturing order creation completed successfully!")
        return {
            "success": True,
            "message": "Manufacturing order created successfully",
            "manufacturing_order_number": manufacturing_order_number
        }
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"❌ Error creating manufacturing order: {e}")
        print(f"❌ Error type: {type(e).__name__}")
        print(f"❌ Full traceback:\n{error_details}")
        raise HTTPException(status_code=500, detail=f"Failed to create manufacturing order: {str(e)}")

@mo_router.get("/manufacturing-orders")
async def get_manufacturing_orders(
    status: Optional[str] = "all",
    priority: Optional[str] = "all",
    product_line: Optional[str] = "all",
    limit: Optional[int] = 100,
    current_user: dict = Depends(get_current_user)
):
    """Get manufacturing orders with filters"""
    if current_user['role'] not in ['admin', 'operator']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        print("=== DEBUG: Fetching Manufacturing Orders ===")
        
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Build query with filters
            where_conditions = []
            params = []
            
            if status != "all":
                where_conditions.append("mo.status = %s")
                params.append(status)
            
            if priority != "all":
                where_conditions.append("mo.priority = %s")
                params.append(priority)
                
            if product_line != "all":
                where_conditions.append("mo.product_line = %s")
                params.append(product_line)
            
            where_clause = ""
            if where_conditions:
                where_clause = "WHERE " + " AND ".join(where_conditions)
            
            # Simplified query without JOIN to users table for now
            query = f"""
                SELECT mo.*
                FROM manufacturing_orders mo
                {where_clause}
                ORDER BY mo.created_at DESC
                LIMIT %s
            """
            
            params.append(limit)
            print(f"Executing query: {query}")
            print(f"With parameters: {params}")
            
            cursor.execute(query, params)
            rows = cursor.fetchall()
            print(f"Found {len(rows)} manufacturing orders")
            
            orders = []
            for row in rows:
                print(f"Processing order: {row['manufacturing_order_number']}")
                
                # Get device details for each MO
                try:
                    cursor.execute("""
                        SELECT device_type, quantity, description
                        FROM manufacturing_order_devices
                        WHERE manufacturing_order_number = %s
                    """, (row['manufacturing_order_number'],))
                    device_details = cursor.fetchall()
                    print(f"Found {len(device_details)} devices for {row['manufacturing_order_number']}")
                except Exception as device_error:
                    print(f"Error fetching devices: {device_error}")
                    device_details = []
                
                orders.append({
                    "manufacturing_order_number": row['manufacturing_order_number'],
                    "customer_name": row['customer_name'],
                    "product_line": row['product_line'],
                    "priority": row['priority'],
                    "due_date": row['due_date'].isoformat() if row['due_date'] else None,
                    "status": row['status'],
                    "has_file": bool(row['file_path']),
                    "original_filename": row['original_filename'],
                    "device_details": [dict(device) for device in device_details],
                    "notes": row['notes'],
                    "created_at": row['created_at'].isoformat() if row['created_at'] else None,
                    "created_by_username": f"User {row['created_by']}"  # Temporary placeholder
                })
            
            print(f"Successfully processed {len(orders)} orders")
            return {"orders": orders, "count": len(orders)}
            
    except Exception as e:
        print(f"❌ Error getting manufacturing orders: {e}")
        import traceback
        print(f"❌ Full traceback:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve manufacturing orders: {str(e)}")

@mo_router.get("/manufacturing-orders/{mo_number}/file")
async def download_manufacturing_order_file(
    mo_number: str,
    current_user: dict = Depends(get_current_user)
):
    """Download manufacturing order file"""
    if current_user['role'] not in ['admin', 'operator']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT file_path, original_filename
                FROM manufacturing_orders
                WHERE manufacturing_order_number = %s
            """, (mo_number,))
            
            result = cursor.fetchone()
            if not result or not result[0]:
                raise HTTPException(status_code=404, detail="File not found")
            
            file_path, original_filename = result
            
            if not os.path.exists(file_path):
                raise HTTPException(status_code=404, detail="File not found on disk")
            
            return FileResponse(
                path=file_path,
                filename=original_filename,
                media_type='application/octet-stream'
            )
            
    except Exception as e:
        print(f"❌ Error downloading file: {e}")
        raise HTTPException(status_code=500, detail="Failed to download file")

@mo_router.put("/manufacturing-orders/{mo_number}/status")
async def update_manufacturing_order_status(
    mo_number: str,
    update_data: OrderStatusUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update manufacturing order status"""
    if current_user['role'] not in ['admin', 'operator']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE manufacturing_orders 
                SET status = %s, updated_at = CURRENT_TIMESTAMP
                WHERE manufacturing_order_number = %s
                RETURNING manufacturing_order_number
            """, (update_data.status, mo_number))
            
            result = cursor.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Manufacturing order not found")
            
            conn.commit()
            
        log_action(current_user['user_id'], 'update_mo_status', 'mo_management',
                  f"Updated MO {mo_number} status to {update_data.status}")
        
        return {"success": True, "message": "Manufacturing order status updated successfully"}
        
    except Exception as e:
        print(f"❌ Error updating manufacturing order status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update manufacturing order status: {str(e)}")

@mo_router.get("/analytics/summary")
async def get_order_analytics(current_user: dict = Depends(get_current_user)):
    """Get manufacturing order analytics summary"""
    if current_user['role'] not in ['admin', 'operator']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Manufacturing order statistics
            cursor.execute("""
                SELECT status, COUNT(*) as count
                FROM manufacturing_orders
                GROUP BY status
            """)
            mo_status_counts = dict(cursor.fetchall())
            
            # Priority statistics
            cursor.execute("""
                SELECT priority, COUNT(*) as count
                FROM manufacturing_orders
                GROUP BY priority
            """)
            priority_counts = dict(cursor.fetchall())
            
            # Product line statistics
            cursor.execute("""
                SELECT 
                    mo.product_line,
                    COUNT(DISTINCT mo.manufacturing_order_number) as manufacturing_orders,
                    COALESCE(SUM(mod.quantity), 0) as total_devices
                FROM manufacturing_orders mo
                LEFT JOIN manufacturing_order_devices mod ON mo.manufacturing_order_number = mod.manufacturing_order_number
                GROUP BY mo.product_line
                ORDER BY manufacturing_orders DESC
            """)
            product_line_stats = [
                {
                    "product_line": row[0],
                    "manufacturing_orders": row[1],
                    "total_devices": row[2] or 0
                }
                for row in cursor.fetchall()
            ]
            
            # Device type statistics by product line
            cursor.execute("""
                SELECT 
                    mo.product_line,
                    mod.device_type,
                    SUM(mod.quantity) as total_quantity,
                    COUNT(DISTINCT mo.manufacturing_order_number) as order_count
                FROM manufacturing_orders mo
                JOIN manufacturing_order_devices mod ON mo.manufacturing_order_number = mod.manufacturing_order_number
                GROUP BY mo.product_line, mod.device_type
                ORDER BY mo.product_line, total_quantity DESC
            """)
            device_stats = [
                {
                    "product_line": row[0],
                    "device_type": row[1],
                    "total_quantity": row[2],
                    "order_count": row[3]
                }
                for row in cursor.fetchall()
            ]
            
            # Recent activity
            cursor.execute("""
                SELECT 
                    (SELECT COUNT(*) FROM manufacturing_orders WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as mo_this_week,
                    (SELECT COUNT(*) FROM manufacturing_orders WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as mo_this_month
            """)
            recent_activity = cursor.fetchone()
            
            return {
                "manufacturing_order_stats": mo_status_counts,
                "priority_stats": priority_counts,
                "product_line_stats": product_line_stats,
                "device_type_stats": device_stats,
                "recent_activity": {
                    "mo_this_week": recent_activity[0] or 0,
                    "mo_this_month": recent_activity[1] or 0
                }
            }
            
    except Exception as e:
        print(f"❌ Error getting analytics: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve analytics")

@mo_router.get("/manufacturing-orders/{mo_number}/details")
async def get_manufacturing_order_details(
    mo_number: str,
    current_user: dict = Depends(get_current_user)
):
    """Get detailed manufacturing order information"""
    if current_user['role'] not in ['admin', 'operator']:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            cursor.execute("""
                SELECT mo.*, u.username as created_by_username
                FROM manufacturing_orders mo
                LEFT JOIN users u ON mo.created_by = u.user_id
                WHERE mo.manufacturing_order_number = %s
            """, (mo_number,))
            
            order = cursor.fetchone()
            if not order:
                raise HTTPException(status_code=404, detail="Manufacturing order not found")
            
            # Get device details
            cursor.execute("""
                SELECT device_type, quantity, description
                FROM manufacturing_order_devices
                WHERE manufacturing_order_number = %s
                ORDER BY device_type
            """, (mo_number,))
            device_details = cursor.fetchall()
            
            order_details = dict(order)
            order_details['device_details'] = [dict(row) for row in device_details]
            order_details['due_date'] = order_details['due_date'].isoformat() if order_details['due_date'] else None
            order_details['created_at'] = order_details['created_at'].isoformat() if order_details['created_at'] else None
            order_details['updated_at'] = order_details['updated_at'].isoformat() if order_details['updated_at'] else None
            
            return order_details
            
    except Exception as e:
        print(f"❌ Error getting manufacturing order details: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve manufacturing order details")

# Helper function for other modules to get MO details
def get_manufacturing_order_by_number(mo_number: str) -> dict:
    """Get manufacturing order details by MO number for integration with other modules"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            cursor.execute("""
                SELECT mo.*, u.username as created_by_username
                FROM manufacturing_orders mo
                LEFT JOIN users u ON mo.created_by = u.user_id
                WHERE mo.manufacturing_order_number = %s
            """, (mo_number,))
            
            result = cursor.fetchone()
            return dict(result) if result else None
            
    except Exception as e:
        print(f"❌ Error getting MO by number: {e}")
        return None

# Export router and helper functions
__all__ = ['mo_router', 'get_manufacturing_order_by_number']

print("✅ Manufacturing Orders module (no ID column) loaded successfully")