# modules/housing_inspection_module.py - Chip Inspection Backend Module

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
from PIL import Image
import shutil
import jwt
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from dotenv import load_dotenv
from fpdf import FPDF

# Load environment variables
load_dotenv()

# Router for chip inspection module
housing_inspection_router = APIRouter()

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

async def notify_module_users(module: str, message_type: str, data: dict):
    """Simplified notification function"""
    print(f"📢 Chip Inspection Notification - {message_type}: {data}")

# Pydantic models
class InspectionCreate(BaseModel):
    operator: str
    Housing_lot_number: str
    Housing_Serial_Number: str
    notes: Optional[str] = ""
    status: str = "started"

class InspectionUpdate(BaseModel):
    inspection_id: str
    status: str

class InspectionFilter(BaseModel):
    status: Optional[str] = "all"
    operator: Optional[str] = "all"
    date_range: Optional[str] = "today"

# Initialize database tables
def init_Housing_inspection_tables():
    """Initialize chip inspection tables"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Chip inspections table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS Housing_inspections (
                    id SERIAL PRIMARY KEY,
                    inspection_id VARCHAR(255) UNIQUE NOT NULL,
                    operator VARCHAR(100) NOT NULL,
                    housing_lot_number VARCHAR(100) NOT NULL,
                    Housing_Serial_Number VARCHAR(100) NOT NULL,
                    notes TEXT,
                    status VARCHAR(50) NOT NULL DEFAULT 'started',
                    image_path TEXT,
                    image_filename VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_by INTEGER REFERENCES users(id)
                )
            """)
            
            # Create index for better performance
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_housing_inspections_status 
                ON housing_inspections(status)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_housing_inspections_created_at 
                ON housing_inspections(created_at)
            """)
            
            conn.commit()
            print("✅ Housing inspection tables initialized")
            
    except Exception as e:
        print(f"❌ Housing inspection table initialization error: {e}")

# Initialize tables on module load
init_Housing_inspection_tables()

# File handling utilities
UPLOAD_DIR = "uploads/Housing_inspections"
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

def ensure_upload_directory():
    """Ensure upload directory exists"""
    os.makedirs(UPLOAD_DIR, exist_ok=True)

def validate_image_file(file: UploadFile) -> bool:
    """Validate uploaded image file"""
    # Check file extension
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        return False
    
    # Check content type
    if not file.content_type.startswith('image/'):
        return False
    
    return True

def save_uploaded_image(file: UploadFile, inspection_id: str) -> str:
    """Save uploaded image and return file path"""
    ensure_upload_directory()
    
    # Generate unique filename
    file_ext = os.path.splitext(file.filename)[1].lower()
    filename = f"{inspection_id}_{uuid.uuid4().hex[:8]}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    
    # Save file
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Optimize image if it's too large
    try:
        with Image.open(file_path) as img:
            # Resize if image is too large
            max_size = (1920, 1080)
            if img.size[0] > max_size[0] or img.size[1] > max_size[1]:
                img.thumbnail(max_size, Image.Resampling.LANCZOS)
                img.save(file_path, optimize=True, quality=85)
    except Exception as e:
        print(f"Warning: Could not optimize image: {e}")
    
    return file_path

# API Endpoints
@housing_inspection_router.get("/status")
async def housing_inspection_status(current_user: dict = Depends(get_current_user)):
    """Get chip inspection module status"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Get recent statistics
            cursor.execute("""
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                    COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as today
                FROM housing_inspections
            """)
            stats = cursor.fetchone()
            
            return {
                "module": "housing_inspection",
                "status": "operational",
                "total_inspections": stats[0] if stats else 0,
                "completed_inspections": stats[1] if stats else 0,
                "todays_inspections": stats[2] if stats else 0
            }
    except Exception as e:
        return {
            "module": "housing_inspection",
            "status": "error",
            "error": str(e)
        }

