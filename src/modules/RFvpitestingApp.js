// src/modules/RFVPITesting.js - RF VPI Testing Module

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import './RFvpitestingApp.css';

const API_BASE_URL = 'http://localhost:8000';

const RFVPITesting = ({ user, addNotification }) => {
  const [activeTab, setActiveTab] = useState('testing');
  const [loading, setLoading] = useState(false);

  // Device Configuration State
  const [deviceConfig, setDeviceConfig] = useState({
    device_type: 'DUT',
    serial_number: '',
    start_freq: 1000,
    stop_freq: 2000,
    num_points: 101,
    rf_power: -10,
    sweep_time: 1.0,
    operator: user?.username || 'Unknown'
  });

  // Test State
  const [testResults, setTestResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Ready');
  const [logs, setLogs] = useState([]);

  // Data State
  const [rfPowerData, setRfPowerData] = useState([]);
  const [testHistory, setTestHistory] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState(['DUT', 'Cable', 'Amplifier', 'Filter', 'Modulator']);
  
  // Demo mode for development
  const [demoMode, setDemoMode] = useState(true);

  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'operator') {
      fetchTestHistory();
      if (demoMode) {
        initializeDemoData();
      }
    }
  }, [user, demoMode]);

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('authToken')}`
  });

  const fetchTestHistory = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/modules/rf-vpi/history`, {
        headers: getAuthHeaders()
      });
      setTestHistory(response.data.tests || []);
    } catch (error) {
      console.error('Error fetching test history:', error);
      addNotification('Failed to fetch test history', 'error');
    }
  };

  const initializeDemoData = () => {
    setRfPowerData([
      { time: '10:00', power: -12.5, frequency: 1500 },
      { time: '10:01', power: -11.8, frequency: 1520 },
      { time: '10:02', power: -12.1, frequency: 1480 },
      { time: '10:03', power: -11.9, frequency: 1510 },
      { time: '10:04', power: -12.3, frequency: 1490 }
    ]);

    
  };

  const recordRFPower = async () => {
    try {
      setLoading(true);
      
      if (demoMode) {
        const newReading = {
          time: new Date().toLocaleTimeString(),
          power: (-12 + Math.random() * 2).toFixed(1),
          frequency: deviceConfig.start_freq + Math.random() * (deviceConfig.stop_freq - deviceConfig.start_freq)
        };
        setRfPowerData(prev => [...prev.slice(-9), newReading]);
        addLog(`RF Power recorded: ${newReading.power} dBm at ${newReading.frequency.toFixed(0)} MHz`);
        addNotification('RF Power recorded successfully', 'success');
        setLoading(false);
        return;
      }

      const response = await axios.post(`${API_BASE_URL}/modules/rf-vpi/record-power`, deviceConfig, {
        headers: getAuthHeaders()
      });
      
      const data = response.data;
      setRfPowerData(prev => [...prev.slice(-9), data]);
      addLog(`RF Power recorded: ${data.power} dBm`);
      addNotification('RF Power recorded successfully', 'success');
    } catch (error) {
      addLog(`Error recording RF power: ${error.message}`, 'error');
      addNotification('Failed to record RF power', 'error');
    } finally {
      setLoading(false);
    }
  };

  const startSweep = async () => {
    if (!deviceConfig.serial_number.trim()) {
      addNotification('Please enter a serial number', 'error');
      return;
    }

    try {
      setIsRunning(true);
      setProgress(0);
      setStatus('Running Sweep...');
      addLog('Starting VPI sweep test');

      if (demoMode) {
        // Simulate sweep test with progress updates
        for (let i = 0; i <= 100; i += 10) {
          setProgress(i);
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Generate demo results
        const frequencies = [];
        const vpiData = [];
        const rfPowerResults = [];

        for (let i = 0; i <= deviceConfig.num_points; i++) {
          const freq = deviceConfig.start_freq + (i / deviceConfig.num_points) * (deviceConfig.stop_freq - deviceConfig.start_freq);
          const vpi = 2.5 + 0.5 * Math.sin(freq / 100) + Math.random() * 0.2;
          const power = deviceConfig.rf_power + Math.random() * 2 - 1;
          
          frequencies.push(freq);
          vpiData.push(vpi);
          rfPowerResults.push(power);
        }

        const avgVpi = vpiData.reduce((a, b) => a + b, 0) / vpiData.length;
        const results = {
          frequencies,
          vpi_values: vpiData,
          rf_power_values: rfPowerResults,
          test_config: deviceConfig,
          timestamp: new Date().toISOString(),
          summary: {
            avg_vpi: avgVpi,
            max_vpi: Math.max(...vpiData),
            min_vpi: Math.min(...vpiData),
            test_passed: avgVpi >= 2.0 && avgVpi <= 3.0
          }
        };

        setTestResults(results);
        setStatus('Test Completed');
        addLog('VPI sweep test completed successfully');
        addNotification('VPI sweep test completed', 'success');
        
        // Add to history
        const newHistoryItem = {
          id: testHistory.length + 1,
          serial_number: deviceConfig.serial_number,
          device_type: deviceConfig.device_type,
          test_date: new Date().toISOString(),
          status: results.summary.test_passed ? 'passed' : 'failed',
          avg_vpi: avgVpi,
          operator: deviceConfig.operator
        };
        setTestHistory(prev => [newHistoryItem, ...prev]);

        setIsRunning(false);
        return;
      }

      const response = await axios.post(`${API_BASE_URL}/modules/rf-vpi/start-sweep`, deviceConfig, {
        headers: getAuthHeaders()
      });

      const results = response.data;
      setTestResults(results);
      setStatus('Test Completed');
      addLog('VPI sweep test completed');
      addNotification('VPI sweep test completed', 'success');
      fetchTestHistory();
    } catch (error) {
      addLog(`Error during sweep: ${error.message}`, 'error');
      addNotification('Failed to complete VPI sweep', 'error');
      setStatus('Error');
    } finally {
      setIsRunning(false);
    }
  };

  const stopTest = () => {
    setIsRunning(false);
    setStatus('Stopped');
    addLog('Test stopped by user');
    addNotification('Test stopped', 'warning');
  };

  const resetSystem = () => {
    setTestResults(null);
    setProgress(0);
    setStatus('Ready');
    setRfPowerData([]);
    setLogs([]);
    setDeviceConfig({
      ...deviceConfig,
      serial_number: '',
      start_freq: 1000,
      stop_freq: 2000,
      num_points: 101,
      rf_power: -10,
      sweep_time: 1.0
    });
    addLog('System reset');
    addNotification('System reset', 'info');
  };

  const downloadResults = () => {
    if (!testResults) return;
    
    const dataStr = JSON.stringify(testResults, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rfvpi_${deviceConfig.serial_number}_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    addLog('Results downloaded');
    addNotification('Results downloaded', 'success');
  };

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-9), { timestamp, message, type }]);
  };

  const getStatusColor = (status) => {
    const colors = {
      'Ready': '#4CAF50',
      'Running Sweep...': '#FF9800',
      'Test Completed': '#2196F3',
      'Stopped': '#9E9E9E',
      'Error': '#F44336'
    };
    return colors[status] || '#666';
  };

  // Chart data preparation
  const chartData = testResults ? 
    testResults.frequencies.map((freq, i) => ({
      frequency: freq.toFixed(0),
      vpi: testResults.vpi_values[i].toFixed(3),
      rf_power: testResults.rf_power_values[i].toFixed(1)
    })) : [];

  if (user?.role === 'viewer') {
    return (
      <div className="rf-vpi-module">
        <div className="access-denied">
          <h2>🔒 Limited Access</h2>
          <p>Viewers can only view test results. Testing functions require operator or admin access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rf-vpi-module">
      {/* Module Header */}
      <div className="module-header">
        <h2>⚡ RF VPI Testing System</h2>
        <div className="module-actions">
          <div className={`status-indicator`} style={{ backgroundColor: getStatusColor(status) }}>
            {status}
          </div>
          <button 
            onClick={() => setDemoMode(!demoMode)}
            className={`btn ${demoMode ? 'btn-warning' : 'btn-secondary'}`}
          >
            {demoMode ? 'Demo Mode' : 'Live Mode'}
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button 
          className={`tab-btn ${activeTab === 'testing' ? 'active' : ''}`}
          onClick={() => setActiveTab('testing')}
        >
          🧪 Testing
        </button>
        <button 
          className={`tab-btn ${activeTab === 'results' ? 'active' : ''}`}
          onClick={() => setActiveTab('results')}
        >
          📊 Results
        </button>
        <button 
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          📋 History
        </button>
      </div>

      <div className="module-content">
        {/* Testing Tab */}
        {activeTab === 'testing' && (
          <div className="testing-tab">
            <div className="testing-layout">
              {/* Left Column - Controls */}
              <div className="controls-column">
                {/* Device Configuration */}
                <div className="config-card">
                  <h3>🔧 Device Configuration</h3>
                  
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Serial Number *</label>
                      <input
                        type="text"
                        value={deviceConfig.serial_number}
                        onChange={(e) => setDeviceConfig({...deviceConfig, serial_number: e.target.value})}
                        placeholder="Enter device serial number"
                      />
                    </div>

                    <div className="form-group">
                      <label>Device Type</label>
                      <select
                        value={deviceConfig.device_type}
                        onChange={(e) => setDeviceConfig({...deviceConfig, device_type: e.target.value})}
                      >
                        {deviceTypes.map(type => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Start Frequency (MHz)</label>
                      <input
                        type="number"
                        value={deviceConfig.start_freq}
                        onChange={(e) => setDeviceConfig({...deviceConfig, start_freq: Number(e.target.value)})}
                      />
                    </div>

                    <div className="form-group">
                      <label>Stop Frequency (MHz)</label>
                      <input
                        type="number"
                        value={deviceConfig.stop_freq}
                        onChange={(e) => setDeviceConfig({...deviceConfig, stop_freq: Number(e.target.value)})}
                      />
                    </div>

                    <div className="form-group">
                      <label>Number of Points</label>
                      <input
                        type="number"
                        value={deviceConfig.num_points}
                        onChange={(e) => setDeviceConfig({...deviceConfig, num_points: Number(e.target.value)})}
                        min="10"
                        max="1000"
                      />
                    </div>

                    <div className="form-group">
                      <label>RF Power (dBm)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={deviceConfig.rf_power}
                        onChange={(e) => setDeviceConfig({...deviceConfig, rf_power: Number(e.target.value)})}
                      />
                    </div>

                    <div className="form-group">
                      <label>Sweep Time (seconds)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={deviceConfig.sweep_time}
                        onChange={(e) => setDeviceConfig({...deviceConfig, sweep_time: Number(e.target.value)})}
                        min="0.1"
                        max="60"
                      />
                    </div>

                    <div className="form-group">
                      <label>Operator</label>
                      <input
                        type="text"
                        value={deviceConfig.operator}
                        onChange={(e) => setDeviceConfig({...deviceConfig, operator: e.target.value})}
                        placeholder="Operator name"
                      />
                    </div>
                  </div>
                </div>

                {/* Control Buttons */}
                <div className="control-card">
                  <h3>🎮 Test Controls</h3>
                  
                  <div className="control-buttons">
                    <button
                      onClick={recordRFPower}
                      className="btn btn-success"
                      disabled={loading || isRunning}
                    >
                      📡 Record RF Power
                    </button>

                    <button
                      onClick={startSweep}
                      disabled={isRunning || loading}
                      className="btn btn-primary"
                    >
                      ▶️ Start VPI Sweep
                    </button>

                    <button
                      onClick={stopTest}
                      disabled={!isRunning}
                      className="btn btn-danger"
                    >
                      ⏹️ Stop Test
                    </button>

                    <div className="button-row">
                      <button
                        onClick={resetSystem}
                        className="btn btn-secondary"
                        disabled={isRunning}
                      >
                        🔄 Reset
                      </button>

                      <button
                        onClick={downloadResults}
                        disabled={!testResults}
                        className="btn btn-purple"
                      >
                        💾 Export
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {isRunning && (
                    <div className="progress-section">
                      <div className="progress-header">
                        <span>Progress</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="progress-bar">
                        <div 
                          className="progress-fill"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* System Logs */}
                <div className="logs-card">
                  <h3>📝 System Logs</h3>
                  <div className="logs-container">
                    {logs.map((log, index) => (
                      <div key={index} className={`log-entry ${log.type}`}>
                        <span className="log-time">[{log.timestamp}]</span>
                        <span className="log-message">{log.message}</span>
                      </div>
                    ))}
                    {logs.length === 0 && (
                      <div className="no-logs">No logs yet...</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column - Charts */}
              <div className="charts-column">
                {/* RF Power Monitor */}
                <div className="chart-card">
                  <h3>📈 RF Power Monitor</h3>
                  <div className="chart-container">
                    {rfPowerData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={rfPowerData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="time" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Line 
                            type="monotone" 
                            dataKey="power" 
                            stroke="#10b981" 
                            strokeWidth={2}
                            dot={{ fill: '#10b981' }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="no-data">
                        <p>No RF power data available</p>
                        <small>Click "Record RF Power" to start monitoring</small>
                      </div>
                    )}
                  </div>
                </div>

                {/* Placeholder for live data */}
                <div className="info-card">
                  <h3>ℹ️ Test Information</h3>
                  <div className="info-content">
                    <div className="info-item">
                      <span className="info-label">Current Device:</span>
                      <span className="info-value">{deviceConfig.serial_number || 'Not set'}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Device Type:</span>
                      <span className="info-value">{deviceConfig.device_type}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Frequency Range:</span>
                      <span className="info-value">{deviceConfig.start_freq} - {deviceConfig.stop_freq} MHz</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Test Points:</span>
                      <span className="info-value">{deviceConfig.num_points}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">RF Power:</span>
                      <span className="info-value">{deviceConfig.rf_power} dBm</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results Tab */}
        {activeTab === 'results' && (
          <div className="results-tab">
            {testResults ? (
              <>
                {/* Summary Cards */}
                <div className="summary-cards">
                  <div className="summary-card">
                    <div className="summary-icon">✅</div>
                    <div className="summary-content">
                      <div className="summary-label">Average VPI</div>
                      <div className="summary-value">{testResults.summary.avg_vpi.toFixed(3)}V</div>
                    </div>
                  </div>

                  <div className="summary-card">
                    <div className="summary-icon">📈</div>
                    <div className="summary-content">
                      <div className="summary-label">Maximum VPI</div>
                      <div className="summary-value">{testResults.summary.max_vpi.toFixed(3)}V</div>
                    </div>
                  </div>

                  <div className="summary-card">
                    <div className="summary-icon">📉</div>
                    <div className="summary-content">
                      <div className="summary-label">Minimum VPI</div>
                      <div className="summary-value">{testResults.summary.min_vpi.toFixed(3)}V</div>
                    </div>
                  </div>

                  <div className="summary-card">
                    <div className={`summary-icon ${testResults.summary.test_passed ? 'pass' : 'fail'}`}>
                      {testResults.summary.test_passed ? '✅' : '❌'}
                    </div>
                    <div className="summary-content">
                      <div className="summary-label">Test Status</div>
                      <div className={`summary-value ${testResults.summary.test_passed ? 'pass' : 'fail'}`}>
                        {testResults.summary.test_passed ? 'PASS' : 'FAIL'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Charts */}
                <div className="results-charts">
                  <div className="chart-card large">
                    <h3>VPI vs Frequency</h3>
                    <div className="chart-container large">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis 
                            dataKey="frequency" 
                            label={{ value: 'Frequency (MHz)', position: 'insideBottom', offset: -10 }}
                          />
                          <YAxis 
                            label={{ value: 'VPI (V)', angle: -90, position: 'insideLeft' }}
                          />
                          <Tooltip 
                            formatter={(value) => [`${value}V`, 'VPI']}
                          />
                          <Legend />
                          <Line 
                            type="monotone" 
                            dataKey="vpi" 
                            stroke="#3b82f6" 
                            strokeWidth={2}
                            dot={{ fill: '#3b82f6', strokeWidth: 0 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="chart-card large">
                    <h3>RF Power vs Frequency</h3>
                    <div className="chart-container large">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData.filter((_, i) => i % 5 === 0)}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis 
                            dataKey="frequency" 
                            label={{ value: 'Frequency (MHz)', position: 'insideBottom', offset: -10 }}
                          />
                          <YAxis 
                            label={{ value: 'RF Power (dBm)', angle: -90, position: 'insideLeft' }}
                          />
                          <Tooltip formatter={(value) => [`${value}dBm`, 'RF Power']} />
                          <Legend />
                          <Bar 
                            dataKey="rf_power" 
                            fill="#10b981"
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="no-data-state">
                <div className="no-data-icon">⚡</div>
                <h3>No Test Results</h3>
                <p>Configure your device settings and start a VPI sweep to see results here.</p>
                <button 
                  onClick={() => setActiveTab('testing')}
                  className="btn btn-primary"
                >
                  Start Testing
                </button>
              </div>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="history-tab">
            <div className="history-header">
              <h3>Test History</h3>
              <button 
                onClick={fetchTestHistory}
                className="btn btn-secondary btn-sm"
                disabled={loading}
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
                testHistory.map((test) => (
                  <div key={test.id} className="history-card">
                    <div className="history-header-row">
                      <h4>{test.serial_number}</h4>
                      <div className="history-badges">
                        <span 
                          className="status-badge"
                          style={{ backgroundColor: test.status === 'passed' ? '#4CAF50' : '#F44336' }}
                        >
                          {test.status.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <div className="history-details">
                      <div className="detail-row">
                        <span className="label">Device Type:</span>
                        <span className="value">{test.device_type}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Test Date:</span>
                        <span className="value">{new Date(test.test_date).toLocaleString()}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Average VPI:</span>
                        <span className="value">{test.avg_vpi.toFixed(3)}V</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Operator:</span>
                        <span className="value">{test.operator}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RFVPITesting;