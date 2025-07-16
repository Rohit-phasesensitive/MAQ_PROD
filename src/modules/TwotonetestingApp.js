// src/modules/TwotonetestingApp.js - Two Tone Testing Module

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './TwotonetestingApp.css';

const API_BASE_URL = 'http://localhost:8000';

const TwotonetestingApp = ({ user, addNotification }) => {
  const [loading, setLoading] = useState(false);
  const [testInProgress, setTestInProgress] = useState(false);
  const [connected, setConnected] = useState(false);
  
  // Form data
  const [testData, setTestData] = useState({
    serialNumber: '',
    deviceType: '',
    operator: user?.username || '',
    inputRfPower: '',
    notes: ''
  });

  // Test results
  const [results, setResults] = useState({
    mixterm1: '',
    fterm1: '',
    mixterm2: '',
    fterm2: '',
    vpi: '',
    result: '',
    graphImage: null
  });

  // History and settings
  const [testHistory, setTestHistory] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    checkInstrumentConnection();
    fetchDeviceTypes();
    fetchTestHistory();
  }, []);

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('authToken')}`
  });

  const checkInstrumentConnection = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/modules/twotone/status`, {
        headers: getAuthHeaders()
      });
      setConnected(response.data.connected);
      if (response.data.connected) {
        addNotification('ESA instrument connected successfully', 'success');
      } else {
        addNotification('ESA instrument not connected', 'warning');
      }
    } catch (error) {
      console.error('Error checking instrument connection:', error);
      setConnected(false);
      addNotification('Failed to check instrument status', 'error');
    }
  };

  const fetchDeviceTypes = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/modules/twotone/device-types`, {
        headers: getAuthHeaders()
      });
      setDeviceTypes(response.data.device_types || []);
    } catch (error) {
      console.error('Error fetching device types:', error);
      addNotification('Failed to fetch device types', 'error');
    }
  };

  const fetchTestHistory = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/modules/twotone/history`, {
        headers: getAuthHeaders()
      });
      setTestHistory(response.data.tests || []);
    } catch (error) {
      console.error('Error fetching test history:', error);
    }
  };

  const runTest = async () => {
    if (!testData.serialNumber || !testData.deviceType || !testData.inputRfPower) {
      addNotification('Please fill in all required fields', 'error');
      return;
    }

    if (!connected) {
      addNotification('ESA instrument not connected', 'error');
      return;
    }

    setTestInProgress(true);
    setLoading(true);

    try {
      // Initialize ESA
      await axios.post(`${API_BASE_URL}/modules/twotone/initialize`, {}, {
        headers: getAuthHeaders()
      });

      addNotification('ESA initialized, running test...', 'info');

      // Run the test
      const testResponse = await axios.post(`${API_BASE_URL}/modules/twotone/run-test`, {
        serial_number: testData.serialNumber,
        device_type: testData.deviceType,
        input_rf_power: parseFloat(testData.inputRfPower),
        operator: testData.operator,
        notes: testData.notes
      }, {
        headers: getAuthHeaders()
      });

      const result = testResponse.data;
      
      setResults({
        mixterm1: result.mixterm1.toFixed(2),
        fterm1: result.fterm1.toFixed(2),
        mixterm2: result.mixterm2.toFixed(2),
        fterm2: result.fterm2.toFixed(2),
        vpi: result.vpi.toFixed(2),
        result: result.test_result,
        graphImage: result.graph_path
      });

      addNotification(
        `Test completed: ${result.test_result} (Vπ: ${result.vpi.toFixed(2)}V)`, 
        result.test_result === 'PASS' ? 'success' : 'error'
      );

      // Refresh history
      fetchTestHistory();

    } catch (error) {
      console.error('Error running test:', error);
      addNotification(
        error.response?.data?.detail || 'Test failed - check instrument connection', 
        'error'
      );
    }

    setTestInProgress(false);
    setLoading(false);
  };

  const stopTest = () => {
    setTestInProgress(false);
    setLoading(false);
    addNotification('Test stopped', 'info');
  };

  const clearResults = () => {
    setResults({
      mixterm1: '',
      fterm1: '',
      mixterm2: '',
      fterm2: '',
      vpi: '',
      result: '',
      graphImage: null
    });
  };

  const generateReport = async () => {
    if (!results.vpi) {
      addNotification('No test results to generate report', 'error');
      return;
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/modules/twotone/generate-report`, {
        serial_number: testData.serialNumber,
        device_type: testData.deviceType,
        operator: testData.operator,
        ...results
      }, {
        headers: getAuthHeaders(),
        responseType: 'blob'
      });

      // Create blob and download
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `1GHzVpi_Test_Report_${testData.deviceType}_${testData.serialNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      addNotification('Test report generated successfully', 'success');
    } catch (error) {
      console.error('Error generating report:', error);
      addNotification('Failed to generate report', 'error');
    }
  };

  const handleInputChange = (field, value) => {
    setTestData(prev => ({ ...prev, [field]: value }));
  };

  const getResultClass = (result) => {
    if (result === 'PASS') return 'result-pass';
    if (result === 'FAIL') return 'result-fail';
    return '';
  };

  if (user?.role === 'viewer') {
    return (
      <div className="twotone-testing-module">
        <div className="access-denied">
          <h2>🔒 View Only Access</h2>
          <p>You have read-only access to test results.</p>
          <button onClick={() => setShowHistory(true)} className="btn btn-primary">
            View Test History
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="twotone-testing-module">
      {/* Module Header */}
      <div className="module-header">
        <h2>📶 1 GHz Vπ Two-Tone Testing</h2>
        <div className="module-actions">
          <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
            <span className="status-indicator">
              {connected ? '🟢' : '🔴'}
            </span>
            <span>ESA {connected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <button 
            onClick={checkInstrumentConnection} 
            className="btn btn-secondary"
            disabled={loading}
          >
            🔄 Check Connection
          </button>
          <button 
            onClick={() => setShowHistory(!showHistory)} 
            className="btn btn-secondary"
          >
            📊 {showHistory ? 'Hide' : 'Show'} History
          </button>
        </div>
      </div>

      <div className="module-content">
        {!showHistory ? (
          /* Test Interface */
          <div className="test-interface">
            {/* Test Configuration */}
            <div className="card">
              <h3>🔧 Test Configuration</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label>Serial Number *</label>
                  <input
                    type="text"
                    value={testData.serialNumber}
                    onChange={(e) => handleInputChange('serialNumber', e.target.value)}
                    placeholder="Enter device serial number"
                    disabled={testInProgress}
                  />
                </div>

                <div className="form-group">
                  <label>Device Type *</label>
                  <select
                    value={testData.deviceType}
                    onChange={(e) => handleInputChange('deviceType', e.target.value)}
                    disabled={testInProgress}
                  >
                    <option value="">Select device type</option>
                    {deviceTypes.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Input RF Power (dBm) *</label>
                  <input
                    type="number"
                    step="0.1"
                    value={testData.inputRfPower}
                    onChange={(e) => handleInputChange('inputRfPower', e.target.value)}
                    placeholder="Enter RF power level"
                    disabled={testInProgress}
                  />
                </div>

                <div className="form-group">
                  <label>Operator</label>
                  <input
                    type="text"
                    value={testData.operator}
                    onChange={(e) => handleInputChange('operator', e.target.value)}
                    placeholder="Operator name"
                    disabled={testInProgress}
                  />
                </div>

                <div className="form-group full-width">
                  <label>Notes</label>
                  <textarea
                    value={testData.notes}
                    onChange={(e) => handleInputChange('notes', e.target.value)}
                    placeholder="Additional test notes..."
                    rows={3}
                    disabled={testInProgress}
                  />
                </div>
              </div>

              <div className="button-group">
                <button 
                  onClick={runTest}
                  disabled={!connected || testInProgress}
                  className="btn btn-primary"
                >
                  {testInProgress ? '🔄 Testing...' : '▶️ Run Test'}
                </button>
                <button 
                  onClick={stopTest}
                  disabled={!testInProgress}
                  className="btn btn-danger"
                >
                  ⏹️ Stop Test
                </button>
                <button 
                  onClick={clearResults}
                  disabled={testInProgress}
                  className="btn btn-secondary"
                >
                  🗑️ Clear Results
                </button>
              </div>
            </div>

            {/* Test Results */}
            <div className="results-section">
              <div className="card">
                <h3>📊 Test Results</h3>
                <div className="results-grid">
                  <div className="result-item">
                    <label>Mixterm 1 (dBm):</label>
                    <span className="result-value">{results.mixterm1 || '--'}</span>
                  </div>
                  <div className="result-item">
                    <label>F-term 1 (dBm):</label>
                    <span className="result-value">{results.fterm1 || '--'}</span>
                  </div>
                  <div className="result-item">
                    <label>Mixterm 2 (dBm):</label>
                    <span className="result-value">{results.mixterm2 || '--'}</span>
                  </div>
                  <div className="result-item">
                    <label>F-term 2 (dBm):</label>
                    <span className="result-value">{results.fterm2 || '--'}</span>
                  </div>
                  <div className="result-item highlight">
                    <label>Vπ (V):</label>
                    <span className="result-value vpi-value">{results.vpi || '--'}</span>
                  </div>
                  <div className="result-item highlight">
                    <label>Result:</label>
                    <span className={`result-value ${getResultClass(results.result)}`}>
                      {results.result || '--'}
                    </span>
                  </div>
                </div>

                {results.vpi && (
                  <div className="button-group">
                    <button 
                      onClick={generateReport}
                      className="btn btn-success"
                    >
                      📄 Generate PDF Report
                    </button>
                  </div>
                )}
              </div>

              {/* Graph Display */}
              {results.graphImage && (
                <div className="card">
                  <h3>📈 Test Graph</h3>
                  <div className="graph-container">
                    <img 
                      src={results.graphImage} 
                      alt="Two-tone test graph"
                      className="test-graph"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Test History */
          <div className="history-section">
            <div className="card">
              <h3>📊 Test History</h3>
              <div className="history-controls">
                <button 
                  onClick={fetchTestHistory}
                  className="btn btn-secondary"
                >
                  🔄 Refresh
                </button>
              </div>

              <div className="history-grid">
                {testHistory.length === 0 ? (
                  <div className="no-data">
                    <p>No test history available</p>
                  </div>
                ) : (
                  testHistory.map((test, index) => (
                    <div key={index} className="history-item">
                      <div className="history-header">
                        <h4>{test.device_type} - {test.serial_number}</h4>
                        <span className={`result-badge ${getResultClass(test.result)}`}>
                          {test.result}
                        </span>
                      </div>
                      <div className="history-details">
                        <p><strong>Vπ:</strong> {test.vpi}V</p>
                        <p><strong>Date:</strong> {new Date(test.test_date).toLocaleString()}</p>
                        <p><strong>Operator:</strong> {test.operator}</p>
                        {test.notes && <p><strong>Notes:</strong> {test.notes}</p>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner"></div>
          <p>Running Two-Tone Test...</p>
        </div>
      )}
    </div>
  );
};

export default TwotonetestingApp;