@housing_inspection_router.post("/save")
async def save_inspection(
    operator: str = Form(...),
    Housing_lot_number: str = Form(...),
    Housing_Serial_Number: str = Form(...),
    notes: str = Form(""),
    status: str = Form("started"),
    image: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    """Save chip inspection"""
    if current_user['role'] == 'viewer':
        raise HTTPException(status_code=403, detail="Viewers cannot save inspections")
    
    try:
        inspection_id = str(uuid.uuid4())
        image_path = None
        image_filename = None
        
        # Handle image upload
        if image and image.filename:
            if not validate_image_file(image):
                raise HTTPException(status_code=400, detail="Invalid image file type")
            
            # Check file size
            contents = await image.read()
            if len(contents) > MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail="Image file too large (max 10MB)")
            
            # Reset file pointer
            await image.seek(0)
            
            image_path = save_uploaded_image(image, inspection_id)
            image_filename = image.filename
        
        # Save to database
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO housing_inspections 
                (inspection_id, operator, Housing_lot_number, Housing_Serial_Number, notes, status, 
                 image_path, image_filename, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                inspection_id, operator, Housing_lot_number, Housing_Serial_Number, notes, status,
                image_path, image_filename, current_user['user_id']
            ))
            
            conn.commit()
        
        # Log action
        log_action(
            current_user['user_id'], 
            'inspection_save', 
            'housing_inspection',
            f"Saved inspection for chip {Housing_lot_number}, wafer {Housing_Serial_Number}"
        )
        
        # Notify users
        await notify_module_users('housing_inspection', 'inspection_saved', {
            'operator': operator,
            'Housing_lot_number': Housing_lot_number,
            'Housing_Serial_Number': Housing_Serial_Number,
            'status': status
        })
        
        return {
            "success": True,
            "message": "Inspection saved successfully",
            "inspection_id": inspection_id
        }
        
    except Exception as e:
        log_action(
            current_user['user_id'], 
            'inspection_save_error', 
            'housing_inspection',
            f"Failed to save inspection: {str(e)}"
        )
        raise HTTPException(status_code=500, detail=f"Failed to save inspection: {str(e)}")

