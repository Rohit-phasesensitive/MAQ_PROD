from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import datetime

# Request Models
class DeviceRegistration(BaseModel):
    manufacturing_order_number: str
    device_type: str
    serial_number: str
    test_sequence: List[str]

class TestResult(BaseModel):
    status: str  # 'completed', 'failed'
    result: Optional[str] = None  # 'pass', 'fail'
    end_time: Optional[str] = None
    error_message: Optional[str] = None
    test_data: Optional[Dict[str, Any]] = None

# Response Models
class TestSequenceItem(BaseModel):
    test_id: str
    sequence_order: int
    is_required: bool
    test_number: Optional[str] = None

class TestSequenceResponse(BaseModel):
    test_sequences: List[TestSequenceItem]

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

class DeviceListResponse(BaseModel):
    devices: List[DeviceInfo]

class DeviceTypeCount(BaseModel):
    required: int = 0
    completed: int = 0
    in_progress: int = 0

class ManufacturingOrder(BaseModel):
    manufacturing_order_number: str
    product_name: Optional[str] = None
    priority: Optional[str] = "medium"
    due_date: Optional[str] = None
    operator: Optional[str] = None
    device_types: Dict[str, DeviceTypeCount] = {}

class ManufacturingOrderResponse(BaseModel):
    manufacturing_orders: List[ManufacturingOrder]

class TestDefinition(BaseModel):
    test_name: str
    description: Optional[str] = None
    estimated_duration_minutes: Optional[int] = None

class TestDefinitionsResponse(BaseModel):
    test_definitions: Dict[str, TestDefinition]

class TestStatusResponse(BaseModel):
    test_id: str
    status: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    result: Optional[str] = None
    error_message: Optional[str] = None

class ApiResponse(BaseModel):
    message: str
    data: Optional[Dict[str, Any]] = None