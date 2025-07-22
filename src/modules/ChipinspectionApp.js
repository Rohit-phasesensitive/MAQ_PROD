// src/modules/ChipInspection.js - Chip Inspection Module with Testing Workflow Integration

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './ChipInspection.css';

const API_BASE_URL = 'http://localhost:8000';

const ChipInspection = ({ user, addNotification }) => {
  const [loading, setLoading] = useState(false);
  const [inspections, setInspections] = useState([]);
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const fileInputRef = useRef(null);
  
  // Testing workflow integration
  const [testContext, setTestContext] = useState(null);
  const [isTestMode, setIsTestMode] = useState(false);
  
  const [formData, setFormData] = useState({
    operator: user?.username || '',
    chip_number: '',
    wafer_id: '',
    notes: '',
    status: 'started',
    image_file: null
  });

  const [filters, setFilters] = useState({
    status: 'all',
    operator: 'all',
    date_range: 'today'
  });

  const statusOptions = [
    { value: 'started', label: 'Started', color: '#2196F3' },
    { value: 'in_progress', label: 'In Progress', color: '#FF9800' },
    { value: 'completed', label: 'Completed', color: '#4CAF50' },
    { value: 'failed', label: 'Failed', color: '#F44336' },
    { value: 'on_hold', label: 'On Hold', color: '#9E9E9E' }
  ];

  useEffect(() => {
    // Check if we came from testing workflow
    const storedTestContext = JSON.parse(localStorage.getItem('testContext') || '{}');
    
    if (storedTestContext.returnTo === 'testing-workflow') {
      setTestContext(storedTestContext);
      setIsTestMode(true);
      
      // Pre-fill form with device information if available
      setFormData(prev => ({
        ...prev,
        chip_number: storedTestContext.deviceSerialNumber || '',
        wafer_id: storedTestContext.deviceSerialNumber || '',
        notes: `Test: ${storedTestContext.testName} for device ${storedTestContext.deviceSerialNumber}`
      }));
      
      addNotification(`Starting ${storedTestContext.testName} for device ${storedTestContext.deviceSerialNumber}`, 'info');
    }

    if (showHistory) {
      fetchInspections();
    }
    
    // Set operator name from user context
    setFormData(prev => ({ ...prev, operator: user?.username || '' }));
  }, [user, filters, showHistory]);

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('authToken')}`
  });

  const fetchInspections = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.status !== 'all') params.append('status', filters.status);
      if (filters.operator !== 'all') params.append('operator', filters.operator);
      if (filters.date_range !== 'all') params.append('date_range', filters.date_range);

      const response = await axios.get(`${API_BASE_URL}/modules/chip_inspection/inspections?${params}`, {
        headers: getAuthHeaders()
      });
      setInspections(response.data.inspections || []);
    } catch (error) {
      console.error('Error fetching inspections:', error);
      addNotification('Failed to fetch inspections', 'error');
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      // Validate file type
      const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        addNotification('Please upload a valid image file (JPEG, PNG, GIF, BMP, WebP)', 'error');
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        addNotification('Image file size must be less than 10MB', 'error');
        return;
      }

      setFormData(prev => ({ ...prev, image_file: file }));
      
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);

      addNotification('Image uploaded successfully', 'success');
    }
  };

  const removeImage = () => {
    setFormData(prev => ({ ...prev, image_file: null }));
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    addNotification('Image removed', 'info');
  };

  const validateForm = () => {
    const required = ['operator', 'chip_number', 'wafer_id'];
    const missing = required.filter(field => !formData[field].trim());
    
    if (missing.length > 0) {
      addNotification(`Please fill in: ${missing.join(', ')}`, 'error');
      return false;
    }
    
    return true;
  };

  // Handle test completion for testing workflow
  const handleTestComplete = async () => {
    if (!validateForm()) return;

    setLoading(true);
    
    try {
      // Save the inspection first
      const inspectionData = new FormData();
      inspectionData.append('operator', formData.operator);
      inspectionData.append('chip_number', formData.chip_number);
      inspectionData.append('wafer_id', formData.wafer_id);
      inspectionData.append('notes', formData.notes);
      inspectionData.append('status', 'completed'); // Auto-complete for test mode
      
      if (formData.image_file) {
        inspectionData.append('image', formData.image_file);
      }

      // Save inspection
      await axios.post(`${API_BASE_URL}/modules/chip_inspection/save`, inspectionData, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'multipart/form-data'
        }
      });

      // Complete the test in the manufacturing workflow
      await fetch(`${API_BASE_URL}/api/manufacturing/devices/${testContext.deviceSerialNumber}/tests/${testContext.testId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      
      addNotification(`${testContext.testName} completed successfully!`, 'success');
      
      // Return to testing workflow with success flag
      window.location.href = `/?returnFrom=testModule&testCompleted=true`;
      
    } catch (error) {
      console.error('Error completing test:', error);
      addNotification(error.response?.data?.detail || 'Failed to complete test', 'error');
    }
    setLoading(false);
  };

  // Regular save for non-test mode
  const saveInspection = async () => {
    if (user?.role === 'viewer') {
      addNotification('Viewers cannot save inspections', 'error');
      return;
    }

    if (!validateForm()) return;

    setLoading(true);
    
    try {
      const inspectionData = new FormData();
      inspectionData.append('operator', formData.operator);
      inspectionData.append('chip_number', formData.chip_number);
      inspectionData.append('wafer_id', formData.wafer_id);
      inspectionData.append('notes', formData.notes);
      inspectionData.append('status', formData.status);
      
      if (formData.image_file) {
        inspectionData.append('image', formData.image_file);
      }

      const response = await axios.post(`${API_BASE_URL}/modules/chip_inspection/save`, inspectionData, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'multipart/form-data'
        }
      });

      addNotification('Inspection saved successfully', 'success');
      
      // Reset form
      setFormData({
        operator: user?.username || '',
        chip_number: '',
        wafer_id: '',
        notes: '',
        status: 'started',
        image_file: null
      });
      setImagePreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Refresh history if visible
      if (showHistory) {
        fetchInspections();
      }

    } catch (error) {
      console.error('Save error:', error);
      addNotification(error.response?.data?.detail || 'Failed to save inspection', 'error');
    }
    setLoading(false);
  };

  const updateInspectionStatus = async (inspectionId, newStatus) => {
    if (user?.role === 'viewer') {
      addNotification('Viewers cannot update inspection status', 'error');
      return;
    }

    try {
      await axios.put(`${API_BASE_URL}/modules/chip_inspection/update-status`, {
        inspection_id: inspectionId,
        status: newStatus
      }, {
        headers: getAuthHeaders()
      });

      addNotification('Status updated successfully', 'success');
      fetchInspections(); // Refresh the list

    } catch (error) {
      addNotification('Failed to update status', 'error');
    }
  };

  const viewInspectionDetails = (inspection) => {
    setSelectedInspection(inspection);
  };

  const closeInspectionDetails = () => {
    setSelectedInspection(null);
  };

  const generateReport = async () => {
    try {
      const response = await axios.post(`${API_BASE_URL}/modules/chip_inspection/generate-report`, {
        filters: filters
      }, {
        responseType: 'blob',
        headers: getAuthHeaders()
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `chip_inspection_report_${new Date().toISOString().split('T')[0]}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      addNotification('Report downloaded successfully', 'success');
    } catch (error) {
      addNotification('Failed to generate report', 'error');
    }
  };

  const getStatusColor = (status) => {
    const statusOption = statusOptions.find(opt => opt.value === status);
    return statusOption ? statusOption.color : '#666';
  };

  const getStatusLabel = (status) => {
    const statusOption = statusOptions.find(opt => opt.value === status);
    return statusOption ? statusOption.label : status;
  };

  return (
    <div className="chip_inspection-module">
      {/* Module Header */}
      <div className="module-header">
        <h2>🔍 Chip Preparation</h2>
        <button 
              onClick={() => window.location.href = '/testing-workflow'}
              className="btn btn-secondary btn-sm"
            >
              ← Back to Workflow
            </button>
        {/* Test Context Banner
        {isTestMode && testContext && (
          <div className="test-context-banner">
            <div className="test-info">
              <strong>🧪 Testing Mode:</strong> {testContext.testName} 
              <br />
              <strong>Device:</strong> {testContext.deviceSerialNumber}
            </div>
            <button 
              onClick={() => window.location.href = '/testing-workflow'}
              className="btn btn-secondary btn-sm"
            >
              ← Back to Workflow
            </button>
          </div>
        )} */}
        
        <div className="module-actions">
          {!isTestMode && (
            <>
              <button 
                onClick={() => setShowHistory(!showHistory)} 
                className={`btn ${showHistory ? 'btn-secondary' : 'btn-primary'}`}
              >
                {showHistory ? 'Hide History' : 'Show History'}
              </button>
              {showHistory && (
                <button onClick={generateReport} className="btn btn-success">
                  📊 Generate Report
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="module-content">
        {/* Inspection Form */}
        <div className="card">
          <h3>{isTestMode ? `${testContext?.testName} - Chip Inspection` : 'New Chip Inspection'}</h3>
          <div className="form-grid">
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
              <label>Chip Number *</label>
              <input
                type="text"
                value={formData.chip_number}
                onChange={(e) => handleInputChange('chip_number', e.target.value)}
                placeholder="Enter chip number"
                disabled={user?.role === 'viewer'}
              />
            </div>

            <div className="form-group">
              <label>Wafer ID *</label>
              <input
                type="text"
                value={formData.wafer_id}
                onChange={(e) => handleInputChange('wafer_id', e.target.value)}
                placeholder="Enter wafer ID"
                disabled={user?.role === 'viewer'}
              />
            </div>

            {!isTestMode && (
              <div className="form-group">
                <label>Status *</label>
                <select
                  value={formData.status}
                  onChange={(e) => handleInputChange('status', e.target.value)}
                  disabled={user?.role === 'viewer'}
                  style={{ color: getStatusColor(formData.status) }}
                >
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value} style={{ color: option.color }}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group full-width">
              <label>Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                placeholder="Enter inspection notes, observations, or defects found..."
                rows={4}
                disabled={user?.role === 'viewer'}
              />
            </div>

            {/* Image Upload Section */}
            <div className="form-group full-width">
              <label>Upload Image</label>
              <div className="image-upload-section">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/*"
                  className="file-input"
                  disabled={user?.role === 'viewer'}
                />
                
                {!imagePreview && (
                  <div 
                    className="upload-dropzone"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <div className="upload-icon">📷</div>
                    <p>Click to upload chip image</p>
                    <p className="upload-hint">Supports: JPEG, PNG, GIF, BMP, WebP (Max 10MB)</p>
                  </div>
                )}

                {imagePreview && (
                  <div className="image-preview-container">
                    <img src={imagePreview} alt="Chip preview" className="image-preview" />
                    <div className="image-actions">
                      <button 
                        onClick={() => fileInputRef.current?.click()} 
                        className="btn btn-primary btn-sm"
                        disabled={user?.role === 'viewer'}
                      >
                        Change Image
                      </button>
                      <button 
                        onClick={removeImage} 
                        className="btn btn-danger btn-sm"
                        disabled={user?.role === 'viewer'}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {user?.role !== 'viewer' && (
            <div className="button-group">
              <button 
                onClick={isTestMode ? handleTestComplete : saveInspection} 
                disabled={loading}
                className={`btn ${isTestMode ? 'btn-success' : 'btn-primary'}`}
              >
                {loading ? (
                  'Processing...'
                ) : isTestMode ? (
                  '✅ Complete Test & Return'
                ) : (
                  '💾 Save Inspection'
                )}
              </button>
            </div>
          )}
        </div>

        {/* Inspection History - Hidden in test mode */}
        {showHistory && !isTestMode && (
          <div className="card">
            <div className="history-header">
              <h3>Inspection History</h3>
              
              {/* Filters */}
              <div className="filters">
                <select 
                  value={filters.status} 
                  onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                >
                  <option value="all">All Statuses</option>
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <select 
                  value={filters.date_range} 
                  onChange={(e) => setFilters(prev => ({ ...prev, date_range: e.target.value }))}
                >
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="all">All Time</option>
                </select>
              </div>
            </div>

            <div className="inspection-grid">
              {inspections.length === 0 ? (
                <div className="no-data">
                  <p>No inspections found</p>
                </div>
              ) : (
                inspections.map((inspection) => (
                  <div key={inspection.id} className="inspection-card">
                    <div className="inspection-header">
                      <h4>Chip: {inspection.chip_number}</h4>
                      <span 
                        className="status-badge"
                        style={{ backgroundColor: getStatusColor(inspection.status) }}
                      >
                        {getStatusLabel(inspection.status)}
                      </span>
                    </div>
                    
                    <div className="inspection-details">
                      <p><strong>Wafer ID:</strong> {inspection.wafer_id}</p>
                      <p><strong>Operator:</strong> {inspection.operator}</p>
                      <p><strong>Date:</strong> {new Date(inspection.created_at).toLocaleDateString()}</p>
                      {inspection.notes && (
                        <p><strong>Notes:</strong> {inspection.notes.substring(0, 100)}...</p>
                      )}
                    </div>

                    <div className="inspection-actions">
                      <button 
                        onClick={() => viewInspectionDetails(inspection)}
                        className="btn btn-sm btn-primary"
                      >
                        View Details
                      </button>
                      
                      {user?.role !== 'viewer' && (
                        <select
                          value={inspection.status}
                          onChange={(e) => updateInspectionStatus(inspection.id, e.target.value)}
                          className="status-select"
                        >
                          {statusOptions.map(option => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Inspection Details Modal */}
      {selectedInspection && (
        <div className="modal-overlay" onClick={closeInspectionDetails}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Inspection Details - Chip {selectedInspection.chip_number}</h3>
              <button onClick={closeInspectionDetails} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <label>Chip Number:</label>
                  <span>{selectedInspection.chip_number}</span>
                </div>
                
                <div className="detail-item">
                  <label>Wafer ID:</label>
                  <span>{selectedInspection.wafer_id}</span>
                </div>
                
                <div className="detail-item">
                  <label>Operator:</label>
                  <span>{selectedInspection.operator}</span>
                </div>
                
                <div className="detail-item">
                  <label>Status:</label>
                  <span 
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(selectedInspection.status) }}
                  >
                    {getStatusLabel(selectedInspection.status)}
                  </span>
                </div>
                
                <div className="detail-item">
                  <label>Created:</label>
                  <span>{new Date(selectedInspection.created_at).toLocaleString()}</span>
                </div>
                
                {selectedInspection.updated_at !== selectedInspection.created_at && (
                  <div className="detail-item">
                    <label>Last Updated:</label>
                    <span>{new Date(selectedInspection.updated_at).toLocaleString()}</span>
                  </div>
                )}
                
                {selectedInspection.notes && (
                  <div className="detail-item full-width">
                    <label>Notes:</label>
                    <div className="notes-content">{selectedInspection.notes}</div>
                  </div>
                )}
                
                {selectedInspection.image_path && (
                  <div className="detail-item full-width">
                    <label>Image:</label>
                    <img 
                      src={`${API_BASE_URL}/modules/chip_inspection/image/${selectedInspection.id}`}
                      alt="Chip inspection"
                      className="inspection-image"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChipInspection;