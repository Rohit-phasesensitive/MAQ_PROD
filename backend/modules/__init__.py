# modules/__init__.py

__version__ = "1.0.0"
__author__ = "MAQ Lab Team"

# List of available modules
AVAILABLE_MODULES = [
    "s11_module",
    "chip_inspection_module", 
    "optical_module",
    "housing_inspection_module",
    "power_module"
]


def get_available_modules():
    """Get list of available test station modules"""
    return AVAILABLE_MODULES

def get_module_description(module_name):
    """Get description for a specific module"""
    return MODULE_DESCRIPTIONS.get(module_name, "No description available")

print("📦 Test station modules package initialized")