# modules/chip_preparation_module.py - Chip Preparation Backend Module

from fastapi import APIRouter, HTTPException, Depends, File, UploadFile, Form
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import List, Optional
import os
import json
import uuid
import datetime
import asyncio
import jwt
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from dotenv import load_dotenv
from fpdf import FPDF

# Load environment variables
load_dotenv()

# Router for chip preparation module
chip_preparation_router = APIRouter()

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
class ChipPreparationCreate(BaseModel):
    chip_serial_number: str
    wafer_id: str
    operator: str

class SectionUpdate(BaseModel):
    chip_serial_number: str
    section_name: str
    completed: bool

class EpoxyCureStart(BaseModel):
    chip_serial_number: str

class EpoxyCureControl(BaseModel):
    chip_serial_number: str
    action: str  # 'start', 'stop', 'cancel'

class ChipPreparationStatus(BaseModel):
    chip_serial_number: str

# Initialize database tables
def init_chip_preparation_tables():
    """Initialize chip preparation tables"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Chip preparation main table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS chip_preparation (
                    id SERIAL PRIMARY KEY,
                    chip_serial_number VARCHAR(100) UNIQUE NOT NULL,
                    wafer_id VARCHAR(100) NOT NULL,
                    operator VARCHAR(100) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_by INTEGER REFERENCES users(id)
                )
            """)
            
            # Section status table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS chip_preparation_sections (
                    id SERIAL PRIMARY KEY,
                    chip_serial_number VARCHAR(100) NOT NULL REFERENCES chip_preparation(chip_serial_number),
                    section_name VARCHAR(50) NOT NULL,
                    completed BOOLEAN DEFAULT FALSE,
                    completed_at TIMESTAMP,
                    completed_by INTEGER REFERENCES users(id),
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Epoxy cure timer table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS chip_epoxy_cure (
                    id SERIAL PRIMARY KEY,
                    chip_serial_number VARCHAR(100) NOT NULL REFERENCES chip_preparation(chip_serial_number),
                    start_time TIMESTAMP,
                    end_time TIMESTAMP,
                    duration_seconds INTEGER DEFAULT 10800,
                    status VARCHAR(20) DEFAULT 'ready',
                    remaining_seconds INTEGER DEFAULT 10800,
                    started_by INTEGER REFERENCES users(id),
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Create indexes for better performance
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_chip_preparation_chip_serial 
                ON chip_preparation(chip_serial_number)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_chip_sections_chip_serial 
                ON chip_preparation_sections(chip_serial_number)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_chip_epoxy_chip_serial 
                ON chip_epoxy_cure(chip_serial_number)
            """)
            
            conn.commit()
            print("✅ Chip preparation tables initialized")
            
    except Exception as e:
        print(f"❌ Chip preparation table initialization error: {e}")

# Initialize tables on module load
init_chip_preparation_tables()

# Helper functions
def ensure_chip_preparation_exists(chip_serial_number: str, wafer_id: str, operator: str, user_id: int):
    """Ensure chip preparation record exists"""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # Check if chip preparation exists
        cursor.execute("""
            SELECT id FROM chip_preparation WHERE chip_serial_number = %s
        """, (chip_serial_number,))
        
        if not cursor.fetchone():
            # Create chip preparation record
            cursor.execute("""
                INSERT INTO chip_preparation (chip_serial_number, wafer_id, operator, created_by)
                VALUES (%s, %s, %s, %s)
            """, (chip_serial_number, wafer_id, operator, user_id))
            
            # Initialize section statuses
            sections = [
                'chip_inspection',
                'chip_paint', 
                'mount_chip_in_housing',
                'mount_termination_chip_in_housing'
            ]
            
            for section in sections:
                cursor.execute("""
                    INSERT INTO chip_preparation_sections (chip_serial_number, section_name)
                    VALUES (%s, %s)
                """, (chip_serial_number, section))
            
            # Initialize epoxy cure record
            cursor.execute("""
                INSERT INTO chip_epoxy_cure (chip_serial_number)
                VALUES (%s)
            """, (chip_serial_number,))
            
            conn.commit()

# API Endpoints
@chip_preparation_router.get("/status")
async def chip_preparation_status(current_user: dict = Depends(get_current_user)):
    """Get chip preparation module status"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Get recent statistics
            cursor.execute("""
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as today
                FROM chip_preparation
            """)
            stats = cursor.fetchone()
            
            # Get active epoxy cures
            cursor.execute("""
                SELECT COUNT(*) FROM chip_epoxy_cure WHERE status = 'running'
            """)
            active_cures = cursor.fetchone()[0]
            
            return {
                "module": "chip_preparation",
                "status": "operational",
                "total_preparations": stats[0] if stats else 0,
                "todays_preparations": stats[1] if stats else 0,
                "active_epoxy_cures": active_cures
            }
    except Exception as e:
        return {
            "module": "chip_preparation",
            "status": "error",
            "error": str(e)
        }

@chip_preparation_router.post("/create")
async def create_chip_preparation(
    data: ChipPreparationCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create new chip preparation record"""
    if current_user['role'] == 'viewer':
        raise HTTPException(status_code=403, detail="Viewers cannot create chip preparation records")
    
    try:
        ensure_chip_preparation_exists(
            data.chip_serial_number, 
            data.wafer_id, 
            data.operator, 
            current_user['user_id']
        )
        
        log_action(
            current_user['user_id'],
            'chip_preparation_create',
            'chip_preparation',
            f"Created preparation for chip {data.chip_serial_number}"
        )
        
        return {
            "success": True,
            "message": "Chip preparation created successfully",
            "chip_serial_number": data.chip_serial_number
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create chip preparation: {str(e)}")

@chip_preparation_router.get("/get-status/{chip_serial_number}")
async def get_chip_status(
    chip_serial_number: str,
    current_user: dict = Depends(get_current_user)
):
    """Get status of a specific chip preparation"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Get chip preparation info
            cursor.execute("""
                SELECT * FROM chip_preparation WHERE chip_serial_number = %s
            """, (chip_serial_number,))
            chip_info = cursor.fetchone()
            
            if not chip_info:
                raise HTTPException(status_code=404, detail="Chip preparation not found")
            
            # Get section statuses
            cursor.execute("""
                SELECT section_name, completed, completed_at, completed_by
                FROM chip_preparation_sections 
                WHERE chip_serial_number = %s
            """, (chip_serial_number,))
            sections = cursor.fetchall()
            
            # Get epoxy cure status
            cursor.execute("""
                SELECT status, start_time, end_time, remaining_seconds, duration_seconds
                FROM chip_epoxy_cure 
                WHERE chip_serial_number = %s
            """, (chip_serial_number,))
            epoxy_cure = cursor.fetchone()
            
            section_status = {}
            for section in sections:
                section_status[section['section_name']] = {
                    'completed': section['completed'],
                    'completed_at': section['completed_at'].isoformat() if section['completed_at'] else None,
                    'completed_by': section['completed_by']
                }
            
            # Add epoxy cure to section status
            section_status['epoxy_cure'] = {
                'completed': epoxy_cure['status'] == 'completed' if epoxy_cure else False,
                'status': epoxy_cure['status'] if epoxy_cure else 'ready',
                'start_time': epoxy_cure['start_time'].isoformat() if epoxy_cure and epoxy_cure['start_time'] else None,
                'end_time': epoxy_cure['end_time'].isoformat() if epoxy_cure and epoxy_cure['end_time'] else None,
                'remaining_seconds': epoxy_cure['remaining_seconds'] if epoxy_cure else 10800,
                'duration_seconds': epoxy_cure['duration_seconds'] if epoxy_cure else 10800
            }
            
            return {
                "chip_info": dict(chip_info),
                "section_status": section_status
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get chip status: {str(e)}")

@chip_preparation_router.put("/update-section")
async def update_section_status(
    data: SectionUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update section completion status"""
    if current_user['role'] == 'viewer':
        raise HTTPException(status_code=403, detail="Viewers cannot update section status")
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check if chip preparation exists
            cursor.execute("""
                SELECT id FROM chip_preparation WHERE chip_serial_number = %s
            """, (data.chip_serial_number,))
            
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Chip preparation not found")
            
            # Update section status
            if data.completed:
                cursor.execute("""
                    UPDATE chip_preparation_sections 
                    SET completed = %s, completed_at = CURRENT_TIMESTAMP, 
                        completed_by = %s, updated_at = CURRENT_TIMESTAMP
                    WHERE chip_serial_number = %s AND section_name = %s
                """, (data.completed, current_user['user_id'], data.chip_serial_number, data.section_name))
            else:
                cursor.execute("""
                    UPDATE chip_preparation_sections 
                    SET completed = %s, completed_at = NULL, 
                        completed_by = NULL, updated_at = CURRENT_TIMESTAMP
                    WHERE chip_serial_number = %s AND section_name = %s
                """, (data.completed, data.chip_serial_number, data.section_name))
            
            conn.commit()
        
        log_action(
            current_user['user_id'],
            'section_status_update',
            'chip_preparation',
            f"Updated {data.section_name} for chip {data.chip_serial_number} to {data.completed}"
        )
        
        return {
            "success": True,
            "message": f"Section {data.section_name} updated successfully"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update section: {str(e)}")

@chip_preparation_router.post("/epoxy-cure/control")
async def control_epoxy_cure(
    data: EpoxyCureControl,
    current_user: dict = Depends(get_current_user)
):
    """Control epoxy cure timer (start, stop, cancel)"""
    if current_user['role'] == 'viewer':
        raise HTTPException(status_code=403, detail="Viewers cannot control epoxy cure")
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check if chip preparation exists
            cursor.execute("""
                SELECT id FROM chip_preparation WHERE chip_serial_number = %s
            """, (data.chip_serial_number,))
            
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Chip preparation not found")
            
            current_time = datetime.datetime.now()
            
            if data.action == 'start':
                # Start epoxy cure
                cursor.execute("""
                    UPDATE chip_epoxy_cure 
                    SET status = 'running', start_time = %s, end_time = %s,
                        remaining_seconds = duration_seconds, started_by = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE chip_serial_number = %s
                """, (
                    current_time,
                    current_time + datetime.timedelta(seconds=10800),  # 3 hours
                    current_user['user_id'],
                    data.chip_serial_number
                ))
                message = "Epoxy cure started"
                
            elif data.action == 'stop':
                # Stop/pause epoxy cure
                cursor.execute("""
                    SELECT start_time, duration_seconds FROM chip_epoxy_cure 
                    WHERE chip_serial_number = %s
                """, (data.chip_serial_number,))
                result = cursor.fetchone()
                
                if result and result[0]:
                    elapsed_seconds = int((current_time - result[0]).total_seconds())
                    remaining_seconds = max(0, result[1] - elapsed_seconds)
                    
                    cursor.execute("""
                        UPDATE chip_epoxy_cure 
                        SET status = 'paused', remaining_seconds = %s,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE chip_serial_number = %s
                    """, (remaining_seconds, data.chip_serial_number))
                    message = "Epoxy cure paused"
                else:
                    raise HTTPException(status_code=400, detail="No active epoxy cure to stop")
                
            elif data.action == 'cancel':
                # Cancel epoxy cure
                cursor.execute("""
                    UPDATE chip_epoxy_cure 
                    SET status = 'ready', start_time = NULL, end_time = NULL,
                        remaining_seconds = duration_seconds, updated_at = CURRENT_TIMESTAMP
                    WHERE chip_serial_number = %s
                """, (data.chip_serial_number,))
                message = "Epoxy cure cancelled"
                
            else:
                raise HTTPException(status_code=400, detail="Invalid action")
            
            conn.commit()
        
        log_action(
            current_user['user_id'],
            f'epoxy_cure_{data.action}',
            'chip_preparation',
            f"Epoxy cure {data.action} for chip {data.chip_serial_number}"
        )
        
        return {
            "success": True,
            "message": message,
            "action": data.action
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to control epoxy cure: {str(e)}")

@chip_preparation_router.get("/epoxy-cure/status/{chip_serial_number}")
async def get_epoxy_cure_status(
    chip_serial_number: str,
    current_user: dict = Depends(get_current_user)
):
    """Get current epoxy cure status and remaining time"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT status, start_time, end_time, remaining_seconds, duration_seconds
                FROM chip_epoxy_cure 
                WHERE chip_serial_number = %s
            """, (chip_serial_number,))
            
            result = cursor.fetchone()
            if not result:
                raise HTTPException(status_code=404, detail="Epoxy cure record not found")
            
            status, start_time, end_time, remaining_seconds, duration_seconds = result
            
            # Calculate actual remaining time if running
            if status == 'running' and start_time:
                current_time = datetime.datetime.now()
                elapsed_seconds = int((current_time - start_time).total_seconds())
                actual_remaining = max(0, duration_seconds - elapsed_seconds)
                
                # Check if cure is completed
                if actual_remaining <= 0:
                    # Auto-complete the cure
                    cursor.execute("""
                        UPDATE chip_epoxy_cure 
                        SET status = 'completed', remaining_seconds = 0,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE chip_serial_number = %s
                    """, (chip_serial_number,))
                    conn.commit()
                    
                    status = 'completed'
                    actual_remaining = 0
                else:
                    # Update remaining seconds in database
                    cursor.execute("""
                        UPDATE chip_epoxy_cure 
                        SET remaining_seconds = %s, updated_at = CURRENT_TIMESTAMP
                        WHERE chip_serial_number = %s
                    """, (actual_remaining, chip_serial_number))
                    conn.commit()
                
                remaining_seconds = actual_remaining
            
            return {
                "status": status,
                "start_time": start_time.isoformat() if start_time else None,
                "end_time": end_time.isoformat() if end_time else None,
                "remaining_seconds": remaining_seconds,
                "duration_seconds": duration_seconds,
                "is_running": status == 'running',
                "is_completed": status == 'completed'
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get epoxy cure status: {str(e)}")

@chip_preparation_router.get("/history")
async def get_preparation_history(
    limit: Optional[int] = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get chip preparation history"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            cursor.execute("""
                SELECT cp.*, 
                       COUNT(cps.id) as total_sections,
                       COUNT(CASE WHEN cps.completed = true THEN 1 END) as completed_sections,
                       cec.status as epoxy_status
                FROM chip_preparation cp
                LEFT JOIN chip_preparation_sections cps ON cp.chip_serial_number = cps.chip_serial_number
                LEFT JOIN chip_epoxy_cure cec ON cp.chip_serial_number = cec.chip_serial_number
                GROUP BY cp.id, cp.chip_serial_number, cp.wafer_id, cp.operator, cp.created_at, cp.updated_at, cec.status
                ORDER BY cp.created_at DESC
                LIMIT %s
            """, (limit,))
            
            preparations = []
            for row in cursor.fetchall():
                preparations.append({
                    "chip_serial_number": row['chip_serial_number'],
                    "wafer_id": row['wafer_id'],
                    "operator": row['operator'],
                    "created_at": row['created_at'].isoformat() if row['created_at'] else None,
                    "updated_at": row['updated_at'].isoformat() if row['updated_at'] else None,
                    "total_sections": row['total_sections'],
                    "completed_sections": row['completed_sections'],
                    "epoxy_status": row['epoxy_status']
                })
            
            return {"preparations": preparations, "count": len(preparations)}
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get preparation history: {str(e)}")

@chip_preparation_router.post("/generate-report")
async def generate_preparation_report(
    current_user: dict = Depends(get_current_user)
):
    """Generate chip preparation report PDF"""
    try:
        # Get all preparations
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            cursor.execute("""
                SELECT cp.*, 
                       COUNT(cps.id) as total_sections,
                       COUNT(CASE WHEN cps.completed = true THEN 1 END) as completed_sections,
                       cec.status as epoxy_status
                FROM chip_preparation cp
                LEFT JOIN chip_preparation_sections cps ON cp.chip_serial_number = cps.chip_serial_number
                LEFT JOIN chip_epoxy_cure cec ON cp.chip_serial_number = cec.chip_serial_number
                GROUP BY cp.id, cp.chip_serial_number, cp.wafer_id, cp.operator, cp.created_at, cec.status
                ORDER BY cp.created_at DESC
            """)
            
            preparations = cursor.fetchall()
        
        # Generate PDF
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=12)
        
        # Title
        pdf.set_font("Arial", 'B', 16)
        pdf.cell(200, 10, txt="Chip Preparation Report", ln=True, align='C')
        pdf.ln(10)
        
        # Report info
        pdf.set_font("Arial", size=10)
        pdf.cell(200, 6, txt=f"Generated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", ln=True)
        pdf.cell(200, 6, txt=f"Generated by: {current_user['username']}", ln=True)
        pdf.cell(200, 6, txt=f"Total preparations: {len(preparations)}", ln=True)
        pdf.ln(10)
        
        # Table header
        pdf.set_font("Arial", 'B', 9)
        pdf.cell(30, 8, 'Chip Serial', 1)
        pdf.cell(25, 8, 'Wafer ID', 1)
        pdf.cell(25, 8, 'Operator', 1)
        pdf.cell(25, 8, 'Progress', 1)
        pdf.cell(25, 8, 'Epoxy', 1)
        pdf.cell(30, 8, 'Date', 1)
        pdf.ln()
        
        # Table data
        pdf.set_font("Arial", size=8)
        for prep in preparations:
            pdf.cell(30, 6, str(prep['chip_serial_number'])[:12], 1)
            pdf.cell(25, 6, str(prep['wafer_id'])[:10], 1)
            pdf.cell(25, 6, str(prep['operator'])[:10], 1)
            progress = f"{prep['completed_sections']}/{prep['total_sections']}"
            pdf.cell(25, 6, progress, 1)
            pdf.cell(25, 6, str(prep['epoxy_status'])[:10], 1)
            pdf.cell(30, 6, prep['created_at'].strftime('%Y-%m-%d'), 1)
            pdf.ln()
        
        # Save PDF
        os.makedirs('reports', exist_ok=True)
        pdf_filename = f"chip_preparation_report_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
        pdf_path = os.path.join('reports', pdf_filename)
        pdf.output(pdf_path)
        
        log_action(
            current_user['user_id'],
            'report_generate',
            'chip_preparation',
            f"Generated preparation report with {len(preparations)} records"
        )
        
        return FileResponse(pdf_path, filename=pdf_filename)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {str(e)}")

# Export router
__all__ = ['chip_preparation_router']

print("✅ Chip preparation module loaded successfully")