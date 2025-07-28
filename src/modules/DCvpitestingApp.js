import React, { useState, useEffect, useRef } from 'react';
import './ModulatorTestUI.css';

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
    <div className="modulator-testing-module">
      {/* Header */}
      <div className="module-header">
        <h2>📈 DC Vπ Test</h2>
        <div className={`connection-status ${instrumentStatus === 'Connected' ? 'connected' : 'disconnected'}`}>
          <span className="status-indicator">●</span>
          Status: {instrumentStatus}
        </div>
      </div>
      
      {/* Main Content */}
      <div className="test-interface">
        
        {/* Input Panel */}
        <div className="card">
          <div className="card-header">
            <h3>Test Configuration</h3>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <div className="form-group">
                <label>Device Type</label>
                <select
                  value={deviceType}
                  onChange={(e) => setDeviceType(e.target.value)}
                >
                  <option value="">Select Device Type</option>
                  {deviceTypes.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              
              <div className="form-group">
                <label>Serial Number</label>
                <input
                  type="text"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  placeholder="Enter serial number"
                />
              </div>
              
              <div className="form-group">
                <label>Operator</label>
                <input
                  type="text"
                  value={operator}
                  onChange={(e) => setOperator(e.target.value)}
                  placeholder="Enter operator name"
                />
              </div>
              
              <div className="form-group">
                <label>Input Power (dBm)</label>
                <input
                  type="number"
                  step="0.1"
                  value={recordedInput}
                  onChange={(e) => setRecordedInput(e.target.value)}
                  placeholder="Enter input power"
                />
              </div>
            </div>
            
            {/* Control Buttons */}
            <div className="button-group four-buttons">
              <button
                onClick={startTest}
                disabled={isTestRunning}
                className={`btn ${isTestRunning ? 'btn-secondary' : 'btn-primary'}`}
              >
                {isTestRunning && <span className="loading-spinner"></span>}
                {isTestRunning ? 'Testing...' : 'Start Test'}
              </button>
              
              <button
                onClick={redoTest}
                disabled={isTestRunning || !testCompleted}
                className={`btn ${(!testCompleted || isTestRunning) ? 'btn-secondary' : 'btn-warning'}`}
              >
                Redo Test
              </button>
              
              <button
                onClick={printResults}
                disabled={!testCompleted}
                className={`btn ${!testCompleted ? 'btn-secondary' : 'btn-info'}`}
              >
                Print Report
              </button>
              
              <button
                onClick={exitApplication}
                className="btn btn-danger"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
        
        {/* Results Panel */}
        <div className="card">
          <div className="card-header">
            <h3>Test Results</h3>
          </div>
          <div className="card-body">
            <div className="results-grid">
              <div className="result-item highlight">
                <label>DC Vπ (V):</label>
                <span className={`result-value vpi-value`}>{testResults.vpi}</span>
              </div>
              
              <div className="result-item">
                <label>Extinction Ratio (dB):</label>
                <span className="result-value">{testResults.er}</span>
              </div>
              
              <div className="result-item">
                <label>Insertion Loss (dB):</label>
                <span className="result-value">{testResults.il}</span>
              </div>
              
              <div className="result-item">
                <label>Phase Angle (°):</label>
                <span className="result-value">{testResults.phaseAngle}</span>
              </div>
              
              <div className="result-item">
                <label>Test Date:</label>
                <span className="result-value">{testResults.date}</span>
              </div>
              
              <div className="result-item">
                <label>Result:</label>
                <span className={`result-value ${
                  testResults.grade === 'PASS' ? 'result-pass' : 
                  testResults.grade === 'FAIL' ? 'result-fail' : 'result-unknown'
                }`}>
                  {testResults.grade}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Graph Display */}
      {graphImage && (
        <div className="card">
          <div className="card-header">
            <h3>Test Graph</h3>
          </div>
          <div className="card-body">
            <div className={`graph-container ${graphImage ? 'has-graph' : ''}`}>
              <img
                src={graphImage}
                alt="Test Results Graph"
                className="test-graph"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'block';
                }}
              />
              <div className="graph-placeholder" style={{ display: 'none' }}>
                Graph could not be loaded
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModulatorTestUI;