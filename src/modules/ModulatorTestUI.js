import React, { useState, useEffect, useRef } from 'react';

const ModulatorTestUI = () => {
  // State variables for form inputs
  const [deviceType, setDeviceType] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [operator, setOperator] = useState('');
  const [recordedInput, setRecordedInput] = useState('');
  
  // State variables for test results
  const [testResults, setTestResults] = useState({
    vpi: '',
    er: '',
    il: '',
    grade: '',
    date: '',
    phaseAngle: ''
  });
  
  // State variables for UI control
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [testCompleted, setTestCompleted] = useState(false);
  const [graphImage, setGraphImage] = useState(null);
  const [instrumentStatus, setInstrumentStatus] = useState('Disconnected');
  const [deviceTypes, setDeviceTypes] = useState([]);
  
  // Ref for file input (if needed for logo or other files)
  const fileInputRef = useRef(null);
  
  // API base URL - adjust according to your FastAPI server
  const API_BASE_URL = 'http://localhost:8000/api/modulator';
  
  useEffect(() => {
    // Initialize component - check instrument status and load device types
    checkInstrumentStatus();
    loadDeviceTypes();
    setTestResults(prev => ({ ...prev, date: getCurrentDate() }));
  }, []);
  
  const getCurrentDate = () => {
    const now = new Date();
    return now.toLocaleDateString('en-US');
  };
  
  const checkInstrumentStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/status`);
      const data = await response.json();
      setInstrumentStatus(data.status || 'Unknown');
    } catch (error) {
      console.error('Error checking instrument status:', error);
      setInstrumentStatus('Error');
    }
  };
  
  const loadDeviceTypes = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/device-types`);
      const data = await response.json();
      setDeviceTypes(data.device_types || []);
    } catch (error) {
      console.error('Error loading device types:', error);
      setDeviceTypes(['LNLVL-IM-Z', 'LN65S-FC', 'LN53S-FC']); // Default types
    }
  };
  
  const showMessageBox = (message, type = 'info') => {
    // Simple alert for now - you can replace with a better modal/toast system
    alert(message);
  };
  
  const startTest = async () => {
    if (!recordedInput || !deviceType || !serialNumber || !operator) {
      showMessageBox('Please fill in all required fields before starting the test.', 'warning');
      return;
    }
    
    try {
      setIsTestRunning(true);
      
      // Show input power confirmation
      const confirmed = window.confirm(`Input power: ${recordedInput}. Please connect modulator output to the detector and click OK to continue.`);
      if (!confirmed) {
        setIsTestRunning(false);
        return;
      }
      
      // Prepare test request
      const testRequest = {
        device_type: deviceType,
        serial_number: serialNumber,
        operator: operator,
        input_power: parseFloat(recordedInput)
      };
      
      // Start the test
      const response = await fetch(`${API_BASE_URL}/run-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testRequest)
      });
      
      if (!response.ok) {
        throw new Error(`Test failed: ${response.statusText}`);
      }
      
      const testData = await response.json();
      
      // Update test results
      setTestResults({
        vpi: testData.vpi_value ? testData.vpi_value.toFixed(2) : 'N/A',
        er: testData.extinction_ratio ? testData.extinction_ratio.toFixed(2) : 'N/A',
        il: testData.insertion_loss ? testData.insertion_loss.toFixed(2) : 'N/A',
        grade: testData.result || 'UNKNOWN',
        date: getCurrentDate(),
        phaseAngle: testData.phase_angle ? testData.phase_angle.toFixed(2) : 'N/A'
      });
      
      // Load graph image if available
      if (testData.plot_path) {
        setGraphImage(`${API_BASE_URL}/graph/${testData.plot_filename}`);
      }
      
      setTestCompleted(true);
      showMessageBox('Test completed successfully!', 'success');
      
    } catch (error) {
      console.error('Error running test:', error);
      showMessageBox(`Test failed: ${error.message}`, 'error');
    } finally {
      setIsTestRunning(false);
    }
  };
  
  const redoTest = () => {
    setTestCompleted(false);
    setTestResults({
      vpi: '',
      er: '',
      il: '',
      grade: '',
      date: getCurrentDate(),
      phaseAngle: ''
    });
    setGraphImage(null);
    startTest();
  };
  
  const printResults = async () => {
    if (!testCompleted) {
      showMessageBox('Please complete a test before printing results.', 'warning');
      return;
    }
    
    try {
      const reportRequest = {
        device_type: deviceType,
        serial_number: serialNumber,
        operator: operator,
        vpi_value: parseFloat(testResults.vpi) || 0,
        insertion_loss: parseFloat(testResults.il) || 0,
        extinction_ratio: parseFloat(testResults.er) || 0,
        phase_angle: parseFloat(testResults.phaseAngle) || 0,
        result: testResults.grade
      };
      
      const response = await fetch(`${API_BASE_URL}/generate-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reportRequest)
      });
      
      if (!response.ok) {
        throw new Error(`Report generation failed: ${response.statusText}`);
      }
      
      // Handle PDF download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `ModulatorTest_${deviceType}_${serialNumber}_${getCurrentDate().replace(/\//g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      showMessageBox('Report generated and downloaded successfully!', 'success');
      
    } catch (error) {
      console.error('Error generating report:', error);
      showMessageBox(`Report generation failed: ${error.message}`, 'error');
    }
  };
  
  const exitApplication = () => {
    if (window.confirm('Are you sure you want to exit?')) {
      window.close();
    }
  };
  
  return (
    <div style={{ 
      fontFamily: 'Arial, sans-serif', 
      padding: '20px', 
      maxWidth: '1200px', 
      margin: '0 auto',
      backgroundColor: '#f5f5f5',
      minHeight: '100vh'
    }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        backgroundColor: 'white',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '20px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            width: '80px',
            height: '60px',
            backgroundColor: '#ddd',
            marginRight: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            color: '#666'
          }}>
            LOGO
          </div>
          <h1 style={{ margin: 0, color: '#333' }}>Modulator Test UI</h1>
        </div>
        <div style={{ 
          padding: '8px 16px',
          backgroundColor: instrumentStatus === 'Connected' ? '#d4edda' : '#f8d7da',
          color: instrumentStatus === 'Connected' ? '#155724' : '#721c24',
          borderRadius: '4px',
          fontSize: '14px'
        }}>
          Status: {instrumentStatus}
        </div>
      </div>
      
      {/* Main Content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        
        {/* Input Panel */}
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ marginTop: 0, color: '#333', borderBottom: '2px solid #007bff', paddingBottom: '10px' }}>
            Test Configuration
          </h2>
          
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              Device Type:
            </label>
            <select
              value={deviceType}
              onChange={(e) => setDeviceType(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            >
              <option value="">Select Device Type</option>
              {deviceTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              Serial Number:
            </label>
            <input
              type="text"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
              placeholder="Enter serial number"
            />
          </div>
          
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              Operator:
            </label>
            <input
              type="text"
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
              placeholder="Enter operator name"
            />
          </div>
          
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              Input Power (dBm):
            </label>
            <input
              type="number"
              step="0.1"
              value={recordedInput}
              onChange={(e) => setRecordedInput(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
              placeholder="Enter input power"
            />
          </div>
          
          {/* Control Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <button
              onClick={startTest}
              disabled={isTestRunning}
              style={{
                padding: '12px',
                backgroundColor: isTestRunning ? '#6c757d' : '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '16px',
                cursor: isTestRunning ? 'not-allowed' : 'pointer',
                fontWeight: 'bold'
              }}
            >
              {isTestRunning ? 'Testing...' : 'Start Test'}
            </button>
            
            <button
              onClick={redoTest}
              disabled={isTestRunning || !testCompleted}
              style={{
                padding: '12px',
                backgroundColor: (!testCompleted || isTestRunning) ? '#6c757d' : '#ffc107',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '16px',
                cursor: (!testCompleted || isTestRunning) ? 'not-allowed' : 'pointer',
                fontWeight: 'bold'
              }}
            >
              Redo Test
            </button>
            
            <button
              onClick={printResults}
              disabled={!testCompleted}
              style={{
                padding: '12px',
                backgroundColor: !testCompleted ? '#6c757d' : '#17a2b8',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '16px',
                cursor: !testCompleted ? 'not-allowed' : 'pointer',
                fontWeight: 'bold'
              }}
            >
              Print Report
            </button>
            
            <button
              onClick={exitApplication}
              style={{
                padding: '12px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '16px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              Exit
            </button>
          </div>
        </div>
        
        {/* Results Panel */}
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ marginTop: 0, color: '#333', borderBottom: '2px solid #007bff', paddingBottom: '10px' }}>
            Test Results
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                DC Vπ (V):
              </label>
              <input
                type="text"
                value={testResults.vpi}
                readOnly
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: '#f8f9fa',
                  fontSize: '14px'
                }}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Extinction Ratio (dB):
              </label>
              <input
                type="text"
                value={testResults.er}
                readOnly
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: '#f8f9fa',
                  fontSize: '14px'
                }}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Insertion Loss (dB):
              </label>
              <input
                type="text"
                value={testResults.il}
                readOnly
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: '#f8f9fa',
                  fontSize: '14px'
                }}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Phase Angle (°):
              </label>
              <input
                type="text"
                value={testResults.phaseAngle}
                readOnly
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: '#f8f9fa',
                  fontSize: '14px'
                }}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Test Date:
              </label>
              <input
                type="text"
                value={testResults.date}
                readOnly
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: '#f8f9fa',
                  fontSize: '14px'
                }}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Result:
              </label>
              <input
                type="text"
                value={testResults.grade}
                readOnly
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: testResults.grade === 'PASS' ? '#d4edda' : 
                                 testResults.grade === 'FAIL' ? '#f8d7da' : '#f8f9fa',
                  color: testResults.grade === 'PASS' ? '#155724' : 
                         testResults.grade === 'FAIL' ? '#721c24' : '#333',
                  fontSize: '14px',
                  fontWeight: 'bold'
                }}
              />
            </div>
          </div>
        </div>
      </div>
      
      {/* Graph Display */}
      {graphImage && (
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginTop: '20px'
        }}>
          <h2 style={{ marginTop: 0, color: '#333', borderBottom: '2px solid #007bff', paddingBottom: '10px' }}>
            Test Graph
          </h2>
          <div style={{ textAlign: 'center' }}>
            <img
              src={graphImage}
              alt="Test Results Graph"
              style={{
                maxWidth: '100%',
                height: 'auto',
                border: '1px solid #ddd',
                borderRadius: '4px'
              }}
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'block';
              }}
            />
            <div style={{ display: 'none', padding: '40px', color: '#666' }}>
              Graph could not be loaded
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModulatorTestUI;