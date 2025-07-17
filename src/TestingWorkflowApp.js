import React, { useState, useEffect } from 'react';
import { Search, Plus, Play, CheckCircle, Circle, AlertCircle, ArrowLeft, Save, RotateCcw, Database, FileText, Settings, Package, Clock, Users, PlusCircle, Zap, Eye, Link, Cpu, Cable, Wifi } from 'lucide-react';
import './testing_workflow.css';

const TestingWorkflowApp = () => {
  const [mode, setMode] = useState('mo-list');
  const [selectedMO, setSelectedMO] = useState(null);
  const [selectedDeviceType, setSelectedDeviceType] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [selectedTests, setSelectedTests] = useState([]);
  const [currentTest, setCurrentTest] = useState(null);
  const [testInProgress, setTestInProgress] = useState(false);
  const [serialNumber, setSerialNumber] = useState('');
  
  // API State
  const [manufacturingOrders, setManufacturingOrders] = useState([]);
  const [deviceTestsPreview, setDeviceTestsPreview] = useState(null);
  const [testDefinitions, setTestDefinitions] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Test definitions mapping database test_ids to UI components
  const getTestIcon = (testId) => {
    const iconMap = {
      'LNBI': <Eye size={24} />,           // Burn-In
      'LNCHB': <Package size={24} />,      // Housing Preparation  
      'LNCHP': <Cpu size={24} />,          // Chip Preparation
      'LNFR': <FileText size={24} />,      // Final Prep & Packaging
      'LNFT': <CheckCircle size={24} />,   // Final Test Post Seal
      'LNGP': <Settings size={24} />,      // Grade Device Performance
      'LNIT-01': <Zap size={24} />,        // S11 Test
      'LNIT-02': <Cpu size={24} />,        // DC Vπ Test
      'LNIT-03': <Zap size={24} />,        // S21 Test
      'LNIT-04': <Wifi size={24} />,       // 1 GHz Vπ Test
      'LNIT-05': <Settings size={24} />,   // RF Vπ Test
      'LNPC': <Link size={24} />,          // Attach Polarizer
      'LNPD': <Cable size={24} />,         // PD Attach
      'LNPDT': <Eye size={24} />,          // Dark Current and Photodetector
      'LNPTA': <Cable size={24} />,        // Fiber Attach
      'LNSL-LT': <Search size={24} />,     // Seam Seal-Leak test
      'LNWB-01': <Link size={24} />,       // RF Wire bond
      'LNWB-02': <Link size={24} />        // PD Ribbon Bond
    };
    return iconMap[testId] || <Circle size={24} />;
  };

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

  // Load Manufacturing Orders from API
  const loadManufacturingOrders = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await apiCall('/manufacturing-orders');
      setManufacturingOrders(data.manufacturing_orders || []);
      
    } catch (error) {
      setError(`Failed to load manufacturing orders: ${error.message}`);
      console.error('Error loading manufacturing orders:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load test definitions from API
  const loadTestDefinitions = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await apiCall('/test-definitions');
      setTestDefinitions(data.test_definitions || {});
      
    } catch (error) {
      setError(`Failed to load test definitions: ${error.message}`);
      console.error('Error loading test definitions:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load device tests preview - NEW FUNCTION
  const loadDeviceTestsPreview = async (deviceType) => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await apiCall(`/device-types/${deviceType}/tests-preview`);
      setDeviceTestsPreview(data);
      
    } catch (error) {
      setError(`Failed to load test preview: ${error.message}`);
      console.error('Error loading test preview:', error);
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
      setSelectedTests(data.device.required_tests || []);
      return data;
    } catch (error) {
      setError(`Failed to load device details: ${error.message}`);
      console.error('Error loading device details:', error);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Create Device - NEW FUNCTION
  const createDevice = async (serialNumber, deviceType) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await apiCall(`/devices/create?serial_number=${encodeURIComponent(serialNumber)}&device_type=${encodeURIComponent(deviceType)}`, {
        method: 'POST'
      });

      // After creating, load the device details
      const deviceData = await loadDeviceDetails(serialNumber);
      if (deviceData) {
        setMode('testing');
      }
      
      return response;
    } catch (error) {
      setError(`Failed to create device: ${error.message}`);
      console.error('Error creating device:', error);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Start Test with real API call
  const startTest = async (serialNumber, testId) => {
    try {
      setTestInProgress(true);
      setCurrentTest(testId);
      setError(null);

      // Start the test via API
      await apiCall(`/devices/${serialNumber}/tests/${testId}/start`, {
        method: 'POST'
      });

      // Poll for test completion
      const pollInterval = setInterval(async () => {
        try {
          const data = await apiCall(`/devices/${serialNumber}/tests/${testId}/status`);
          
          if (data.status === 'completed' || data.status === 'failed') {
            clearInterval(pollInterval);
            
            if (data.status === 'completed') {
              // Complete the test
              await apiCall(`/devices/${serialNumber}/tests/${testId}/complete`, {
                method: 'POST'
              });
              
              // Reload device details
              await loadDeviceDetails(serialNumber);
            } else {
              setError(`Test ${testId} failed: ${data.error_message || 'Unknown error'}`);
            }
            
            setTestInProgress(false);
            setCurrentTest(null);
          }
        } catch (pollError) {
          clearInterval(pollInterval);
          setError(`Failed to check test status: ${pollError.message}`);
          setTestInProgress(false);
          setCurrentTest(null);
        }
      }, 2000); // Poll every 2 seconds

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
  const selectMO = (mo) => {
    setSelectedMO(mo);
    setMode('device-types');
  };

  // Handle device type selection - NEW: Load test preview
  const selectDeviceType = async (deviceType) => {
    setSelectedDeviceType(deviceType);
    setSerialNumber('');
    setSelectedDevice(null);
    setSelectedTests([]);
    setDeviceTestsPreview(null);
    
    // Load test preview for this device type
    await loadDeviceTestsPreview(deviceType);
    setMode('serial-input');
  };

  // Handle Create Device - NEW FUNCTION
  const handleCreateDevice = async () => {
    if (!serialNumber.trim()) {
      alert('Please enter a serial number');
      return;
    }

    const result = await createDevice(serialNumber.trim(), selectedDeviceType);
    if (result) {
      alert(`Device ${serialNumber} created successfully!`);
    }
  };

  // Handle Search Device - NEW FUNCTION
  const handleSearchDevice = async () => {
    if (!serialNumber.trim()) {
      alert('Please enter a serial number');
      return;
    }

    try {
      const deviceData = await loadDeviceDetails(serialNumber.trim());
      
      if (deviceData && deviceData.device) {
        // Verify device type matches
        if (deviceData.device.device_type !== selectedDeviceType) {
          alert(`Device ${serialNumber} is not a ${selectedDeviceType}. It's a ${deviceData.device.device_type}.`);
          return;
        }
        
        setMode('testing');
      }
    } catch (error) {
      // Device not found
      if (error.message.includes('404') || error.message.includes('not found')) {
        alert(`Device ${serialNumber} not found. Use "Create New Device" to create it.`);
      } else {
        setError(`Failed to search device: ${error.message}`);
      }
    }
  };

  // Get next test for device
  const getNextTest = () => {
    if (!selectedDevice || !selectedTests.length) return null;
    
    if (selectedDevice.current_step === 'completed') {
      return null;
    }
    
    if (selectedDevice.current_step === 'not_started') {
      const firstTestId = selectedTests[0];
      const testData = testDefinitions[firstTestId];
      if (testData) {
        return {
          id: firstTestId,
          name: testData.test_name || firstTestId,
          icon: getTestIcon(firstTestId),
          duration: `${testData.estimated_duration_minutes || 0} mins`,
          description: testData.description || `${testData.test_name || firstTestId} test procedure`
        };
      }
    }
    
    const currentIndex = selectedTests.indexOf(selectedDevice.current_step);
    
    if (currentIndex >= 0 && currentIndex + 1 < selectedTests.length) {
      const nextTestId = selectedTests[currentIndex + 1];
      const testData = testDefinitions[nextTestId];
      if (testData) {
        return {
          id: nextTestId,
          name: testData.test_name || nextTestId,
          icon: getTestIcon(nextTestId),
          duration: `${testData.estimated_duration_minutes || 0} mins`,
          description: testData.description || `${testData.test_name || nextTestId} test procedure`
        };
      }
    }
    
    const currentTestData = testDefinitions[selectedDevice.current_step];
    if (currentTestData) {
      return {
        id: selectedDevice.current_step,
        name: currentTestData.test_name || selectedDevice.current_step,
        icon: getTestIcon(selectedDevice.current_step),
        duration: `${currentTestData.estimated_duration_minutes || 0} mins`,
        description: currentTestData.description || `${currentTestData.test_name || selectedDevice.current_step} test procedure`
      };
    }
    
    return null;
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
    if (mode === 'testing') {
      setMode('serial-input');
      setSelectedDevice(null);
    } else if (mode === 'serial-input') {
      setMode('device-types');
      setSelectedDeviceType(null);
      setSerialNumber('');
      setDeviceTestsPreview(null);
    } else if (mode === 'device-types') {
      setMode('mo-list');
      setSelectedMO(null);
    }
  };

  // Error display component
  const ErrorAlert = () => {
    if (!error) return null;
    
    return (
      <div className="alert alert-error" style={{
        marginBottom: '20px',
        padding: '12px 16px',
        backgroundColor: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        color: '#dc2626'
      }}>
        <AlertCircle size={20} style={{marginRight: '8px'}} />
        <span>{error}</span>
        <button 
          onClick={() => setError(null)}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '0 4px'
          }}
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
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '20px'
      }}>
        <RotateCcw size={24} className="spin" />
        <span style={{marginLeft: '10px'}}>Loading...</span>
      </div>
    );
  };

  // Manufacturing Orders List View (unchanged)
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
                      <div 
                        key={type} 
                        className="device-type-summary clickable"
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent triggering MO card click
                          setSelectedMO(mo);
                          selectDeviceType(type);
                        }}
                        title={`Click to manage ${type} devices`}
                      >
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

  // Device Types View (unchanged)
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
              {Object.entries(selectedMO?.device_types || {}).map(([deviceType, data]) => {
                const totalStarted = (data.completed || 0) + (data.in_progress || 0);
                const isNotStarted = totalStarted === 0;
                
                return (
                  <div
                    key={deviceType}
                    className={`device-type-card ${isNotStarted ? 'not-started' : ''}`}
                    onClick={() => selectDeviceType(deviceType)}
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

                    <div className="device-actions">
                      <span className="action-hint">
                        Click to manage devices for {deviceType}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Serial Number Input View - UPDATED with Create/Search buttons and test preview
  if (mode === 'serial-input') {
    return (
      <div className="container">
        <div className="max-width">
          <div className="header">
            <div className="header-left">
              <button className="btn btn-secondary" onClick={goBack}>
                <ArrowLeft size={20} />
                Back to Device Types
              </button>
              <div>
                <h1 className="header-title">Device Management for {selectedDeviceType}</h1>
                <p className="header-subtitle">{selectedMO?.manufacturing_order_number} - {selectedDeviceType}</p>
              </div>
            </div>
          </div>

          <ErrorAlert />

          <div className="card">
            <div style={{textAlign: 'center', padding: '40px'}}>
              <div style={{marginBottom: '32px'}}>
                <Package size={64} style={{color: '#3b82f6', margin: '0 auto 16px', display: 'block'}} />
                <h2 style={{margin: '0 0 8px 0', fontSize: '1.5rem', fontWeight: '600'}}>
                  Device Management for {selectedDeviceType}
                </h2>
                <p style={{margin: 0, color: '#64748b'}}>
                  View required tests and create or search for devices
                </p>
              </div>

              {/* Show test preview for this device type */}
              {deviceTestsPreview && (
                <div style={{marginBottom: '32px', padding: '20px', backgroundColor: '#f8fafc', borderRadius: '8px', textAlign: 'left'}}>
                  <h3 style={{margin: '0 0 16px 0', fontSize: '1.1rem', textAlign: 'center'}}>
                    Required Tests for {selectedDeviceType}:
                  </h3>
                  
                  {deviceTestsPreview.summary && (
                    <div style={{marginBottom: '16px', padding: '12px', backgroundColor: '#e0f2fe', borderRadius: '6px', fontSize: '0.9rem'}}>
                      <strong>Summary:</strong> {deviceTestsPreview.summary.required_tests} required tests, 
                      {deviceTestsPreview.summary.optional_tests} optional tests, 
                      estimated time: {deviceTestsPreview.summary.estimated_total_hours} hours
                    </div>
                  )}

                  <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px'}}>
                    {deviceTestsPreview.tests?.filter(test => test.is_required).map((test) => (
                      <div key={test.test_id} style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px 12px',
                        backgroundColor: 'white',
                        borderRadius: '6px',
                        border: '1px solid #e2e8f0',
                        fontSize: '0.85rem'
                      }}>
                        <span style={{marginRight: '8px', color: '#3b82f6'}}>
                          {getTestIcon(test.test_id)}
                        </span>
                        <div style={{flex: 1}}>
                          <div style={{fontWeight: '500'}}>{test.test_name}</div>
                          <div style={{color: '#64748b', fontSize: '0.8rem'}}>
                            Step {test.sequence_order} • {test.estimated_duration_minutes} min
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{maxWidth: '400px', margin: '0 auto'}}>
                <label style={{display: 'block', marginBottom: '8px', fontWeight: '500', textAlign: 'left'}}>
                  Device Serial Number
                </label>
                <input
                  type="text"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  placeholder={`Enter serial number (e.g., ${selectedDeviceType}-001)`}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '2px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '1rem',
                    marginBottom: '24px'
                  }}
                  autoFocus
                />

                <div style={{display: 'flex', gap: '12px'}}>
                  <button
                    className="btn btn-success"
                    onClick={handleCreateDevice}
                    disabled={!serialNumber.trim() || loading}
                    style={{
                      flex: 1,
                      padding: '12px 24px',
                      fontSize: '1rem'
                    }}
                  >
                    {loading ? (
                      <>
                        <RotateCcw size={20} className="spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <PlusCircle size={20} />
                        Create New Device
                      </>
                    )}
                  </button>
                  
                  <button
                    className="btn btn-primary"
                    onClick={handleSearchDevice}
                    disabled={!serialNumber.trim() || loading}
                    style={{
                      flex: 1,
                      padding: '12px 24px',
                      fontSize: '1rem'
                    }}
                  >
                    {loading ? (
                      <>
                        <RotateCcw size={20} className="spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <Search size={20} />
                        Search Existing
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Testing Interface - SIMPLIFIED (removed test-selection mode)
  if (mode === 'testing') {
    const nextTest = getNextTest();
    const completedCount = selectedDevice?.completed_steps?.length || 0;
    const totalCount = selectedTests.length;
    const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
    
    return (
      <div className="container">
        <div className="max-width">
          <div className="header">
            <div className="header-left">
              <button className="btn btn-secondary" onClick={goBack}>
                <ArrowLeft size={20} />
                Back to Device Management
              </button>
              <div>
                <h1 className="header-title">Testing: {selectedDevice?.serial_number}</h1>
                <p className="header-subtitle">
                  {selectedMO?.manufacturing_order_number} - {selectedDeviceType} - Progress: {completedCount}/{totalCount} tests
                </p>
              </div>
            </div>
          </div>

          <ErrorAlert />

          {/* Device Status Overview */}
          <div className="card" style={{marginBottom: '24px'}}>
            <div style={{padding: '20px'}}>
              <div className="flex-between" style={{marginBottom: '16px'}}>
                <h3 style={{margin: 0, fontSize: '1.2rem'}}>Device Status</h3>
                <div className={`status-badge ${selectedDevice?.status === 'completed' ? 'status-completed' : selectedDevice?.status === 'in_progress' ? 'status-in-progress' : 'status-not-started'}`}>
                  {selectedDevice?.status === 'completed' ? 'Completed' : 
                   selectedDevice?.status === 'in_progress' ? 'In Progress' : 'Not Started'}
                </div>
              </div>
              
              <div className="progress-section">
                <div className="flex-between" style={{marginBottom: '8px'}}>
                  <span>Overall Progress</span>
                  <span>{completedCount}/{totalCount} tests completed</span>
                </div>
                <div className="progress-bar">
                  <div 
                    className="progress-fill"
                    style={{width: `${progressPercent}%`}}
                  />
                </div>
              </div>
            </div>
          </div>

          {nextTest ? (
            <div className="card">
              <div className="test-card test-card-current" style={{
                padding: '24px',
                border: '2px solid #3b82f6',
                borderRadius: '12px',
                backgroundColor: '#eff6ff',
                marginBottom: '24px'
              }}>
                <div className="flex-between">
                  <div className="flex-center">
                    <span className="test-icon" style={{marginRight: '16px', color: '#3b82f6'}}>
                      {nextTest.icon}
                    </span>
                    <div>
                      <h3 className="test-name" style={{margin: 0, fontSize: '1.5rem', fontWeight: '600'}}>
                        {nextTest.name}
                      </h3>
                      <p className="test-duration" style={{margin: '4px 0 0 0', color: '#64748b'}}>
                        Estimated duration: {nextTest.duration}
                      </p>
                      <p style={{margin: '4px 0 0 0', color: '#64748b', fontSize: '0.9rem'}}>
                        {nextTest.description}
                      </p>
                    </div>
                  </div>
                  
                  <button
                    className="btn btn-primary btn-large"
                    onClick={() => executeTest(nextTest.id)}
                    disabled={testInProgress || loading}
                    style={{
                      padding: '12px 24px',
                      fontSize: '1.1rem',
                      minWidth: '140px'
                    }}
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
                <div className="grid grid-cols-3" style={{gap: '16px'}}>
                  {selectedTests.map((testId, index) => {
                    const testData = testDefinitions[testId];
                    const test = {
                      id: testId,
                      name: testData?.test_name || testId,
                      icon: getTestIcon(testId),
                      duration: `${testData?.estimated_duration_minutes || 0} mins`
                    };
                    const isCompleted = selectedDevice?.completed_steps?.includes(testId) || false;
                    const isCurrent = test.id === nextTest?.id;
                    
                    return (
                      <div
                        key={testId}
                        className={`test-card ${isCurrent ? 'test-card-current' : ''}`}
                        style={{
                          padding: '16px',
                          borderRadius: '8px',
                          opacity: isCompleted ? 0.7 : 1,
                          backgroundColor: isCompleted ? '#f0f9ff' : isCurrent ? '#eff6ff' : 'white',
                          border: isCurrent ? '2px solid #3b82f6' : '1px solid #e2e8f0'
                        }}
                      >
                        <div className="flex-center">
                          <span className="test-icon-small" style={{
                            marginRight: '12px',
                            color: isCompleted ? '#10b981' : isCurrent ? '#3b82f6' : '#64748b'
                          }}>
                            {test.icon}
                          </span>
                          <div style={{flex: 1}}>
                            <h4 className="test-name-small" style={{
                              margin: 0, 
                              fontSize: '1rem', 
                              fontWeight: '600'
                            }}>
                              {test.name}
                            </h4>
                            <p className="test-duration-small" style={{
                              margin: '2px 0', 
                              color: '#64748b', 
                              fontSize: '0.8rem'
                            }}>
                              {test.duration}
                            </p>
                            <p style={{margin: 0, fontSize: '0.75rem', color: '#64748b'}}>
                              Step {index + 1} of {selectedTests.length}
                            </p>
                          </div>
                          {isCompleted && (
                            <CheckCircle size={20} className="text-success ml-auto" style={{color: '#10b981'}} />
                          )}
                          {isCurrent && !isCompleted && (
                            <Circle size={20} className="text-primary ml-auto" style={{color: '#3b82f6'}} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {testInProgress && (
                <div style={{
                  marginTop: '24px',
                  padding: '16px',
                  backgroundColor: '#fef3c7',
                  border: '1px solid #f59e0b',
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                    <RotateCcw size={20} className="spin" style={{marginRight: '8px', color: '#f59e0b'}} />
                    <span style={{color: '#92400e', fontWeight: '500'}}>
                      Test in progress... Please wait for completion
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card">
              <div className="completion-state" style={{
                textAlign: 'center',
                padding: '48px 24px'
              }}>
                <CheckCircle size={64} className="text-success completion-icon" style={{
                  color: '#10b981',
                  margin: '0 auto 24px',
                  display: 'block'
                }} />
                <h2 className="completion-title" style={{
                  margin: '0 0 12px 0',
                  fontSize: '2rem',
                  fontWeight: '700',
                  color: '#1f2937'
                }}>
                  Device Testing Complete
                </h2>
                <p className="completion-subtitle" style={{
                  margin: '0 0 32px 0',
                  color: '#64748b',
                  fontSize: '1.1rem'
                }}>
                  All {selectedTests.length} tests have been completed for {selectedDevice?.serial_number}
                </p>
                
                <div style={{
                  marginBottom: '32px',
                  padding: '16px',
                  backgroundColor: '#f0fdf4',
                  borderRadius: '8px',
                  border: '1px solid #bbf7d0'
                }}>
                  <h3 style={{margin: '0 0 12px 0', fontSize: '1rem', color: '#166534'}}>
                    Completed Tests Summary:
                  </h3>
                  <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center'}}>
                    {selectedTests.map((testId) => {
                      const testData = testDefinitions[testId];
                      const testName = testData?.test_name || testId;
                      return (
                        <div key={testId} style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '6px 12px',
                          backgroundColor: 'white',
                          borderRadius: '20px',
                          border: '1px solid #bbf7d0',
                          fontSize: '0.85rem'
                        }}>
                          <CheckCircle size={14} style={{marginRight: '6px', color: '#10b981'}} />
                          {testName}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'center'}}>
                  <button className="btn btn-success" style={{
                    padding: '12px 24px',
                    fontSize: '1rem'
                  }}>
                    <Save size={20} />
                    Generate Report
                  </button>
                  <button className="btn btn-secondary" onClick={goBack} style={{
                    padding: '12px 24px',
                    fontSize: '1rem'
                  }}>
                    <ArrowLeft size={20} />
                    Test Another Device
                  </button>
                </div>
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