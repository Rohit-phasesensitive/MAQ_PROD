// src/modules/S21TestingApp.js - S-Parameter Testing Module

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './S21TestingApp.css';

const API_BASE_URL = 'http://localhost:8000';

const S21TestingApp = ({ user, addNotification }) => {
  const [loading, setLoading] = useState(false);
  const [testInProgress, setTestInProgress] = useState(false);
  const [vnaConnected, setVnaConnected] = useState(false);
  const [showRippleTest, setShowRippleTest] = useState(false);
  
  // Form data
  const [testData, setTestData] = useState({
    serialNumber: '',
    deviceType: '',
    productNumber: '',
    operator: user?.username || '',
    notes: ''
  });

  // Test results
  const [results, setResults] = useState({
    s11Data: null,
    s21Data: null,
    s21Bandwidth: '',
    frequency3db: '',
    rippleResult: '',
    overallResult: '',
    plotImages: {
      sparamPlot: null,
      ripplePlot: null
    }
  });

  // History and settings
  const [testHistory, setTestHistory] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    checkVNAConnection();
    fetchDeviceTypes();
    fetchTestHistory();
  }, []);

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('authToken')}`
  });

  const checkVNAConnection = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/modules/s21/status`, {
        headers: getAuthHeaders()
      });
      setVnaConnected(response.data.connected);
      if (response.data.connected) {
        addNotification('VNA connected successfully', 'success');
      } else {
        addNotification('VNA not connected', 'warning');
      }
    } catch (error) {
      console.error('Error checking VNA connection:', error);
      setVnaConnected(false);
      addNotification('Failed to check VNA status', 'error');
    }
  };

  const fetchDeviceTypes = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/modules/s21/device-types`, {
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
      const response = await axios.get(`${API_BASE_URL}/modules/s21/history`, {
        headers: getAuthHeaders()
      });
      setTestHistory(response.data.tests || []);
    } catch (error) {
      console.error('Error fetching test history:', error);
    }
  };

  const runS11S21Test = async () => {
    if (!testData.serialNumber || !testData.deviceType) {
      addNotification('Please fill in all required fields', 'error');
      return;
    }

    if (!vnaConnected) {
      addNotification('VNA not connected', 'error');
      return;
    }

    setTestInProgress(true);
    setLoading(true);

    try {
      addNotification('Running S11 and S21 measurements...', 'info');

      // Run S-parameter test
      const testResponse = await axios.post(`${API_BASE_URL}/modules/s21/run-sparam-test`, {
        serial_number: testData.serialNumber,
        device_type: testData.deviceType,
        product_number: testData.productNumber,
        operator: testData.operator,
        notes: testData.notes
      }, {
        headers: getAuthHeaders()
      });

      const result = testResponse.data;
      
      setResults(prev => ({
        ...prev,
        s11Data: result.s11_data,
        s21Data: result.s21_data,
        s21Bandwidth: result.s21_bandwidth?.toFixed(2) || '',
        frequency3db: result.frequency_3db?.toFixed(2) || '',
        plotImages: {
          ...prev.plotImages,
          sparamPlot: result.sparam_plot_path
        }
      }));

      addNotification(
        `S-Parameter test completed. Bandwidth: ${result.s21_bandwidth?.toFixed(2)} GHz`, 
        'success'
      );

      // Ask user if they want to continue with ripple test
      setShowRippleTest(true);

    } catch (error) {
      console.error('Error running S-parameter test:', error);
      addNotification(
        error.response?.data?.detail || 'S-Parameter test failed', 
        'error'
      );
    }

    setTestInProgress(false);
    setLoading(false);
  };

  const runRippleTest = async () => {
    if (!results.s21Data) {
      addNotification('Please run S-Parameter test first', 'error');
      return;
    }

    setLoading(true);

    try {
      addNotification('Running ripple test...', 'info');

      const rippleResponse = await axios.post(`${API_BASE_URL}/modules/s21/run-ripple-test`, {
        serial_number: testData.serialNumber,
        device_type: testData.deviceType,
        operator: testData.operator
      }, {
        headers: getAuthHeaders()
      });

      const rippleResult = rippleResponse.data;
      
      setResults(prev => ({
        ...prev,
        rippleResult: rippleResult.ripple_result,
        overallResult: rippleResult.overall_result,
        plotImages: {
          ...prev.plotImages,
          ripplePlot: rippleResult.ripple_plot_path
        }
      }));

      addNotification(
        `Ripple test completed: ${rippleResult.ripple_result}`, 
        rippleResult.ripple_result === 'PASS' ? 'success' : 'error'
      );

      setShowRippleTest(false);

      // Refresh history
      fetchTestHistory();

    } catch (error) {
      console.error('Error running ripple test:', error);
      addNotification(
        error.response?.data?.detail || 'Ripple test failed', 
        'error'
      );
    }

    setLoading(false);
  };

  const skipRippleTest = () => {
    setShowRippleTest(false);
    setResults(prev => ({
      ...prev,
      rippleResult: 'SKIPPED',
      overallResult: 'S21_ONLY'
    }));
    addNotification('Ripple test skipped', 'info');
  };

  const clearResults = () => {
    setResults({
      s11Data: null,
      s21Data: null,
      s21Bandwidth: '',
      frequency3db: '',
      rippleResult: '',
      overallResult: '',
      plotImages: {
        sparamPlot: null,
        ripplePlot: null
      }
    });
    setShowRippleTest(false);
  };

  const generateReport = async () => {
    if (!results.s21Bandwidth) {
      addNotification('No test results to generate report', 'error');
      return;
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/modules/s21/generate-report`, {
        serial_number: testData.serialNumber,
        device_type: testData.deviceType,
        product_number: testData.productNumber,
        operator: testData.operator,
        s21_bandwidth: results.s21Bandwidth,
        frequency_3db: results.frequency3db,
        ripple_result: results.rippleResult,
        overall_result: results.overallResult
      }, {
        headers: getAuthHeaders(),
        responseType: 'blob'
      });

      // Create blob and download
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `SParam_Test_Report_${testData.deviceType}_${testData.serialNumber}.pdf`;
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
    if (result === 'SKIPPED') return 'result-skipped';
    return '';
  };

  if (user?.role === 'viewer') {
    return (
      <div className="s21-testing-module">
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
    <div className="s21-testing-module">
      {/* Module Header */}
      <div className="module-header">
        <h2>📈 S-Parameter Testing (S11/S21)</h2>
        <div className="module-actions">
          <div className={`connection-status ${vnaConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-indicator">
              {vnaConnected ? '🟢' : '🔴'}
            </span>
            <span>VNA {vnaConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <button 
            onClick={checkVNAConnection} 
            className="btn btn-secondary"
            disabled={loading}
          >
            🔄 Check VNA
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
                  <label>Product Number</label>
                  <input
                    type="text"
                    value={testData.productNumber}
                    onChange={(e) => handleInputChange('productNumber', e.target.value)}
                    placeholder="Enter product number"
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
                  onClick={runS11S21Test}
                  disabled={!vnaConnected || testInProgress}
                  className="btn btn-primary"
                >
                  {testInProgress ? '🔄 Running S-Param Test...' : '▶️ Run S11/S21 Test'}
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
                <h3>📊 S-Parameter Results</h3>
                <div className="results-grid">
                  <div className="result-item">
                    <label>S21 Bandwidth (GHz):</label>
                    <span className="result-value bandwidth-value">
                      {results.s21Bandwidth || '--'}
                    </span>
                  </div>
                  <div className="result-item">
                    <label>Frequency at -3dB (GHz):</label>
                    <span className="result-value">
                      {results.frequency3db || '--'}
                    </span>
                  </div>
                  <div className="result-item">
                    <label>Ripple Test:</label>
                    <span className={`result-value ${getResultClass(results.rippleResult)}`}>
                      {results.rippleResult || '--'}
                    </span>
                  </div>
                  <div className="result-item highlight">
                    <label>Overall Result:</label>
                    <span className={`result-value ${getResultClass(results.overallResult)}`}>
                      {results.overallResult || '--'}
                    </span>
                  </div>
                </div>

                {results.s21Bandwidth && (
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
              <div className="graphs-section">
                {results.plotImages.sparamPlot && (
                  <div className="card">
                    <h3>📈 S-Parameter Plot</h3>
                    <div className="graph-container">
                      <img 
                        src={results.plotImages.sparamPlot} 
                        alt="S-Parameter plot"
                        className="test-graph"
                      />
                    </div>
                  </div>
                )}

                {results.plotImages.ripplePlot && (
                  <div className="card">
                    <h3>🌊 Ripple Test Plot</h3>
                    <div className="graph-container">
                      <img 
                        src={results.plotImages.ripplePlot} 
                        alt="Ripple test plot"
                        className="test-graph"
                      />
                    </div>
                  </div>
                )}
              </div>
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
                        <span className={`result-badge ${getResultClass(test.overall_result)}`}>
                          {test.overall_result}
                        </span>
                      </div>
                      <div className="history-details">
                        <p><strong>S21 Bandwidth:</strong> {test.s21_bandwidth} GHz</p>
                        <p><strong>Ripple:</strong> {test.ripple_result}</p>
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

      {/* Ripple Test Dialog */}
      {showRippleTest && (
        <div className="modal-overlay">
          <div className="modal-content ripple-dialog">
            <div className="modal-header">
              <h3>🌊 Ripple Test</h3>
            </div>
            <div className="modal-body">
              <p>S-Parameter test completed successfully!</p>
              <p>Do you want to continue with the Ripple test?</p>
              <div className="ripple-results">
                <p><strong>S21 Bandwidth:</strong> {results.s21Bandwidth} GHz</p>
                <p><strong>Frequency at -3dB:</strong> {results.frequency3db} GHz</p>
              </div>
            </div>
            <div className="modal-actions">
              <button 
                onClick={skipRippleTest}
                className="btn btn-secondary"
              >
                Skip Ripple Test
              </button>
              <button 
                onClick={runRippleTest}
                disabled={loading}
                className="btn btn-primary"
              >
                {loading ? '🔄 Running...' : 'Continue with Ripple Test'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && !showRippleTest && (
        <div className="loading-overlay">
          <div className="loading-spinner"></div>
          <p>Running S-Parameter Analysis...</p>
        </div>
      )}
    </div>
  );
};

export default S21TestingApp;