@housing_inspection_router.get("/inspections")
async def get_inspections(
    status: Optional[str] = "all",
    operator: Optional[str] = "all", 
    date_range: Optional[str] = "today",
    limit: Optional[int] = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get chip inspections with filters"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Build query with filters
            where_conditions = []
            params = []
            
            if status != "all":
                where_conditions.append("status = %s")
                params.append(status)
            
            if operator != "all":
                where_conditions.append("operator = %s")
                params.append(operator)
            
            # Date range filter
            if date_range == "today":
                where_conditions.append("created_at >= CURRENT_DATE")
            elif date_range == "week":
                where_conditions.append("created_at >= CURRENT_DATE - INTERVAL '7 days'")
            elif date_range == "month":
                where_conditions.append("created_at >= CURRENT_DATE - INTERVAL '30 days'")
            
            where_clause = ""
            if where_conditions:
                where_clause = "WHERE " + " AND ".join(where_conditions)
            
            query = f"""
                SELECT inspection_id, operator, Housing_lot_number, Housing_Serial_Number, notes, status,
                       image_path, image_filename, created_at, updated_at, id
                FROM housing_inspections
                {where_clause}
                ORDER BY created_at DESC
                LIMIT %s
            """
            
            params.append(limit)
            cursor.execute(query, params)
            rows = cursor.fetchall()
            
            inspections = []
            for row in rows:
                inspections.append({
                    "id": row['id'],
                    "inspection_id": row['inspection_id'],
                    "operator": row['operator'],
                    "Housing_lot_number": row['Housing_lot_number'],
                    "Housing_Serial_Number": row['Housing_Serial_Number'],
                    "notes": row['notes'],
                    "status": row['status'],
                    "image_path": row['image_path'],
                    "image_filename": row['image_filename'],
                    "created_at": row['created_at'].isoformat() if row['created_at'] else None,
                    "updated_at": row['updated_at'].isoformat() if row['updated_at'] else None
                })
            
            return {"inspections": inspections, "count": len(inspections)}
            
    except Exception as e:
        print(f"❌ Error getting inspections: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve inspections")

@housing_inspection_router.put("/update-status")
async def update_inspection_status(
    update_data: InspectionUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update inspection status"""
    if current_user['role'] == 'viewer':
        raise HTTPException(status_code=403, detail="Viewers cannot update inspection status")
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE housing_inspections 
                SET status = %s, updated_at = CURRENT_TIMESTAMP
                WHERE inspection_id = %s
            """, (update_data.status, update_data.inspection_id))
            
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Inspection not found")
            
            conn.commit()
        
        log_action(
            current_user['user_id'],
            'inspection_status_update',
            'housing_inspection',
            f"Updated inspection {update_data.inspection_id} status to {update_data.status}"
        )
        
        await notify_module_users('housing_inspection', 'status_updated', {
            'inspection_id': update_data.inspection_id,
            'status': update_data.status,
            'updated_by': current_user['username']
        })
        
        return {"success": True, "message": "Status updated successfully"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update status: {str(e)}")

@housing_inspection_router.get("/image/{inspection_id}")
async def get_inspection_image(
    inspection_id: int,
    current_user: dict = Depends(get_current_user)
):
    """Get inspection image"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT image_path, image_filename FROM housing_inspections WHERE id = %s",
                (inspection_id,)
            )
            result = cursor.fetchone()
            
            if not result or not result[0]:
                raise HTTPException(status_code=404, detail="Image not found")
            
            image_path, image_filename = result
            
            if not os.path.exists(image_path):
                raise HTTPException(status_code=404, detail="Image file not found")
            
            return FileResponse(
                image_path,
                filename=image_filename,
                media_type="image/*"
            )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve image: {str(e)}")

@housing_inspection_router.post("/generate-report")
async def generate_inspection_report(
    filter_data: InspectionFilter,
    current_user: dict = Depends(get_current_user)
):
    """Generate inspection report PDF"""
    try:
        # Get filtered inspections
        with get_db_connection() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Build query with filters (same as get_inspections)
            where_conditions = []
            params = []
            
            if filter_data.status != "all":
                where_conditions.append("status = %s")
                params.append(filter_data.status)
            
            if filter_data.operator != "all":
                where_conditions.append("operator = %s")
                params.append(filter_data.operator)
            
            if filter_data.date_range == "today":
                where_conditions.append("created_at >= CURRENT_DATE")
            elif filter_data.date_range == "week":
                where_conditions.append("created_at >= CURRENT_DATE - INTERVAL '7 days'")
            elif filter_data.date_range == "month":
                where_conditions.append("created_at >= CURRENT_DATE - INTERVAL '30 days'")
            
            where_clause = ""
            if where_conditions:
                where_clause = "WHERE " + " AND ".join(where_conditions)
            
            query = f"""
                SELECT operator, Housing_lot_number, Housing_Serial_Number, notes, status, created_at
                FROM housing_inspections
                {where_clause}
                ORDER BY created_at DESC
            """
            
            cursor.execute(query, params)
            inspections = cursor.fetchall()
        
        # Generate PDF
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Arial", size=12)
        
        # Title
        pdf.set_font("Arial", 'B', 16)
        pdf.cell(200, 10, txt="Chip Inspection Report", ln=True, align='C')
        pdf.ln(10)
        
        # Report info
        pdf.set_font("Arial", size=10)
        pdf.cell(200, 6, txt=f"Generated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", ln=True)
        pdf.cell(200, 6, txt=f"Generated by: {current_user['username']}", ln=True)
        pdf.cell(200, 6, txt=f"Total inspections: {len(inspections)}", ln=True)
        pdf.ln(10)
        
        # Table header
        pdf.set_font("Arial", 'B', 9)
        pdf.cell(25, 8, 'Chip #', 1)
        pdf.cell(25, 8, 'Wafer ID', 1)
        pdf.cell(25, 8, 'Operator', 1)
        pdf.cell(20, 8, 'Status', 1)
        pdf.cell(30, 8, 'Date', 1)
        pdf.cell(75, 8, 'Notes', 1)
        pdf.ln()
        
        # Table data
        pdf.set_font("Arial", size=8)
        for inspection in inspections:
            pdf.cell(25, 6, str(inspection['Housing_lot_number'])[:10], 1)
            pdf.cell(25, 6, str(inspection['Housing_Serial_Number'])[:10], 1)
            pdf.cell(25, 6, str(inspection['operator'])[:10], 1)
            pdf.cell(20, 6, str(inspection['status'])[:8], 1)
            pdf.cell(30, 6, inspection['created_at'].strftime('%Y-%m-%d'), 1)
            notes = str(inspection['notes'])[:30] + "..." if len(str(inspection['notes'])) > 30 else str(inspection['notes'])
            pdf.cell(75, 6, notes, 1)
            pdf.ln()
        
        # Save PDF
        os.makedirs('reports', exist_ok=True)
        pdf_filename = f"housing_inspection_report_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
        pdf_path = os.path.join('reports', pdf_filename)
        pdf.output(pdf_path)
        
        log_action(
            current_user['user_id'],
            'report_generate',
            'housing_inspection',
            f"Generated inspection report with {len(inspections)} records"
        )
        
        return FileResponse(pdf_path, filename=pdf_filename)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {str(e)}")

@housing_inspection_router.get("/statistics")
async def get_inspection_statistics(current_user: dict = Depends(get_current_user)):
    """Get inspection statistics"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Total inspections
            cursor.execute("SELECT COUNT(*) FROM housing_inspections")
            total_inspections = cursor.fetchone()[0] or 0
            
            # Status breakdown
            cursor.execute("""
                SELECT status, COUNT(*) 
                FROM housing_inspections 
                GROUP BY status
            """)
            status_counts = dict(cursor.fetchall())
            
            # Today's inspections
            cursor.execute("""
                SELECT COUNT(*) 
                FROM housing_inspections 
                WHERE created_at >= CURRENT_DATE
            """)
            todays_inspections = cursor.fetchone()[0] or 0
            
            # Top operators
            cursor.execute("""
                SELECT operator, COUNT(*) as count
                FROM housing_inspections 
                GROUP BY operator 
                ORDER BY count DESC 
                LIMIT 5
            """)
            top_operators = [{"operator": row[0], "count": row[1]} for row in cursor.fetchall()]
            
            return {
                "total_inspections": total_inspections,
                "status_breakdown": status_counts,
                "todays_inspections": todays_inspections,
                "top_operators": top_operators
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get statistics: {str(e)}")

# Export router
__all__ = ['housing_inspection_router']

print("✅ Chip inspection module loaded successfully")