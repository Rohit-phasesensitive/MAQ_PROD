// src/modules/Housingprep.js - Housing Preparation Workflow Module

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './Housingprep.css';

const API_BASE_URL = 'http://localhost:8000';

const Housingprep = ({ user, addNotification }) => {
  const [loading, setLoading] = useState(false);
  const [inspections, setInspections] = useState([]);
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [imagePreview, setImagePreview] = useState({});
  const [showHistory, setShowHistory] = useState(false);
  const [currentSection, setCurrentSection] = useState('prepare');
  const [epoxyCureTimer, setEpoxyCureTimer] = useState(null);
  const [epoxyCureStartTime, setEpoxyCureStartTime] = useState(null);
  const [epoxyTimeRemaining, setEpoxyTimeRemaining] = useState(0);
  const fileInputRefs = useRef({});
  
  const [formData, setFormData] = useState({
    operator: user?.username || '',
    Housing_number: '',
    Housing_serial: '',
    
    // Prepare Housing Section
    prepare_housing: {
      notes: '',
      status: 'not_started',
      image_file: null,
      completed_at: null
    },
    
    // Mount Transition and Router Chip Section
    mount_chip: {
      transition_chip_serial: '',
      router_chip_serial: '',
      notes: '',
      status: 'not_started',
      image_file: null,
      completed_at: null
    },
    
    // Housing Pin Epoxy Section
    pin_epoxy: {
      epoxy_batch_number: '',
      epoxy_type: '',
      application_method: 'manual',
      notes: '',
      status: 'not_started',
      image_file: null,
      completed_at: null
    },
    
    // Epoxy Cure Section
    epoxy_cure: {
      cure_temperature: '',
      cure_pressure: '',
      cure_status: 'not_started', // not_started, running, paused, completed, cancelled
      cure_start_time: null,
      cure_duration: 10800, // 3 hours in seconds
      cure_remaining: 10800,
      notes: '',
      completed_at: null
    },
    
    overall_status: 'started'
  });

  const [filters, setFilters] = useState({
    status: 'all',
    operator: 'all',
    date_range: 'today'
  });

  const sections = [
    { id: 'prepare', label: 'Prepare Housing', icon: '' },
    { id: 'mount', label: 'Mount Chips', icon: '' },
    { id: 'epoxy', label: 'Pin Epoxy', icon: '' },
    { id: 'cure', label: 'Epoxy Cure', icon: '' }
  ];

  const statusOptions = [
    { value: 'not_started', label: 'Not Started', color: '#9E9E9E' },
    { value: 'in_progress', label: 'In Progress', color: '#FF9800' },
    { value: 'completed', label: 'Completed', color: '#4CAF50' },
    { value: 'failed', label: 'Failed', color: '#F44336' },
    { value: 'on_hold', label: 'On Hold', color: '#9C27B0' }
  ];

  const cureStatusOptions = [
    { value: 'not_started', label: 'Not Started', color: '#9E9E9E' },
    { value: 'running', label: 'Running', color: '#4CAF50' },
    { value: 'paused', label: 'Paused', color: '#FF9800' },
    { value: 'completed', label: 'Completed', color: '#2196F3' },
    { value: 'cancelled', label: 'Cancelled', color: '#F44336' }
  ];

  // Timer effect for epoxy cure
  useEffect(() => {
    let interval = null;
    
    if (formData.epoxy_cure.cure_status === 'running' && formData.epoxy_cure.cure_start_time) {
      interval = setInterval(() => {
        const now = new Date().getTime();
        const startTime = new Date(formData.epoxy_cure.cure_start_time).getTime();
        const elapsed = Math.floor((now - startTime) / 1000);
        const remaining = Math.max(0, formData.epoxy_cure.cure_duration - elapsed);
        
        setEpoxyTimeRemaining(remaining);
        
        // Check if cure is complete
        if (remaining === 0 && formData.epoxy_cure.cure_status === 'running') {
          handleEpoxyCureComplete();
        }
      }, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [formData.epoxy_cure.cure_status, formData.epoxy_cure.cure_start_time]);

  useEffect(() => {
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

      const response = await axios.get(`${API_BASE_URL}/modules/housing-prep/inspections?${params}`, {
        headers: getAuthHeaders()
      });
      setInspections(response.data.inspections || []);
    } catch (error) {
      console.error('Error fetching inspections:', error);
      addNotification('Failed to fetch inspections', 'error');
    }
  };

  const handleInputChange = (section, field, value) => {
    if (section) {
      setFormData(prev => ({
        ...prev,
        [section]: {
          ...prev[section],
          [field]: value
        }
      }));
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
    }
  };

  const handleImageUpload = (section, event) => {
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

      setFormData(prev => ({
        ...prev,
        [section]: {
          ...prev[section],
          image_file: file
        }
      }));
      
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(prev => ({ ...prev, [section]: reader.result }));
      };
      reader.readAsDataURL(file);

      addNotification('Image uploaded successfully', 'success');
    }
  };

  const removeImage = (section) => {
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        image_file: null
      }
    }));
    setImagePreview(prev => ({ ...prev, [section]: null }));
    if (fileInputRefs.current[section]) {
      fileInputRefs.current[section].value = '';
    }
    addNotification('Image removed', 'info');
  };

  const markSectionComplete = (section) => {
    if (user?.role === 'viewer') {
      addNotification('Viewers cannot mark sections complete', 'error');
      return;
    }

    const now = new Date().toISOString();
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        status: 'completed',
        completed_at: now
      }
    }));
    addNotification(`${sections.find(s => s.id === section)?.label} marked as complete`, 'success');
  };

  const startEpoxyCure = () => {
    if (user?.role === 'viewer') {
      addNotification('Viewers cannot start epoxy cure', 'error');
      return;
    }

    const now = new Date().toISOString();
    setFormData(prev => ({
      ...prev,
      epoxy_cure: {
        ...prev.epoxy_cure,
        cure_status: 'running',
        cure_start_time: now,
        cure_remaining: prev.epoxy_cure.cure_duration
      }
    }));
    setEpoxyCureStartTime(now);
    addNotification('Epoxy cure started - 3 hour timer activated', 'success');
  };

  const pauseEpoxyCure = () => {
    if (user?.role === 'viewer') return;

    setFormData(prev => ({
      ...prev,
      epoxy_cure: {
        ...prev.epoxy_cure,
        cure_status: 'paused'
      }
    }));
    addNotification('Epoxy cure paused', 'info');
  };

  const resumeEpoxyCure = () => {
    if (user?.role === 'viewer') return;

    setFormData(prev => ({
      ...prev,
      epoxy_cure: {
        ...prev.epoxy_cure,
        cure_status: 'running'
      }
    }));
    addNotification('Epoxy cure resumed', 'success');
  };

  const cancelEpoxyCure = () => {
    if (user?.role === 'viewer') return;

    setFormData(prev => ({
      ...prev,
      epoxy_cure: {
        ...prev.epoxy_cure,
        cure_status: 'cancelled',
        cure_remaining: prev.epoxy_cure.cure_duration
      }
    }));
    setEpoxyCureStartTime(null);
    addNotification('Epoxy cure cancelled', 'warning');
  };

  const handleEpoxyCureComplete = () => {
    const now = new Date().toISOString();
    setFormData(prev => ({
      ...prev,
      epoxy_cure: {
        ...prev.epoxy_cure,
        cure_status: 'completed',
        completed_at: now,
        cure_remaining: 0
      }
    }));
    
    // TODO: Send email notification to user
    // This can be implemented later as requested
    addNotification('🎉 Epoxy cure completed! Email notification will be sent.', 'success');
  };

  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const validateForm = () => {
    const required = ['operator', 'Housing_number', 'Housing_serial'];
    const missing = required.filter(field => !formData[field]?.trim?.());
    
    if (missing.length > 0) {
      addNotification(`Please fill in: ${missing.join(', ')}`, 'error');
      return false;
    }
    
    return true;
  };

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
      inspectionData.append('Housing_number', formData.Housing_number);
      inspectionData.append('Housing_serial', formData.Housing_serial);
      inspectionData.append('overall_status', formData.overall_status);
      
      // Add section data
      inspectionData.append('prepare_housing', JSON.stringify(formData.prepare_housing));
      inspectionData.append('mount_chip', JSON.stringify(formData.mount_chip));
      inspectionData.append('pin_epoxy', JSON.stringify(formData.pin_epoxy));
      inspectionData.append('epoxy_cure', JSON.stringify(formData.epoxy_cure));
      
      // Add images
      if (formData.prepare_housing.image_file) {
        inspectionData.append('prepare_housing_image', formData.prepare_housing.image_file);
      }
      if (formData.mount_chip.image_file) {
        inspectionData.append('mount_chip_image', formData.mount_chip.image_file);
      }
      if (formData.pin_epoxy.image_file) {
        inspectionData.append('pin_epoxy_image', formData.pin_epoxy.image_file);
      }

      const response = await axios.post(`${API_BASE_URL}/modules/housing-prep/save`, inspectionData, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'multipart/form-data'
        }
      });

      addNotification('Housing preparation saved successfully', 'success');
      
      // Reset form
      setFormData({
        operator: user?.username || '',
        Housing_number: '',
        Housing_serial: '',
        prepare_housing: {
          notes: '',
          status: 'not_started',
          image_file: null,
          completed_at: null
        },
        mount_chip: {
          transition_chip_serial: '',
          router_chip_serial: '',
          notes: '',
          status: 'not_started',
          image_file: null,
          completed_at: null
        },
        pin_epoxy: {
          epoxy_batch_number: '',
          epoxy_type: '',
          application_method: 'manual',
          notes: '',
          status: 'not_started',
          image_file: null,
          completed_at: null
        },
        epoxy_cure: {
          cure_temperature: '',
          cure_pressure: '',
          cure_status: 'not_started',
          cure_start_time: null,
          cure_duration: 10800,
          cure_remaining: 10800,
          notes: '',
          completed_at: null
        },
        overall_status: 'started'
      });
      setImagePreview({});
      
      // Reset file inputs
      Object.keys(fileInputRefs.current).forEach(key => {
        if (fileInputRefs.current[key]) {
          fileInputRefs.current[key].value = '';
        }
      });

      // Refresh history if visible
      if (showHistory) {
        fetchInspections();
      }

    } catch (error) {
      console.error('Save error:', error);
      addNotification(error.response?.data?.detail || 'Failed to save housing preparation', 'error');
    }
    setLoading(false);
  };

  const getStatusColor = (status) => {
    const statusOption = statusOptions.find(opt => opt.value === status) || 
                        cureStatusOptions.find(opt => opt.value === status);
    return statusOption ? statusOption.color : '#666';
  };

  const getStatusLabel = (status) => {
    const statusOption = statusOptions.find(opt => opt.value === status) || 
                        cureStatusOptions.find(opt => opt.value === status);
    return statusOption ? statusOption.label : status;
  };

  const renderImageUpload = (section, label) => (
    <div className="form-group full-width">
      <label>{label}</label>
      <div className="image-upload-section">
        <input
          type="file"
          ref={el => fileInputRefs.current[section] = el}
          onChange={(e) => handleImageUpload(section, e)}
          accept="image/*"
          className="file-input"
          disabled={user?.role === 'viewer'}
        />
        
        {!imagePreview[section] && (
          <div 
            className="upload-dropzone"
            onClick={() => fileInputRefs.current[section]?.click()}
          >
            <div className="upload-icon">📷</div>
            <p>Click to upload {label.toLowerCase()}</p>
            <p className="upload-hint">Supports: JPEG, PNG, GIF, BMP, WebP (Max 10MB)</p>
          </div>
        )}

        {imagePreview[section] && (
          <div className="image-preview-container">
            <img src={imagePreview[section]} alt={`${label} preview`} className="image-preview" />
            <div className="image-actions">
              <button 
                onClick={() => fileInputRefs.current[section]?.click()} 
                className="btn btn-primary btn-sm"
                disabled={user?.role === 'viewer'}
              >
                Change Image
              </button>
              <button 
                onClick={() => removeImage(section)} 
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
  );

  return (
    <div className="housing-prep-module">
      {/* Module Header */}
      <div className="module-header">
        <h2>🏠 Housing Preparation Workflow</h2>
        <div className="module-actions">
          <button 
            onClick={() => setShowHistory(!showHistory)} 
            className={`btn ${showHistory ? 'btn-secondary' : 'btn-primary'}`}
          >
            {showHistory ? 'Hide History' : 'Show History'}
          </button>
          <button 
            onClick={() => window.location.href = '/testing-workflow'}
            className="btn btn-secondary btn-sm"
          >
            ← Back to Workflow
          </button>
          {showHistory && (
            <button onClick={() => {}} className="btn btn-success">
              📊 Generate Report
            </button>
          )}
        </div>
      </div>

      <div className="module-content">
        {/* Section Navigation */}
        <div className="section-nav">
          {sections.map(section => (
            <button
              key={section.id}
              onClick={() => setCurrentSection(section.id)}
              className={`section-nav-btn ${currentSection === section.id ? 'active' : ''}`}
            >
              <span className="section-icon">{section.icon}</span>
              <span className="section-label">{section.label}</span>
              <span 
                className="section-status"
                style={{ 
                  backgroundColor: getStatusColor(
                    section.id === 'cure' ? formData.epoxy_cure.cure_status : formData[section.id === 'prepare' ? 'prepare_housing' : section.id === 'mount' ? 'mount_chip' : 'pin_epoxy']?.status
                  ) 
                }}
              />
            </button>
          ))}
        </div>

        {/* Basic Information */}
        <div className="card">
          <h3>Basic Information</h3>
          <div className="form-grid">
            <div className="form-group">
              <label>Operator *</label>
              <input
                type="text"
                value={formData.operator}
                onChange={(e) => handleInputChange(null, 'operator', e.target.value)}
                placeholder="Operator name"
                disabled={true}
              />
            </div>
            
            <div className="form-group">
              <label>Housing Number *</label>
              <input
                type="text"
                value={formData.Housing_number}
                onChange={(e) => handleInputChange(null, 'Housing_number', e.target.value)}
                placeholder="Enter Housing Number"
                disabled={user?.role === 'viewer'}
              />
            </div>

            <div className="form-group">
              <label>Housing Serial *</label>
              <input
                type="text"
                value={formData.Housing_serial}
                onChange={(e) => handleInputChange(null, 'Housing_serial', e.target.value)}
                placeholder="Enter Housing Serial"
                disabled={user?.role === 'viewer'}
              />
            </div>
          </div>
        </div>

        {/* Section Content */}
        {currentSection === 'prepare' && (
          <div className="card">
            <div className="section-header">
              <h3>Prepare Housing</h3>
              <div className="section-status-badge">
                <span 
                  className="status-badge"
                  style={{ backgroundColor: getStatusColor(formData.prepare_housing.status) }}
                >
                  {getStatusLabel(formData.prepare_housing.status)}
                </span>
              </div>
            </div>
            
            <div className="form-grid">
              <div className="form-group">
                <label>Status</label>
                <select
                  value={formData.prepare_housing.status}
                  onChange={(e) => handleInputChange('prepare_housing', 'status', e.target.value)}
                  disabled={user?.role === 'viewer'}
                  style={{ color: getStatusColor(formData.prepare_housing.status) }}
                >
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value} style={{ color: option.color }}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group full-width">
                <label>Preparation Notes</label>
                <textarea
                  value={formData.prepare_housing.notes}
                  onChange={(e) => handleInputChange('prepare_housing', 'notes', e.target.value)}
                  placeholder="Enter housing preparation notes, cleaning procedures, inspections..."
                  rows={4}
                  disabled={user?.role === 'viewer'}
                />
              </div>

              {renderImageUpload('prepare_housing', 'Housing Preparation Image')}
            </div>

            {user?.role !== 'viewer' && (
              <div className="button-group">
                <button 
                  onClick={() => markSectionComplete('prepare_housing')}
                  className="btn btn-success"
                  disabled={formData.prepare_housing.status === 'completed'}
                >
                  ✅ Mark as Complete
                </button>
              </div>
            )}
          </div>
        )}

        {currentSection === 'mount' && (
          <div className="card">
            <div className="section-header">
              <h3>Mount Transition and Router Chip</h3>
              <div className="section-status-badge">
                <span 
                  className="status-badge"
                  style={{ backgroundColor: getStatusColor(formData.mount_chip.status) }}
                >
                  {getStatusLabel(formData.mount_chip.status)}
                </span>
              </div>
            </div>
            
            <div className="form-grid">
              <div className="form-group">
                <label>Transition Chip Serial</label>
                <input
                  type="text"
                  value={formData.mount_chip.transition_chip_serial}
                  onChange={(e) => handleInputChange('mount_chip', 'transition_chip_serial', e.target.value)}
                  placeholder="Enter transition chip serial number"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              <div className="form-group">
                <label>Router Chip Serial</label>
                <input
                  type="text"
                  value={formData.mount_chip.router_chip_serial}
                  onChange={(e) => handleInputChange('mount_chip', 'router_chip_serial', e.target.value)}
                  placeholder="Enter router chip serial number"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              <div className="form-group">
                <label>Status</label>
                <select
                  value={formData.mount_chip.status}
                  onChange={(e) => handleInputChange('mount_chip', 'status', e.target.value)}
                  disabled={user?.role === 'viewer'}
                  style={{ color: getStatusColor(formData.mount_chip.status) }}
                >
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value} style={{ color: option.color }}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group full-width">
                <label>Mounting Notes</label>
                <textarea
                  value={formData.mount_chip.notes}
                  onChange={(e) => handleInputChange('mount_chip', 'notes', e.target.value)}
                  placeholder="Enter chip mounting notes, alignment checks, connection status..."
                  rows={4}
                  disabled={user?.role === 'viewer'}
                />
              </div>

              {renderImageUpload('mount_chip', 'Chip Mounting Image')}
            </div>

            {user?.role !== 'viewer' && (
              <div className="button-group">
                <button 
                  onClick={() => markSectionComplete('mount_chip')}
                  className="btn btn-success"
                  disabled={formData.mount_chip.status === 'completed'}
                >
                  ✅ Mark as Complete
                </button>
              </div>
            )}
          </div>
        )}

        {currentSection === 'epoxy' && (
          <div className="card">
            <div className="section-header">
              <h3>Housing Pin Epoxy</h3>
              <div className="section-status-badge">
                <span 
                  className="status-badge"
                  style={{ backgroundColor: getStatusColor(formData.pin_epoxy.status) }}
                >
                  {getStatusLabel(formData.pin_epoxy.status)}
                </span>
              </div>
            </div>
            
            <div className="form-grid">
              <div className="form-group">
                <label>Epoxy Batch Number</label>
                <input
                  type="text"
                  value={formData.pin_epoxy.epoxy_batch_number}
                  onChange={(e) => handleInputChange('pin_epoxy', 'epoxy_batch_number', e.target.value)}
                  placeholder="Enter epoxy batch number"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              <div className="form-group">
                <label>Epoxy Type</label>
                <input
                  type="text"
                  value={formData.pin_epoxy.epoxy_type}
                  onChange={(e) => handleInputChange('pin_epoxy', 'epoxy_type', e.target.value)}
                  placeholder="Enter epoxy type/model"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              <div className="form-group">
                <label>Application Method</label>
                <select
                  value={formData.pin_epoxy.application_method}
                  onChange={(e) => handleInputChange('pin_epoxy', 'application_method', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="manual">Manual Application</option>
                  <option value="automated">Automated Dispenser</option>
                  <option value="needle">Needle Applicator</option>
                  <option value="syringe">Syringe Application</option>
                </select>
              </div>

              <div className="form-group">
                <label>Status</label>
                <select
                  value={formData.pin_epoxy.status}
                  onChange={(e) => handleInputChange('pin_epoxy', 'status', e.target.value)}
                  disabled={user?.role === 'viewer'}
                  style={{ color: getStatusColor(formData.pin_epoxy.status) }}
                >
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value} style={{ color: option.color }}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group full-width">
                <label>Epoxy Application Notes</label>
                <textarea
                  value={formData.pin_epoxy.notes}
                  onChange={(e) => handleInputChange('pin_epoxy', 'notes', e.target.value)}
                  placeholder="Enter epoxy application notes, coverage, quality checks..."
                  rows={4}
                  disabled={user?.role === 'viewer'}
                />
              </div>

              {renderImageUpload('pin_epoxy', 'Epoxy Application Image')}
            </div>

            {user?.role !== 'viewer' && (
              <div className="button-group">
                <button 
                  onClick={() => markSectionComplete('pin_epoxy')}
                  className="btn btn-success"
                  disabled={formData.pin_epoxy.status === 'completed'}
                >
                  ✅ Mark as Complete
                </button>
              </div>
            )}
          </div>
        )}

        {currentSection === 'cure' && (
          <div className="card">
            <div className="section-header">
              <h3>Epoxy Cure Process</h3>
              <div className="section-status-badge">
                <span 
                  className="status-badge"
                  style={{ backgroundColor: getStatusColor(formData.epoxy_cure.cure_status) }}
                >
                  {getStatusLabel(formData.epoxy_cure.cure_status)}
                </span>
              </div>
            </div>
            
            

            <div className="form-grid">
              <div className="form-group">
                <label>Epoxy Batch Number </label>
                <input
                  type="number"
                  value={formData.epoxy_cure.epoxy_batch_number}
                  onChange={(e) => handleInputChange('epoxy_cure', 'epoxy_batch_number', e.target.value)}
                  placeholder="Enter epoxy Batch Number"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              

              <div className="form-group">
                <label>Cure Temperature (°C)</label>
                <input
                  type="number"
                  value={formData.epoxy_cure.cure_temperature}
                  onChange={(e) => handleInputChange('epoxy_cure', 'cure_temperature', e.target.value)}
                  placeholder="Enter cure Temperature"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              <div className="form-group full-width">
                <label>Cure Timer</label>
                <div className="cure-timer-section">
                  <div className="timer-display">
                    <h2 className="timer-text">{formatTime(epoxyTimeRemaining)}</h2>
                    <p className="timer-label">
                      {formData.epoxy_cure.cure_status === 'running' ? 'Time Remaining' : 
                       formData.epoxy_cure.cure_status === 'completed' ? 'Cure Complete' : 
                       'Duration: 3 Hours'}
                    </p>
                  </div>
                  
                  <div className="timer-controls">
                    {formData.epoxy_cure.cure_status === 'not_started' && user?.role !== 'viewer' && (
                      <button 
                        onClick={startEpoxyCure}
                        className="btn btn-success btn-lg"
                      >
                        ▶️ Start Cure
                      </button>
                    )}
                    
                    {formData.epoxy_cure.cure_status === 'running' && user?.role !== 'viewer' && (
                      <>
                        <button 
                          onClick={pauseEpoxyCure}
                          className="btn btn-warning"
                        >
                          ⏸️ Pause
                        </button>
                        <button 
                          onClick={cancelEpoxyCure}
                          className="btn btn-danger"
                        >
                          ❌ Cancel
                        </button>
                      </>
                    )}
                    
                    {formData.epoxy_cure.cure_status === 'paused' && user?.role !== 'viewer' && (
                      <>
                        <button 
                          onClick={resumeEpoxyCure}
                          className="btn btn-success"
                        >
                          ▶️ Resume
                        </button>
                        <button 
                          onClick={cancelEpoxyCure}
                          className="btn btn-danger"
                        >
                          ❌ Cancel
                        </button>
                      </>
                    )}
                    
                    {formData.epoxy_cure.cure_status === 'completed' && (
                      <div className="cure-complete-info">
                        <span className="complete-icon">✅</span>
                        <span>Cure completed successfully!</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="form-group full-width">
                <label>Cure Process Notes</label>
                <textarea
                  value={formData.epoxy_cure.notes}
                  onChange={(e) => handleInputChange('epoxy_cure', 'notes', e.target.value)}
                  placeholder="Enter cure process notes, observations, temperature monitoring..."
                  rows={4}
                  disabled={user?.role === 'viewer'}
                />
              </div>
            </div>
          </div>
        )}

        {/* Save Button */}
        {user?.role !== 'viewer' && (
          <div className="card">
            <div className="button-group">
              <button 
                onClick={saveInspection} 
                disabled={loading}
                className="btn btn-primary btn-lg"
              >
                {loading ? 'Saving...' : '💾 Save Housing Preparation'}
              </button>
            </div>
          </div>
        )}

        {/* Inspection History */}
        {showHistory && (
          <div className="card">
            <div className="history-header">
              <h3>Housing Preparation History</h3>
              
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
                  <p>No housing preparations found</p>
                </div>
              ) : (
                inspections.map((inspection) => (
                  <div key={inspection.id} className="inspection-card">
                    <div className="inspection-header">
                      <h4>Housing: {inspection.Housing_number}</h4>
                      <span 
                        className="status-badge"
                        style={{ backgroundColor: getStatusColor(inspection.overall_status) }}
                      >
                        {getStatusLabel(inspection.overall_status)}
                      </span>
                    </div>
                    
                    <div className="inspection-details">
                      <p><strong>Serial:</strong> {inspection.Housing_serial}</p>
                      <p><strong>Operator:</strong> {inspection.operator}</p>
                      <p><strong>Date:</strong> {new Date(inspection.created_at).toLocaleDateString()}</p>
                      
                      <div className="section-progress">
                        <small>Progress:</small>
                        <div className="progress-indicators">
                          <span className={`progress-dot ${inspection.prepare_housing?.status === 'completed' ? 'completed' : ''}`} title="Prepare Housing"></span>
                          <span className={`progress-dot ${inspection.mount_chip?.status === 'completed' ? 'completed' : ''}`} title="Mount Chips"></span>
                          <span className={`progress-dot ${inspection.pin_epoxy?.status === 'completed' ? 'completed' : ''}`} title="Pin Epoxy"></span>
                          <span className={`progress-dot ${inspection.epoxy_cure?.cure_status === 'completed' ? 'completed' : ''}`} title="Epoxy Cure"></span>
                        </div>
                      </div>
                    </div>

                    <div className="inspection-actions">
                      <button 
                        onClick={() => viewInspectionDetails(inspection)}
                        className="btn btn-sm btn-primary"
                      >
                        View Details
                      </button>
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
              <h3>Housing Preparation Details - {selectedInspection.Housing_number}</h3>
              <button onClick={closeInspectionDetails} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <label>Housing Number:</label>
                  <span>{selectedInspection.Housing_number}</span>
                </div>
                
                <div className="detail-item">
                  <label>Housing Serial:</label>
                  <span>{selectedInspection.Housing_serial}</span>
                </div>
                
                <div className="detail-item">
                  <label>Operator:</label>
                  <span>{selectedInspection.operator}</span>
                </div>
                
                <div className="detail-item">
                  <label>Overall Status:</label>
                  <span 
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(selectedInspection.overall_status) }}
                  >
                    {getStatusLabel(selectedInspection.overall_status)}
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
              </div>

              {/* Section Details */}
              <div className="section-details">
                <h4>🔧 Prepare Housing</h4>
                <div className="section-detail-grid">
                  <div className="detail-item">
                    <label>Status:</label>
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedInspection.prepare_housing?.status) }}
                    >
                      {getStatusLabel(selectedInspection.prepare_housing?.status)}
                    </span>
                  </div>
                  {selectedInspection.prepare_housing?.notes && (
                    <div className="detail-item full-width">
                      <label>Notes:</label>
                      <div className="notes-content">{selectedInspection.prepare_housing.notes}</div>
                    </div>
                  )}
                </div>

                <h4> Mount Chips</h4>
                <div className="section-detail-grid">
                  <div className="detail-item">
                    <label>Status:</label>
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedInspection.mount_chip?.status) }}
                    >
                      {getStatusLabel(selectedInspection.mount_chip?.status)}
                    </span>
                  </div>
                  {selectedInspection.mount_chip?.transition_chip_serial && (
                    <div className="detail-item">
                      <label>Transition Chip:</label>
                      <span>{selectedInspection.mount_chip.transition_chip_serial}</span>
                    </div>
                  )}
                  {selectedInspection.mount_chip?.router_chip_serial && (
                    <div className="detail-item">
                      <label>Router Chip:</label>
                      <span>{selectedInspection.mount_chip.router_chip_serial}</span>
                    </div>
                  )}
                  {selectedInspection.mount_chip?.notes && (
                    <div className="detail-item full-width">
                      <label>Notes:</label>
                      <div className="notes-content">{selectedInspection.mount_chip.notes}</div>
                    </div>
                  )}
                </div>

                <h4>🧪 Pin Epoxy</h4>
                <div className="section-detail-grid">
                  <div className="detail-item">
                    <label>Status:</label>
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedInspection.pin_epoxy?.status) }}
                    >
                      {getStatusLabel(selectedInspection.pin_epoxy?.status)}
                    </span>
                  </div>
                  {selectedInspection.pin_epoxy?.epoxy_batch_number && (
                    <div className="detail-item">
                      <label>Batch Number:</label>
                      <span>{selectedInspection.pin_epoxy.epoxy_batch_number}</span>
                    </div>
                  )}
                  {selectedInspection.pin_epoxy?.epoxy_type && (
                    <div className="detail-item">
                      <label>Epoxy Type:</label>
                      <span>{selectedInspection.pin_epoxy.epoxy_type}</span>
                    </div>
                  )}
                  {selectedInspection.pin_epoxy?.notes && (
                    <div className="detail-item full-width">
                      <label>Notes:</label>
                      <div className="notes-content">{selectedInspection.pin_epoxy.notes}</div>
                    </div>
                  )}
                </div>

                <h4>🔥 Epoxy Cure</h4>
                <div className="section-detail-grid">
                  <div className="detail-item">
                    <label>Cure Status:</label>
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedInspection.epoxy_cure?.cure_status) }}
                    >
                      {getStatusLabel(selectedInspection.epoxy_cure?.cure_status)}
                    </span>
                  </div>
                  {selectedInspection.epoxy_cure?.cure_temperature && (
                    <div className="detail-item">
                      <label>Temperature:</label>
                      <span>{selectedInspection.epoxy_cure.cure_temperature}°C</span>
                    </div>
                  )}
                  {selectedInspection.epoxy_cure?.cure_pressure && (
                    <div className="detail-item">
                      <label>Pressure:</label>
                      <span>{selectedInspection.epoxy_cure.cure_pressure} PSI</span>
                    </div>
                  )}
                  {selectedInspection.epoxy_cure?.cure_start_time && (
                    <div className="detail-item">
                      <label>Start Time:</label>
                      <span>{new Date(selectedInspection.epoxy_cure.cure_start_time).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedInspection.epoxy_cure?.completed_at && (
                    <div className="detail-item">
                      <label>Completed:</label>
                      <span>{new Date(selectedInspection.epoxy_cure.completed_at).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedInspection.epoxy_cure?.notes && (
                    <div className="detail-item full-width">
                      <label>Notes:</label>
                      <div className="notes-content">{selectedInspection.epoxy_cure.notes}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const viewInspectionDetails = (inspection) => {
  setSelectedInspection(inspection);
};

const closeInspectionDetails = () => {
  setSelectedInspection(null);
};

export default Housingprep;