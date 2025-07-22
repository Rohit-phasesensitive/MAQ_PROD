import React, { useState, useEffect } from 'react';
import './testing_workflow.css'
import { 
  Package, FileText, Play, CheckCircle, Clock, Plus, RefreshCw,
  AlertCircle, ArrowLeft
} from 'lucide-react';

const SimplifiedTestingWorkflow = () => {
  const [mode, setMode] = useState('mo-list');
  const [selectedMO, setSelectedMO] = useState(null);
  const [selectedDeviceType, setSelectedDeviceType] = useState(null);
  const [newSerialNumber, setNewSerialNumber] = useState('');
  
  const [manufacturingOrders, setManufacturingOrders] = useState([]);
  const [testSequence, setTestSequence] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const API_PREFIX = '/api/manufacturing';
  
  const getAuthToken = () => localStorage.getItem('authToken') || '';
  const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getAuthToken()}`
  });

  const apiCall = async (endpoint, options = {}) => {
    try {
      const url = `${API_BASE_URL}${API_PREFIX}${endpoint}`;
      const response = await fetch(url, {
        headers: getHeaders(),
        ...options
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`API call failed for ${endpoint}:`, error);
      throw error;
    }
  };

  // Load Manufacturing Orders
  const loadManufacturingOrders = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiCall('/manufacturing-orders');
      setManufacturingOrders(data.manufacturing_orders || []);
    } catch (error) {
      setError(`Failed to load manufacturing orders: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Load devices and test sequence for selected device type
  const loadDeviceTypeData = async (deviceType) => {
    try {
      setLoading(true);
      setError(null);
      
      // Get test sequence with work instructions
      const sequenceData = await apiCall(`/device-types/${deviceType}/test-sequence-with-instructions`);
      setTestSequence(sequenceData.test_sequence || []);
      
      // Get devices for this type
      const devicesData = await apiCall(`/devices/by-type/${deviceType}`);
      setDevices(devicesData.devices || []);
      
    } catch (error) {
      setError(`Failed to load device type data: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Create new device
  const createDevice = async () => {
    if (!newSerialNumber.trim()) {
      alert('Please enter a serial number');
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      
      await apiCall(`/devices/create?serial_number=${encodeURIComponent(newSerialNumber)}&device_type=${encodeURIComponent(selectedDeviceType)}`, {
        method: 'POST'
      });
      
      setNewSerialNumber('');
      await loadDeviceTypeData(selectedDeviceType); // Refresh devices list
      
    } catch (error) {
      setError(`Failed to create device: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Continue to test
  const continueToTest = (device) => {
    if (!device.current_stage || device.current_stage === 'completed') {
      alert('No active test for this device');
      return;
    }
    
    // Store context for return navigation with full state
    const testContext = {
      deviceSerialNumber: device.serial_number,
      testId: device.current_stage,
      returnTo: 'testing-workflow',
      returnMode: 'device-type-view',
      selectedMO: selectedMO,
      selectedDeviceType: selectedDeviceType,
      manufacturingOrderNumber: selectedMO?.manufacturing_order_number,
      productName: selectedMO?.product_name
    };
    
    localStorage.setItem('testContext', JSON.stringify(testContext));
    
    // Navigate to test module
    const moduleMap = {
      'LNCHP': 'chip-inspection',
      'LNCHB': 'housing-prep',
      'LNWB-01': 'wirebond',
      'LNWB-02': 'wirebond',
      'LNIT-01': 's11-testing',
      'LNIT-02': 'dcpi-testing',
      'LNIT-03': 's21-testing',
      'LNIT-04': 'twotone-testing',
      'LNIT-05': 'rfvpi-testing',
      'LNPTA': 'fiber-attach',
      'LNPD': 'pd-attach'
    };
    
    const module = moduleMap[device.current_stage];
    if (module) {
      window.location.href = `/?navigateTo=${module}`;
    } else {
      alert(`Test module for ${device.current_stage} not available yet`);
    }
  };

  // Open PDF work instruction
  const openWorkInstruction = (pdfFile) => {
  if (pdfFile) {
    // Force a full page navigation, bypassing React Router completely
    const url = `/procedures/${pdfFile}`;
    Object.assign(document.createElement('a'), {
      target: '_blank',
      rel: 'noopener noreferrer',
      href: url,
    }).click();
  } else {
    alert('Work instruction PDF not available');
  }
};

  // Get status color
  const getStatusColor = (status) => {
    switch(status) {
      case 'completed': return 'text-green-600 bg-green-100';
      case 'in_progress': return 'text-blue-600 bg-blue-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  useEffect(() => {
    if (mode === 'mo-list') {
      loadManufacturingOrders();
    }
  }, [mode]);

  useEffect(() => {
    if (selectedDeviceType) {
      loadDeviceTypeData(selectedDeviceType);
    }
  }, [selectedDeviceType]);

  // Check for return navigation from test modules
  useEffect(() => {
    const checkReturnContext = () => {
      const testContext = localStorage.getItem('testContext');
      if (testContext) {
        try {
          const context = JSON.parse(testContext);
          if (context.returnTo === 'testing-workflow' && context.returnMode === 'device-type-view') {
            // Restore the previous state
            if (context.selectedMO && context.selectedDeviceType) {
              setSelectedMO(context.selectedMO);
              setSelectedDeviceType(context.selectedDeviceType);
              setMode('device-type-view');
              // Clear the context after using it
              localStorage.removeItem('testContext');
            }
          }
        } catch (error) {
          console.error('Error parsing test context:', error);
          localStorage.removeItem('testContext');
        }
      }
    };

    // Check on component mount
    checkReturnContext();
  }, []);

  // Manufacturing Orders List
  if (mode === 'mo-list') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-800 mb-8">Manufacturing Orders</h1>
          
          {loading && <div className="text-center py-4">Loading...</div>}
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {manufacturingOrders.map((mo) => (
              <div key={mo.manufacturing_order_number} className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-semibold">{mo.manufacturing_order_number}</h3>
                    <p className="text-gray-600">{mo.product_name}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    mo.priority === 'High' ? 'bg-red-100 text-red-700' :
                    mo.priority === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-green-100 text-green-700'
                  }`}>
                    {mo.priority}
                  </span>
                </div>
                
                {/* Fixed device types section with flexbox instead of grid */}
                <div className="flex flex-wrap gap-2">
                  {Object.entries(mo.device_types || {}).map(([type, data]) => (
                    <button
                      key={type}
                      onClick={() => {
                        setSelectedMO(mo);
                        setSelectedDeviceType(type);
                        setMode('device-type-view');
                      }}
                      className="bg-gray-50 rounded px-3 py-2 text-left hover:bg-blue-50 transition-colors border border-gray-200 hover:border-blue-300 min-w-[120px] flex-shrink-0"
                    >
                      <div className="font-medium text-sm">{type}</div>
                      <div className="text-xs text-gray-600">
                        {data.completed || 0}/{data.required || 0}
                      </div>
                    </button>
                  ))}
                </div>
                
                <div className="mt-4 text-sm text-gray-500">
                  Due: {mo.due_date}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Device Type View (Combined test sequence and devices)
  if (mode === 'device-type-view') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  setMode('mo-list');
                  setSelectedDeviceType(null);
                  setTestSequence([]);
                  setDevices([]);
                }}
                className="p-2 hover:bg-gray-200 rounded"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">
                  {selectedMO?.manufacturing_order_number} - {selectedDeviceType}
                </h1>
                <p className="text-gray-600">{selectedMO?.product_name}</p>
              </div>
            </div>
            <button
              onClick={() => loadDeviceTypeData(selectedDeviceType)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Test Sequence Panel */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">Required Test Sequence</h2>
              <div className="space-y-3">
                {testSequence.filter(test => test.is_required).map((test, index) => (
                  <div key={test.test_id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-medium text-gray-700">{index + 1}</span>
                      <div>
                        <div className="font-medium">{test.test_name}</div>
                        <div className="text-sm text-gray-600">
                          {test.test_id} • {test.estimated_duration_minutes} min
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => openWorkInstruction(test.work_instruction_pdf)}
                      className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                    >
                      <FileText className="h-4 w-4" />
                      PDF
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Devices Panel */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Devices ({devices.length})</h2>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newSerialNumber}
                    onChange={(e) => setNewSerialNumber(e.target.value)}
                    placeholder="Serial number"
                    className="px-3 py-1 border rounded"
                    onKeyPress={(e) => e.key === 'Enter' && createDevice()}
                  />
                  <button
                    onClick={createDevice}
                    disabled={loading || !newSerialNumber.trim()}
                    className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Create
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {devices.map((device) => (
                  <div key={device.serial_number} className="flex items-center justify-between p-3 border rounded hover:bg-gray-50">
                    <div>
                      <div className="font-medium">{device.serial_number}</div>
                      <div className="text-sm text-gray-600">
                        {device.current_stage === 'completed' ? 'All tests completed' :
                         device.current_stage === 'not_started' ? 'Ready to start' :
                         `Current: ${device.current_test_name || device.current_stage}`}
                      </div>
                      <div className="text-xs text-gray-500">
                        Created: {new Date(device.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(device.status)}`}>
                        {device.status === 'completed' ? <CheckCircle className="h-4 w-4 inline" /> :
                         device.status === 'in_progress' ? <Clock className="h-4 w-4 inline" /> : null}
                        {' '}{device.status.replace('_', ' ')}
                      </span>
                      {device.status !== 'completed' && device.current_stage !== 'not_started' && (
                        <button
                          onClick={() => continueToTest(device)}
                          className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                        >
                          <Play className="h-4 w-4" />
                          Continue
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                
                {devices.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    No devices created yet. Enter a serial number above to create one.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default SimplifiedTestingWorkflow;