import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const API_BASE_URL = 'http://localhost:8000';

const S11TestingApp = ({ user, addNotification }) => {
  const [vnaConnected, setVnaConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testData, setTestData] = useState(null);
  const [formData, setFormData] = useState({
    device_type: '',
    chips_no: '',
    housing_sno: '',
    housing_lno: '',
    operator: user?.username || ''
  });
  const [limits, setLimits] = useState([]);

  useEffect(() => {
    checkVnaStatus();
    // Set operator name from user context
    setFormData(prev => ({ ...prev, operator: user?.username || '' }));
  }, [user]);

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('authToken')}`
  });

  const checkVnaStatus = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/modules/s11/vna/status`, {
        headers: getAuthHeaders()
      });
      setVnaConnected(response.data.connected);
    } catch (error) {
      console.error('Error checking VNA status:', error);
      setVnaConnected(false);
    }
  };

  const connectVna = async () => {
    if (user?.role === 'viewer') {
      addNotification('Viewers cannot connect to VNA', 'error');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/modules/s11/vna/connect`, {}, {
        headers: getAuthHeaders()
      });
      setVnaConnected(response.data.connected);
      addNotification(
        response.data.success ? 'VNA connected successfully' : 'Failed to connect to VNA',
        response.data.success ? 'success' : 'error'
      );
    } catch (error) {
      addNotification('Error connecting to VNA', 'error');
    }
    setLoading(false);
  };

  const fetchLimits = async (deviceType) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/modules/s11/limits/${deviceType}`, {
        headers: getAuthHeaders()
      });
      setLimits(response.data.limits);
    } catch (error) {
      console.error('Error fetching limits:', error);
      setLimits([]);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    if (field === 'device_type' && value.trim()) {
      fetchLimits(value.trim());
    }
  };

  const validateForm = () => {
    const required = ['device_type', 'chips_no', 'housing_sno', 'housing_lno', 'operator'];
    return required.every(field => formData[field].trim());
  };

  const startTest = async () => {
    if (user?.role === 'viewer') {
      addNotification('Viewers cannot run tests', 'error');
      return;
    }

    if (!validateForm()) {
      addNotification('Please fill in all required fields', 'error');
      return;
    }

    if (!vnaConnected) {
      addNotification('VNA is not connected', 'error');
      return;
    }

    setLoading(true);
    addNotification('Starting S11 test...', 'info');
    
    try {
      const response = await axios.post(`${API_BASE_URL}/modules/s11/test/start`, formData, {
        headers: getAuthHeaders()
      });
      setTestData(response.data);
      addNotification(
        `S11 test completed: ${response.data.result}`, 
        response.data.result === 'PASS' ? 'success' : 'error'
      );
    } catch (error) {
      addNotification(error.response?.data?.detail || 'Test failed', 'error');
    }
    setLoading(false);
  };

  const saveResults = async () => {
    if (!testData) return;

    setLoading(true);
    try {
      await axios.post(`${API_BASE_URL}/modules/s11/test/save`, testData, {
        headers: getAuthHeaders()
      });
      addNotification('Test results saved to database', 'success');
    } catch (error) {
      addNotification('Failed to save test results', 'error');
    }
    setLoading(false);
  };

  const generatePdf = async () => {
    if (!testData) return;

    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/modules/s11/pdf/generate`, testData, {
        responseType: 'blob',
        headers: getAuthHeaders()
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `S11_test_report_${testData.test_id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      addNotification('PDF report downloaded', 'success');
    } catch (error) {
      addNotification('Failed to generate PDF report', 'error');
    }
    setLoading(false);
  };

  const prepareChartData = () => {
    if (!testData || !testData.frequency_data || !testData.magnitude_data) return [];
    
    return testData.frequency_data.map((freq, index) => ({
      frequency: (freq / 1e9).toFixed(2),
      magnitude: testData.magnitude_data[index]?.toFixed(2) || 0,
      freqNum: freq / 1e9
    }));
  };

  return (
    <div className="s11-testing-module">
      {/* Module Header */}
      <div className="module-header">
        <h2>📡 S11 Parameter Testing</h2>
        <div className="module-status">
          <span className={`status-badge ${vnaConnected ? 'connected' : 'disconnected'}`}>
            VNA {vnaConnected ? 'Connected' : 'Disconnected'}
          </span>
          {!vnaConnected && user?.role !== 'viewer' && (
            <button onClick={connectVna} disabled={loading} className="btn btn-primary">
              Connect VNA
            </button>
          )}
        </div>
      </div>

      <div className="module-content">
        {/* Test Configuration */}
        <div className="card">
          <h3>Test Configuration</h3>
          <div className="form-grid">
            <div className="form-group">
              <label>Device Type *</label>
              <input
                type="text"
                value={formData.device_type}
                onChange={(e) => handleInputChange('device_type', e.target.value)}
                placeholder="Enter device type"
                disabled={user?.role === 'viewer'}
              />
            </div>
            <div className="form-group">
              <label>Operator *</label>
              <input
                type="text"
                value={formData.operator}
                onChange={(e) => handleInputChange('operator', e.target.value)}
                placeholder="Operator name"
                disabled={true} // Auto-filled from user context
              />
            </div>
            <div className="form-group">
              <label>Chip Serial Number *</label>
              <input
                type="text"
                value={formData.chips_no}
                onChange={(e) => handleInputChange('chips_no', e.target.value)}
                placeholder="Enter chip S/N"
                disabled={user?.role === 'viewer'}
              />
            </div>
            <div className="form-group">
              <label>Housing Serial Number *</label>
              <input
                type="text"
                value={formData.housing_sno}
                onChange={(e) => handleInputChange('housing_sno', e.target.value)}
                placeholder="Enter housing S/N"
                disabled={user?.role === 'viewer'}
              />
            </div>
            <div className="form-group full-width">
              <label>Housing Lot Number *</label>
              <input
                type="text"
                value={formData.housing_lno}
                onChange={(e) => handleInputChange('housing_lno', e.target.value)}
                placeholder="Enter housing lot number"
                disabled={user?.role === 'viewer'}
              />
            </div>
          </div>

          {user?.role !== 'viewer' && (
            <div className="button-group">
              <button 
                onClick={startTest} 
                disabled={loading || !vnaConnected}
                className="btn btn-primary"
              >
                {loading ? 'Running Test...' : 'Start S11 Test'}
              </button>
            </div>
          )}

          {loading && (
            <div className="progress-container">
              <div className="progress-bar">
                <div className="progress-fill"></div>
              </div>
              <p>Running S11 measurement...</p>
            </div>
          )}
        </div>

        {/* Test Results */}
        {testData && (
          <div className="card">
            <div className="result-header">
              <h3>Test Results</h3>
              <span className={`result-badge ${testData.result === 'PASS' ? 'pass' : 'fail'}`}>
                {testData.result}
              </span>
            </div>
            
            <div className="result-details">
              <div><strong>Device Type:</strong> {testData.device_type}</div>
              <div><strong>Chip S/N:</strong> {testData.chips_no}</div>
              <div><strong>Housing S/N:</strong> {testData.housing_sno}</div>
              <div><strong>Housing LN:</strong> {testData.housing_lno}</div>
              <div><strong>Operator:</strong> {testData.operator}</div>
              <div><strong>Timestamp:</strong> {testData.timestamp}</div>
            </div>
            
            <div className="button-group">
              <button onClick={saveResults} disabled={loading} className="btn btn-primary">
                Save to Database
              </button>
              <button onClick={generatePdf} disabled={loading} className="btn btn-secondary">
                Generate PDF Report
              </button>
            </div>
          </div>
        )}

        {/* Chart */}
        {testData && (
          <div className="card">
            <h3>S11 Measurement Chart</h3>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={prepareChartData()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="frequency" 
                    label={{ value: 'Frequency (GHz)', position: 'insideBottom', offset: -5 }}
                  />
                  <YAxis 
                    label={{ value: 'Magnitude (dB)', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip 
                    formatter={(value, name) => [value + ' dB', 'S11 Magnitude']}
                    labelFormatter={(label) => `Frequency: ${label} GHz`}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="magnitude" 
                    stroke="#667eea" 
                    strokeWidth={2}
                    dot={false}
                    name="S11 Measurement"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Limits Display */}
        {limits.length > 0 && (
          <div className="card">
            <h3>Test Limits - {formData.device_type}</h3>
            <div className="table-container">
              <table className="limits-table">
                <thead>
                  <tr>
                    <th>Start Freq (GHz)</th>
                    <th>Stop Freq (GHz)</th>
                    <th>S11 Min (dB)</th>
                    <th>S11 Max (dB)</th>
                  </tr>
                </thead>
                <tbody>
                  {limits.map((limit, index) => (
                    <tr key={index}>
                      <td>{limit.start_freq}</td>
                      <td>{limit.stop_freq}</td>
                      <td>{limit.s11_min}</td>
                      <td>{limit.s11_max}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default S11TestingApp;