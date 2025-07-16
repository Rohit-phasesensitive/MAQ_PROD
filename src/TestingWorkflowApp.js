import React, { useState, useEffect } from 'react';
import { Search, Plus, Play, CheckCircle, Circle, AlertCircle, ArrowLeft, Save, RotateCcw, Database, FileText, Settings, Package, Clock, Users, PlusCircle } from 'lucide-react';
import './testing_workflow.css';

const TestingWorkflowApp = () => {
  const [mode, setMode] = useState('mo-list');
  const [selectedMO, setSelectedMO] = useState(null);
  const [selectedDeviceType, setSelectedDeviceType] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [currentTest, setCurrentTest] = useState(null);
  const [testInProgress, setTestInProgress] = useState(false);
  
  // API State
  const [manufacturingOrders, setManufacturingOrders] = useState([]);
  const [devicesByType, setDevicesByType] = useState({});
  const [testDefinitions, setTestDefinitions] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // API Configuration
  const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const API_PREFIX = '/api/manufacturing';

  // Get auth token from localStorage or context
  const getAuthToken = () => {
    return localStorage.getItem('authToken') || '';
  };

  // API Headers
  const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getAuthToken()}`
  });

  // API Helper Functions
  const apiCall = async (endpoint, options = {}) => {
    try {
      const response = await fetch(`${API_BASE_URL}${API_PREFIX}${endpoint}`, {
        headers: getHeaders(),
        ...options
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
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
      console.error('Error loading MOs:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load MO Details with Devices
  const loadMODetails = async (manufacturingOrderNumber) => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiCall(`/manufacturing-orders/${manufacturingOrderNumber}`);
      setSelectedMO(data.manufacturing_order);
      setDevicesByType(data.devices_by_type || {});
    } catch (error) {
      setError(`Failed to load MO details: ${error.message}`);
      console.error('Error loading MO details:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load Test Definitions
  const loadTestDefinitions = async () => {
    try {
      const data = await apiCall('/test-definitions');
      setTestDefinitions(data.test_definitions || {});
    } catch (error) {
      console.error('Error loading test definitions:', error);
    }
  };

  // Register New Device
  const registerDevice = async (manufacturingOrderNumber, deviceType, serialNumber) => {
    try {
      setLoading(true);
      setError(null);
      
      await apiCall('/devices/register', {
        method: 'POST',
        body: JSON.stringify({
          manufacturing_order_number: manufacturingOrderNumber,
          device_type: deviceType,
          serial_number: serialNumber
        })
      });

      // Reload MO details to get updated device list
      await loadMODetails(manufacturingOrderNumber);
      alert(`Device ${serialNumber} registered successfully!`);
      
    } catch (error) {
      setError(`Failed to register device: ${error.message}`);
      console.error('Error registering device:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load Device Details
  const loadDeviceDetails = async (serialNumber) => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiCall(`/devices/${serialNumber}`);
      setSelectedDevice(data.device);
      return data;
    } catch (error) {
      setError(`Failed to load device details: ${error.message}`);
      console.error('Error loading device details:', error);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Start Test
  const startTest = async (serialNumber, testId) => {
    try {
      setTestInProgress(true);
      setCurrentTest(testId);
      setError(null);

      await apiCall(`/devices/${serialNumber}/start-test`, {
        method: 'POST',
        body: JSON.stringify({
          device_serial: serialNumber,
          test_id: testId,
          operator: localStorage.getItem('username') || 'Unknown'
        })
      });

      // Simulate test execution time
      setTimeout(async () => {
        try {
          // Complete test with mock result
          await apiCall(`/devices/${serialNumber}/complete-test/${testId}`, {
            method: 'POST',
            body: JSON.stringify({
              status: Math.random() > 0.1 ? 'passed' : 'failed',
              notes: `Test ${testId} completed successfully`,
              measurements: {
                timestamp: new Date().toISOString(),
                result: 'within_spec'
              }
            })
          });

          // Reload device details
          await loadDeviceDetails(serialNumber);
          
        } catch (error) {
          setError(`Failed to complete test: ${error.message}`);
        } finally {
          setTestInProgress(false);
          setCurrentTest(null);
        }
      }, 3000);

    } catch (error) {
      setError(`Failed to start test: ${error.message}`);
      setTestInProgress(false);
      setCurrentTest(null);
    }
  };

  // Load initial data
  useEffect(() => {
    loadManufacturingOrders();
    loadTestDefinitions();
  }, []);

  // Handle MO selection
  const selectMO = async (mo) => {
    await loadMODetails(mo.manufacturing_order_number);
    setMode('device-types');
  };

  // Handle device type selection
  const selectDeviceType = (deviceType) => {
    setSelectedDeviceType(deviceType);
    setMode('devices');
  };

  // Handle device selection
  const selectDevice = async (device) => {
    const deviceDetails = await loadDeviceDetails(device.serial_number);
    if (deviceDetails) {
      setMode('testing');
    }
  };

  // Handle new device registration
  const startNewDevice = () => {
    setMode('register');
  };

  // Get devices for selected type
  const getDevicesForType = () => {
    if (!selectedDeviceType || !devicesByType[selectedDeviceType]) {
      return [];
    }
    return devicesByType[selectedDeviceType];
  };

  // Get next test for device
  const getNextTest = () => {
    if (!selectedDevice || !testDefinitions) return null;
    
    if (selectedDevice.current_step === 'completed') {
      return null;
    }
    
    if (selectedDevice.current_step === 'not-started') {
      return testDefinitions['chip'] || Object.values(testDefinitions)[0];
    }
    
    const testSequence = Object.keys(testDefinitions);
    const currentIndex = testSequence.indexOf(selectedDevice.current_step);
    
    if (currentIndex >= 0 && currentIndex + 1 < testSequence.length) {
      const nextTestId = testSequence[currentIndex + 1];
      return testDefinitions[nextTestId];
    }
    
    return testDefinitions[selectedDevice.current_step];
  };

  // Execute test
  const executeTest = (testId) => {
    if (selectedDevice) {
      startTest(selectedDevice.serial_number, testId);
    }
  };

  // Calculate totals for MO
  const getMOTotals = (mo) => {
    const totalRequired = Object.values(mo.device_types || {}).reduce((sum, type) => sum + (type.required || 0), 0);
    const totalCompleted = Object.values(mo.device_types || {}).reduce((sum, type) => sum + (type.completed || 0), 0);
    const totalInProgress = Object.values(mo.device_types || {}).reduce((sum, type) => sum + (type.in_progress || 0), 0);
    return { totalRequired, totalCompleted, totalInProgress };
  };

  // Back navigation
  const goBack = () => {
    if (mode === 'testing' || mode === 'register') {
      setMode('devices');
      setSelectedDevice(null);
    } else if (mode === 'devices') {
      setMode('device-types');
      setSelectedDeviceType(null);
    } else if (mode === 'device-types') {
      setMode('mo-list');
      setSelectedMO(null);
      setDevicesByType({});
    }
  };

  // Error display component
  const ErrorAlert = () => {
    if (!error) return null;
    
    return (
      <div className="alert alert-error" style={{marginBottom: '20px'}}>
        <AlertCircle size={20} />
        <span>{error}</span>
        <button 
          onClick={() => setError(null)}
          style={{marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer'}}
        >
          ×
        </button>
      </div>
    );
  };

  // Loading component
  const LoadingSpinner = () => {
    if (!loading) return null;
    
    return (
      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px'}}>
        <RotateCcw size={24} className="spin" />
        <span style={{marginLeft: '10px'}}>Loading...</span>
      </div>
    );
  };

  // Manufacturing Orders List View
  if (mode === 'mo-list') {
    return (
      <div className="container">
        <div className="max-width">
          <div className="title">
            <h1 className="title-text">Production Workflow</h1>
            
          </div>

          <ErrorAlert />
          <LoadingSpinner />

          <div className="grid grid-cols-2">
            {manufacturingOrders.map((mo) => {
              const totals = getMOTotals(mo);
              
              return (
                <div
                  key={mo.manufacturing_order_number}
                  className={`mo-card priority-${(mo.priority || 'medium').toLowerCase()}`}
                  onClick={() => selectMO(mo)}
                >
                  <div className="flex-between">
                    <div className="flex-center">
                      <Package size={24} className="text-primary" />
                      <div>
                        <h3 className="mo-title">{mo.manufacturing_order_number}</h3>
                        <p className="mo-subtitle">{mo.product_name}</p>
                      </div>
                    </div>
                    <div className={`priority-badge priority-${(mo.priority || 'medium').toLowerCase()}`}>
                      {mo.priority || 'Medium'}
                    </div>
                  </div>

                  <div className="device-types-grid">
                    {Object.entries(mo.device_types || {}).map(([type, data]) => (
                      <div key={type} className="device-type-summary">
                        <div className="device-type-name">{type}</div>
                        <div className="device-type-count">{(data.completed || 0) + (data.in_progress || 0)}/{data.required || 0}</div>
                      </div>
                    ))}
                  </div>

                  <div className="progress-section">
                    <div className="flex-between">
                      <span className="progress-label">Overall Progress</span>
                      <span className="progress-count">
                        {totals.totalCompleted + totals.totalInProgress}/{totals.totalRequired}
                      </span>
                    </div>
                    <div className="progress-bar">
                      <div 
                        className="progress-fill"
                        style={{
                          width: `${totals.totalRequired > 0 ? ((totals.totalCompleted + totals.totalInProgress) / totals.totalRequired) * 100 : 0}%`
                        }}
                      />
                    </div>
                  </div>

                  <div className="mo-footer">
                    <div className="flex-center">
                      <Clock size={16} />
                      <span>Due: {mo.due_date}</span>
                    </div>
                    <div className="flex-center">
                      <Users size={16} />
                      <span>{mo.operator}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {manufacturingOrders.length === 0 && !loading && (
            <div style={{textAlign: 'center', padding: '40px', color: '#64748b'}}>
              <Package size={48} style={{margin: '0 auto 16px', display: 'block'}} />
              <h3>No Manufacturing Orders Found</h3>
              <p>Manufacturing orders are managed externally.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Device Types View
  if (mode === 'device-types') {
    return (
      <div className="container">
        <div className="max-width">
          <div className="header">
            <div className="header-left">
              <button className="btn btn-secondary" onClick={goBack}>
                <ArrowLeft size={20} />
                Back to MOs
              </button>
              <div>
                <h1 className="header-title">{selectedMO?.manufacturing_order_number}</h1>
                <p className="header-subtitle">{selectedMO?.product_name}</p>
              </div>
            </div>
          </div>

          <ErrorAlert />
          <LoadingSpinner />

          <div className="card">
            <h2 className="section-title">Device Types</h2>
            
            <div className="grid grid-cols-3">
              {/* Show ALL device types from requirements, regardless of whether devices are started */}
              {Object.entries(selectedMO?.device_types || {}).map(([deviceType, data]) => {
                const hasStartedDevices = devicesByType[deviceType]?.length > 0;
                const totalStarted = (data.completed || 0) + (data.in_progress || 0);
                const isNotStarted = totalStarted === 0;
                
                return (
                  <div
                    key={deviceType}
                    className={`device-type-card ${isNotStarted ? 'not-started' : ''}`}
                    onClick={() => {
                      if (hasStartedDevices) {
                        selectDeviceType(deviceType);
                      } else {
                        // If no devices started, go directly to registration
                        setSelectedDeviceType(deviceType);
                        setMode('register');
                      }
                    }}
                  >
                    <div className="flex-between">
                      <h3 className="device-type-title">{deviceType}</h3>
                      <div className={`status-badge ${isNotStarted ? 'status-not-started' : 'status-in-progress'}`}>
                        {isNotStarted ? 'Not Started' : 'Active'}
                      </div>
                    </div>

                    <div className="progress-section">
                      <div className="flex-between">
                        <span className="progress-label">Progress</span>
                        <span className="progress-count">
                          {totalStarted}/{data.required || 0}
                        </span>
                      </div>
                      <div className="progress-bar">
                        <div 
                          className="progress-fill"
                          style={{
                            width: `${data.required > 0 ? (totalStarted / data.required) * 100 : 0}%`
                          }}
                        />
                      </div>
                    </div>

                    <div className="status-grid">
                      <div className="status-item status-completed">
                        <div className="status-count">{data.completed || 0}</div>
                        <div className="status-label">Completed</div>
                      </div>
                      <div className="status-item status-in-progress">
                        <div className="status-count">{data.in_progress || 0}</div>
                        <div className="status-label">In Progress</div>
                      </div>
                      <div className="status-item status-not-started">
                        <div className="status-count">{(data.required || 0) - totalStarted}</div>
                        <div className="status-label">Not Started</div>
                      </div>
                    </div>

                    {data.description && (
                      <div className="device-description">
                        <small>{data.description}</small>
                      </div>
                    )}

                    <div className="device-actions">
                      <span className="action-hint">
                        {isNotStarted ? 'Click to start production' : `Click to view ${devicesByType[deviceType]?.length || 0} devices`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {Object.keys(selectedMO?.device_types || {}).length === 0 && !loading && (
              <div style={{textAlign: 'center', padding: '40px', color: '#64748b'}}>
                <Package size={48} style={{margin: '0 auto 16px', display: 'block'}} />
                <h3>No Device Types Defined</h3>
                <p>No device types found in manufacturing_order_devices table for this MO.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Devices List View
  if (mode === 'devices') {
    const devices = getDevicesForType();
    
    return (
      <div className="container">
        <div className="max-width">
          <div className="header">
            <div className="header-left">
              <button className="btn btn-secondary" onClick={goBack}>
                <ArrowLeft size={20} />
                Back to Types
              </button>
              <div>
                <h1 className="header-title">{selectedMO?.manufacturing_order_number} - {selectedDeviceType}</h1>
                <p className="header-subtitle">Devices with started production</p>
              </div>
            </div>
          </div>

          <ErrorAlert />
          <LoadingSpinner />

          <div className="card">
            <div className="grid grid-cols-3">
              {devices.map((device) => (
                <div
                  key={device.serial_number}
                  className="device-card"
                  onClick={() => selectDevice(device)}
                >
                  <div className="flex-between">
                    <h3 className="device-title">{device.serial_number}</h3>
                    <div className={`status-badge ${device.status === 'Completed' ? 'status-completed' : 'status-in-progress'}`}>
                      {device.status}
                    </div>
                  </div>

                  <div className="progress-section">
                    <div className="flex-between">
                      <span className="progress-label">
                        {device.current_step === 'completed' ? 'All Tests Complete' :
                         `Current Step: ${device.current_step}`}
                      </span>
                      <span className="progress-count">
                        {(device.completed_steps || []).length}/{device.total_steps || 0}
                      </span>
                    </div>
                    <div className="progress-bar">
                      <div 
                        className="progress-fill"
                        style={{
                          width: `${device.total_steps > 0 ? ((device.completed_steps || []).length / device.total_steps) * 100 : 0}%`
                        }}
                      />
                    </div>
                  </div>

                  <div className="device-actions">
                    <button
                      className={`btn ${device.current_step === 'completed' ? 'btn-secondary' : 'btn-primary'} btn-full`}
                      disabled={loading}
                    >
                      {device.current_step === 'completed' ? 'View Results' : 'Continue'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {devices.length === 0 && !loading && (
              <div style={{textAlign: 'center', padding: '40px', color: '#64748b'}}>
                <Circle size={48} style={{margin: '0 auto 16px', display: 'block'}} />
                <h3>No Devices Started</h3>
                <p>No devices have been started for {selectedDeviceType} yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Registration View
  if (mode === 'register') {
    const [newSerialNumber, setNewSerialNumber] = useState('');
    const [selectedRegDeviceType, setSelectedRegDeviceType] = useState('');

    const handleRegisterDevice = async () => {
      if (!newSerialNumber.trim() || !selectedRegDeviceType) {
        alert('Please enter serial number and select device type');
        return;
      }

      await registerDevice(selectedMO.manufacturing_order_number, selectedRegDeviceType, newSerialNumber);
      setNewSerialNumber('');
      setSelectedRegDeviceType('');
      setMode('device-types');
    };

    return (
      <div className="container">
        <div className="max-width">
          <div className="header">
            <div className="header-left">
              <button className="btn btn-secondary" onClick={goBack}>
                <ArrowLeft size={20} />
                Back
              </button>
              <div>
                <h1 className="header-title">Register New Device</h1>
                <p className="header-subtitle">
                  {selectedMO?.manufacturing_order_number} - Select device type to start production
                </p>
              </div>
            </div>
          </div>

          <ErrorAlert />

          <div className="card">
            <h2 className="section-title">Device Registration</h2>
            
            <div style={{marginBottom: '24px'}}>
              <label style={{display: 'block', marginBottom: '8px', fontWeight: '500'}}>
                Serial Number
              </label>
              <input
                type="text"
                value={newSerialNumber}
                onChange={(e) => setNewSerialNumber(e.target.value)}
                placeholder="Enter device serial number"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  fontSize: '1rem'
                }}
              />
            </div>

            <h3 style={{marginBottom: '16px'}}>Available Device Types</h3>
            
            <div className="grid grid-cols-3">
              {Object.entries(selectedMO?.device_types || {}).map(([deviceType, data]) => {
                const remaining = (data.required || 0) - ((data.completed || 0) + (data.in_progress || 0));
                
                return (
                  <div
                    key={deviceType}
                    className={`device-type-card ${remaining <= 0 ? 'disabled' : ''} ${selectedRegDeviceType === deviceType ? 'selected' : ''}`}
                    onClick={() => {
                      if (remaining > 0) {
                        setSelectedRegDeviceType(deviceType);
                      }
                    }}
                    style={{
                      cursor: remaining > 0 ? 'pointer' : 'not-allowed',
                      border: selectedRegDeviceType === deviceType ? '2px solid #3b82f6' : undefined
                    }}
                  >
                    <div className="flex-between">
                      <h3 className="device-type-title">{deviceType}</h3>
                      <div className={`status-badge ${remaining > 0 ? 'status-not-started' : 'status-completed'}`}>
                        {remaining > 0 ? `${remaining} Available` : 'Complete'}
                      </div>
                    </div>

                    <div className="registration-grid">
                      <div className="status-item status-completed">
                        <div className="status-count">{data.completed || 0}</div>
                        <div className="status-label">Done</div>
                      </div>
                      <div className="status-item status-in-progress">
                        <div className="status-count">{data.in_progress || 0}</div>
                        <div className="status-label">Active</div>
                      </div>
                      <div className="status-item status-not-started">
                        <div className="status-count">{remaining}</div>
                        <div className="status-label">Pending</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{marginTop: '24px', textAlign: 'center'}}>
              <button
                className="btn btn-success"
                onClick={handleRegisterDevice}
                disabled={!newSerialNumber.trim() || !selectedRegDeviceType || loading}
                style={{padding: '12px 24px', fontSize: '1rem'}}
              >
                {loading ? (
                  <>
                    <RotateCcw size={20} className="spin" />
                    Registering...
                  </>
                ) : (
                  <>
                    <Plus size={20} />
                    Register Device
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Testing Interface
  if (mode === 'testing') {
    const nextTest = getNextTest();
    
    return (
      <div className="container">
        <div className="max-width">
          <div className="header">
            <div className="header-left">
              <button className="btn btn-secondary" onClick={goBack}>
                <ArrowLeft size={20} />
                Back to Devices
              </button>
              <div>
                <h1 className="header-title">Testing Interface</h1>
                <p className="header-subtitle">
                  {selectedMO?.manufacturing_order_number} - {selectedDeviceType} - {selectedDevice?.serial_number}
                </p>
              </div>
            </div>
          </div>

          <ErrorAlert />

          {nextTest ? (
            <div className="card">
              <div className="test-card test-card-current">
                <div className="flex-between">
                  <div className="flex-center">
                    <span className="test-icon">{nextTest.icon}</span>
                    <div>
                      <h3 className="test-name">{nextTest.name}</h3>
                      <p className="test-duration">Estimated duration: {nextTest.duration}</p>
                    </div>
                  </div>
                  
                  <button
                    className="btn btn-primary btn-large"
                    onClick={() => executeTest(nextTest.id)}
                    disabled={testInProgress || loading}
                  >
                    {testInProgress ? (
                      <>
                        <RotateCcw size={20} className="spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <Play size={20} />
                        Start Test
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="test-sequence">
                <h3 className="section-title">Test Sequence Progress</h3>
                <div className="grid grid-cols-3">
                  {Object.values(testDefinitions).slice(0, selectedDevice?.total_steps || 5).map((test) => {
                    const isCompleted = selectedDevice?.completed_steps?.includes(test.id) || false;
                    const isCurrent = test.id === nextTest?.id;
                    
                    return (
                      <div
                        key={test.id}
                        className={`test-card ${isCurrent ? 'test-card-current' : ''}`}
                      >
                        <div className="flex-center">
                          <span className="test-icon-small">{test.icon}</span>
                          <div>
                            <h4 className="test-name-small">{test.name}</h4>
                            <p className="test-duration-small">{test.duration}</p>
                          </div>
                          {isCompleted && <CheckCircle size={20} className="text-success ml-auto" />}
                          {isCurrent && !isCompleted && <Circle size={20} className="text-primary ml-auto" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="completion-state">
                <CheckCircle size={64} className="text-success completion-icon" />
                <h2 className="completion-title">Device Testing Complete</h2>
                <p className="completion-subtitle">
                  All tests have been completed for {selectedDevice?.serial_number}
                </p>
                <button className="btn btn-success">
                  <Save size={20} />
                  Generate Report
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
};

export default TestingWorkflowApp;