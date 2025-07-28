// src/modules/ChipInspection.js - Chip Inspection Workflow Module

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './ChipInspection.css';

const API_BASE_URL = 'http://localhost:8000';

const ChipInspection = ({ user, addNotification }) => {
  const [loading, setLoading] = useState(false);
  const [inspections, setInspections] = useState([]);
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [imagePreview, setImagePreview] = useState({});
  const [showHistory, setShowHistory] = useState(false);
  const [currentSection, setCurrentSection] = useState('inspection');
  const [epoxyCureTimer, setEpoxyCureTimer] = useState(null);
  const [epoxyCureStartTime, setEpoxyCureStartTime] = useState(null);
  const [epoxyTimeRemaining, setEpoxyTimeRemaining] = useState(0);
  const fileInputRefs = useRef({});
  
  // Testing workflow integration
  const [testContext, setTestContext] = useState(null);
  const [isTestMode, setIsTestMode] = useState(false);
  
  const [formData, setFormData] = useState({
    operator: user?.username || '',
    chip_number: '',
    wafer_id: '',
    
    // Chip Inspection Section
    chip_inspection: {
      visual_inspection: '',
      dimensional_check: '',
      surface_quality: '',
      defect_count: 0,
      pass_fail: 'pending',
      notes: '',
      status: 'not_started',
      image_file: null,
      completed_at: null
    },
    
    // Chip Paint Section
    chip_paint: {
      paint_type: '',
      paint_batch_number: '',
      paint_thickness: '',
      paint_coverage: '',
      paint_quality: '',
      cure_temperature: '',
      cure_time: '',
      pass_fail: 'pending',
      notes: '',
      status: 'not_started',
      image_file: null,
      completed_at: null
    },
    
    // Mount Chip in Housing Section
    mount_chip_housing: {
      housing_serial: '',
      chip_position: '',
      alignment_check: '',
      bonding_method: 'wire_bonding',
      bond_quality: '',
      electrical_continuity: '',
      pass_fail: 'pending',
      notes: '',
      status: 'not_started',
      image_file: null,
      completed_at: null
    },
    
    // Mount Termination Chip in Housing Section
    mount_termination: {
      termination_chip_serial: '',
      termination_position: '',
      termination_alignment: '',
      connection_method: 'solder',
      connection_quality: '',
      impedance_check: '',
      signal_integrity: '',
      pass_fail: 'pending',
      notes: '',
      status: 'not_started',
      image_file: null,
      completed_at: null
    },
    
    // Epoxy Cure Section
    epoxy_cure: {
      epoxy_type: '',
      epoxy_batch_number: '',
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
    { id: 'inspection', label: 'Chip Inspection', icon: '' },
    { id: 'paint', label: 'Chip Paint', icon: '' },
    { id: 'mount_housing', label: 'Mount in Housing', icon: '' },
    { id: 'termination', label: 'Mount Termination', icon: '' },
    { id: 'cure', label: 'Epoxy Cure', icon: '' }
  ];

  const statusOptions = [
    { value: 'not_started', label: 'Not Started', color: '#9E9E9E' },
    { value: 'in_progress', label: 'In Progress', color: '#FF9800' },
    { value: 'completed', label: 'Completed', color: '#4CAF50' },
    { value: 'failed', label: 'Failed', color: '#F44336' },
    { value: 'on_hold', label: 'On Hold', color: '#9C27B0' }
  ];

  const passFailOptions = [
    { value: 'pending', label: 'Pending', color: '#9E9E9E' },
    { value: 'pass', label: 'Pass', color: '#4CAF50' },
    { value: 'fail', label: 'Fail', color: '#F44336' }
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
        chip_inspection: {
          ...prev.chip_inspection,
          notes: `Test: ${storedTestContext.testName} for device ${storedTestContext.deviceSerialNumber}`
        }
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

      const response = await axios.get(`${API_BASE_URL}/modules/chip-inspection/inspections?${params}`, {
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
    const required = ['operator', 'chip_number', 'wafer_id'];
    const missing = required.filter(field => !formData[field]?.trim?.());
    
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
      inspectionData.append('overall_status', 'completed');
      
      // Add section data
      inspectionData.append('chip_inspection', JSON.stringify(formData.chip_inspection));
      inspectionData.append('chip_paint', JSON.stringify(formData.chip_paint));
      inspectionData.append('mount_chip_housing', JSON.stringify(formData.mount_chip_housing));
      inspectionData.append('mount_termination', JSON.stringify(formData.mount_termination));
      inspectionData.append('epoxy_cure', JSON.stringify(formData.epoxy_cure));
      
      // Add images
      if (formData.chip_inspection.image_file) {
        inspectionData.append('chip_inspection_image', formData.chip_inspection.image_file);
      }
      if (formData.chip_paint.image_file) {
        inspectionData.append('chip_paint_image', formData.chip_paint.image_file);
      }
      if (formData.mount_chip_housing.image_file) {
        inspectionData.append('mount_chip_housing_image', formData.mount_chip_housing.image_file);
      }
      if (formData.mount_termination.image_file) {
        inspectionData.append('mount_termination_image', formData.mount_termination.image_file);
      }

      // Save inspection
      await axios.post(`${API_BASE_URL}/modules/chip-inspection/save`, inspectionData, {
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
      inspectionData.append('overall_status', formData.overall_status);
      
      // Add section data
      inspectionData.append('chip_inspection', JSON.stringify(formData.chip_inspection));
      inspectionData.append('chip_paint', JSON.stringify(formData.chip_paint));
      inspectionData.append('mount_chip_housing', JSON.stringify(formData.mount_chip_housing));
      inspectionData.append('mount_termination', JSON.stringify(formData.mount_termination));
      inspectionData.append('epoxy_cure', JSON.stringify(formData.epoxy_cure));
      
      // Add images
      if (formData.chip_inspection.image_file) {
        inspectionData.append('chip_inspection_image', formData.chip_inspection.image_file);
      }
      if (formData.chip_paint.image_file) {
        inspectionData.append('chip_paint_image', formData.chip_paint.image_file);
      }
      if (formData.mount_chip_housing.image_file) {
        inspectionData.append('mount_chip_housing_image', formData.mount_chip_housing.image_file);
      }
      if (formData.mount_termination.image_file) {
        inspectionData.append('mount_termination_image', formData.mount_termination.image_file);
      }

      const response = await axios.post(`${API_BASE_URL}/modules/chip-inspection/save`, inspectionData, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'multipart/form-data'
        }
      });

      addNotification('Chip inspection workflow saved successfully', 'success');
      
      // Reset form
      setFormData({
        operator: user?.username || '',
        chip_number: '',
        wafer_id: '',
        chip_inspection: {
          visual_inspection: '',
          dimensional_check: '',
          surface_quality: '',
          defect_count: 0,
          pass_fail: 'pending',
          notes: '',
          status: 'not_started',
          image_file: null,
          completed_at: null
        },
        chip_paint: {
          paint_type: '',
          paint_batch_number: '',
          paint_thickness: '',
          paint_coverage: '',
          paint_quality: '',
          cure_temperature: '',
          cure_time: '',
          pass_fail: 'pending',
          notes: '',
          status: 'not_started',
          image_file: null,
          completed_at: null
        },
        mount_chip_housing: {
          housing_serial: '',
          chip_position: '',
          alignment_check: '',
          bonding_method: 'wire_bonding',
          bond_quality: '',
          electrical_continuity: '',
          pass_fail: 'pending',
          notes: '',
          status: 'not_started',
          image_file: null,
          completed_at: null
        },
        mount_termination: {
          termination_chip_serial: '',
          termination_position: '',
          termination_alignment: '',
          connection_method: 'solder',
          connection_quality: '',
          impedance_check: '',
          signal_integrity: '',
          pass_fail: 'pending',
          notes: '',
          status: 'not_started',
          image_file: null,
          completed_at: null
        },
        epoxy_cure: {
          epoxy_type: '',
          epoxy_batch_number: '',
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
      addNotification(error.response?.data?.detail || 'Failed to save chip inspection workflow', 'error');
    }
    setLoading(false);
  };

  const getStatusColor = (status) => {
    const statusOption = statusOptions.find(opt => opt.value === status) || 
                        passFailOptions.find(opt => opt.value === status) ||
                        cureStatusOptions.find(opt => opt.value === status);
    return statusOption ? statusOption.color : '#666';
  };

  const getStatusLabel = (status) => {
    const statusOption = statusOptions.find(opt => opt.value === status) || 
                        passFailOptions.find(opt => opt.value === status) ||
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

  const viewInspectionDetails = (inspection) => {
    setSelectedInspection(inspection);
  };

  const closeInspectionDetails = () => {
    setSelectedInspection(null);
  };

  return (
    <div className="chip-inspection-module">
      {/* Module Header */}
      <div className="module-header">
        <h2>🔍 Chip Preparation Workflow</h2>
        <div className="module-actions">
          {!isTestMode && (
            <>
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
            </>
          )}
          {isTestMode && (
            <button 
              onClick={() => window.location.href = '/testing-workflow'}
              className="btn btn-secondary btn-sm"
            >
              ← Back to Workflow
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
                    section.id === 'inspection' ? formData.chip_inspection?.status : 
                    section.id === 'paint' ? formData.chip_paint?.status : 
                    section.id === 'mount_housing' ? formData.mount_chip_housing?.status : 
                    section.id === 'termination' ? formData.mount_termination?.status :
                    section.id === 'cure' ? formData.epoxy_cure?.cure_status : 'not_started'
                  ) 
                }}
              />
            </button>
          ))}
        </div>

        {/* Basic Information */}
        <div className="card">
          <h3>{isTestMode ? `${testContext?.testName} - Basic Information` : 'Basic Information'}</h3>
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
              <label>Chip Number *</label>
              <input
                type="text"
                value={formData.chip_number}
                onChange={(e) => handleInputChange(null, 'chip_number', e.target.value)}
                placeholder="Enter chip number"
                disabled={user?.role === 'viewer'}
              />
            </div>

            <div className="form-group">
              <label>Wafer ID *</label>
              <input
                type="text"
                value={formData.wafer_id}
                onChange={(e) => handleInputChange(null, 'wafer_id', e.target.value)}
                placeholder="Enter wafer ID"
                disabled={user?.role === 'viewer'}
              />
            </div>
          </div>
        </div>

        {/* Section Content */}
        {currentSection === 'inspection' && (
          <div className="card">
            <div className="section-header">
              <h3>Chip Inspection</h3>
              <div className="section-status-badge">
                <span 
                  className="status-badge"
                  style={{ backgroundColor: getStatusColor(formData.chip_inspection.status) }}
                >
                  {getStatusLabel(formData.chip_inspection.status)}
                </span>
              </div>
            </div>
            
            <div className="form-grid">
              <div className="form-group">
                <label>Visual Inspection</label>
                <select
                  value={formData.chip_inspection.visual_inspection}
                  onChange={(e) => handleInputChange('chip_inspection', 'visual_inspection', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select result</option>
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="acceptable">Acceptable</option>
                  <option value="poor">Poor</option>
                </select>
              </div>

              {/* <div className="form-group">
                <label>Dimensional Check</label>
                <select
                  value={formData.chip_inspection.dimensional_check}
                  onChange={(e) => handleInputChange('chip_inspection', 'dimensional_check', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select result</option>
                  <option value="within_tolerance">Within Tolerance</option>
                  <option value="marginal">Marginal</option>
                  <option value="out_of_spec">Out of Spec</option>
                </select>
              </div> */}

              <div className="form-group">
                <label>Surface Quality</label>
                <select
                  value={formData.chip_inspection.surface_quality}
                  onChange={(e) => handleInputChange('chip_inspection', 'surface_quality', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select quality</option>
                  <option value="pristine">Pristine</option>
                  <option value="minor_scratches">Minor Scratches</option>
                  <option value="moderate_defects">Moderate Defects</option>
                  <option value="major_defects">Major Defects</option>
                </select>
              </div>

              <div className="form-group">
                <label>Defect Count</label>
                <input
                  type="number"
                  min="0"
                  value={formData.chip_inspection.defect_count}
                  onChange={(e) => handleInputChange('chip_inspection', 'defect_count', parseInt(e.target.value) || 0)}
                  placeholder="Number of defects found"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              <div className="form-group">
                <label>Pass/Fail</label>
                <select
                  value={formData.chip_inspection.pass_fail}
                  onChange={(e) => handleInputChange('chip_inspection', 'pass_fail', e.target.value)}
                  disabled={user?.role === 'viewer'}
                  style={{ color: getStatusColor(formData.chip_inspection.pass_fail) }}
                >
                  {passFailOptions.map(option => (
                    <option key={option.value} value={option.value} style={{ color: option.color }}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Status</label>
                <select
                  value={formData.chip_inspection.status}
                  onChange={(e) => handleInputChange('chip_inspection', 'status', e.target.value)}
                  disabled={user?.role === 'viewer'}
                  style={{ color: getStatusColor(formData.chip_inspection.status) }}
                >
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value} style={{ color: option.color }}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group full-width">
                <label>Inspection Notes</label>
                <textarea
                  value={formData.chip_inspection.notes}
                  onChange={(e) => handleInputChange('chip_inspection', 'notes', e.target.value)}
                  placeholder="Enter inspection observations, defect descriptions, measurements..."
                  rows={4}
                  disabled={user?.role === 'viewer'}
                />
              </div>

              {renderImageUpload('chip_inspection', 'Chip Inspection Image')}
            </div>

            {user?.role !== 'viewer' && (
              <div className="button-group">
                <button 
                  onClick={() => markSectionComplete('chip_inspection')}
                  className="btn btn-success"
                  disabled={formData.chip_inspection.status === 'completed'}
                >
                  ✅ Mark as Complete
                </button>
              </div>
            )}
          </div>
        )}

        {currentSection === 'paint' && (
          <div className="card">
            <div className="section-header">
              <h3>Chip Paint</h3>
              <div className="section-status-badge">
                <span 
                  className="status-badge"
                  style={{ backgroundColor: getStatusColor(formData.chip_paint.status) }}
                >
                  {getStatusLabel(formData.chip_paint.status)}
                </span>
              </div>
            </div>
            
            <div className="form-grid">
              {/* <div className="form-group">
                <label>Paint Type</label>
                <input
                  type="text"
                  value={formData.chip_paint.paint_type}
                  onChange={(e) => handleInputChange('chip_paint', 'paint_type', e.target.value)}
                  placeholder="Enter paint type/model"
                  disabled={user?.role === 'viewer'}
                />
              </div> */}

              <div className="form-group">
                <label>Paint Batch Number</label>
                <input
                  type="text"
                  value={formData.chip_paint.paint_batch_number}
                  onChange={(e) => handleInputChange('chip_paint', 'paint_batch_number', e.target.value)}
                  placeholder="Enter batch number"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              {/* <div className="form-group">
                <label>Paint Thickness (μm)</label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.chip_paint.paint_thickness}
                  onChange={(e) => handleInputChange('chip_paint', 'paint_thickness', e.target.value)}
                  placeholder="Thickness in micrometers"
                  disabled={user?.role === 'viewer'}
                />
              </div> */}

              {/* <div className="form-group">
                <label>Paint Coverage</label>
                <select
                  value={formData.chip_paint.paint_coverage}
                  onChange={(e) => handleInputChange('chip_paint', 'paint_coverage', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select coverage</option>
                  <option value="complete">Complete Coverage</option>
                  <option value="minor_gaps">Minor Gaps</option>
                  <option value="significant_gaps">Significant Gaps</option>
                  <option value="incomplete">Incomplete</option>
                </select>
              </div>

              <div className="form-group">
                <label>Paint Quality</label>
                <select
                  value={formData.chip_paint.paint_quality}
                  onChange={(e) => handleInputChange('chip_paint', 'paint_quality', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select quality</option>
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="acceptable">Acceptable</option>
                  <option value="poor">Poor</option>
                </select>
              </div>

              <div className="form-group">
                <label>Cure Temperature (°C)</label>
                <input
                  type="number"
                  value={formData.chip_paint.cure_temperature}
                  onChange={(e) => handleInputChange('chip_paint', 'cure_temperature', e.target.value)}
                  placeholder="Enter cure temperature"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              <div className="form-group">
                <label>Cure Time (minutes)</label>
                <input
                  type="number"
                  value={formData.chip_paint.cure_time}
                  onChange={(e) => handleInputChange('chip_paint', 'cure_time', e.target.value)}
                  placeholder="Enter cure time"
                  disabled={user?.role === 'viewer'}
                />
              </div> */}

              <div className="form-group">
                <label>Pass/Fail</label>
                <select
                  value={formData.chip_paint.pass_fail}
                  onChange={(e) => handleInputChange('chip_paint', 'pass_fail', e.target.value)}
                  disabled={user?.role === 'viewer'}
                  style={{ color: getStatusColor(formData.chip_paint.pass_fail) }}
                >
                  {passFailOptions.map(option => (
                    <option key={option.value} value={option.value} style={{ color: option.color }}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Status</label>
                <select
                  value={formData.chip_paint.status}
                  onChange={(e) => handleInputChange('chip_paint', 'status', e.target.value)}
                  disabled={user?.role === 'viewer'}
                  style={{ color: getStatusColor(formData.chip_paint.status) }}
                >
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value} style={{ color: option.color }}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group full-width">
                <label>Paint Process Notes</label>
                <textarea
                  value={formData.chip_paint.notes}
                  onChange={(e) => handleInputChange('chip_paint', 'notes', e.target.value)}
                  placeholder="Enter paint application notes, quality observations, cure process details..."
                  rows={4}
                  disabled={user?.role === 'viewer'}
                />
              </div>

              {renderImageUpload('chip_paint', 'Chip Paint Image')}
            </div>

            {user?.role !== 'viewer' && (
              <div className="button-group">
                <button 
                  onClick={() => markSectionComplete('chip_paint')}
                  className="btn btn-success"
                  disabled={formData.chip_paint.status === 'completed'}
                >
                  ✅ Mark as Complete
                </button>
              </div>
            )}
          </div>
        )}

        {currentSection === 'mount_housing' && (
          <div className="card">
            <div className="section-header">
              <h3>Mount Chip in Housing</h3>
              <div className="section-status-badge">
                <span 
                  className="status-badge"
                  style={{ backgroundColor: getStatusColor(formData.mount_chip_housing.status) }}
                >
                  {getStatusLabel(formData.mount_chip_housing.status)}
                </span>
              </div>
            </div>
            
            <div className="form-grid">
              <div className="form-group">
                <label>Housing Serial</label>
                <input
                  type="text"
                  value={formData.mount_chip_housing.housing_serial}
                  onChange={(e) => handleInputChange('mount_chip_housing', 'housing_serial', e.target.value)}
                  placeholder="Enter housing serial number"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              {/* <div className="form-group">
                <label>Chip Position</label>
                <select
                  value={formData.mount_chip_housing.chip_position}
                  onChange={(e) => handleInputChange('mount_chip_housing', 'chip_position', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select position</option>
                  <option value="center">Center</option>
                  <option value="top_left">Top Left</option>
                  <option value="top_right">Top Right</option>
                  <option value="bottom_left">Bottom Left</option>
                  <option value="bottom_right">Bottom Right</option>
                  <option value="custom">Custom Position</option>
                </select>
              </div> */}

              <div className="form-group">
                <label>Alignment Check</label>
                <select
                  value={formData.mount_chip_housing.alignment_check}
                  onChange={(e) => handleInputChange('mount_chip_housing', 'alignment_check', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select alignment</option>
                  <option value="perfect">Perfect Alignment</option>
                  <option value="within_tolerance">Within Tolerance</option>
                  <option value="marginal">Marginal</option>
                  <option value="misaligned">Misaligned</option>
                </select>
              </div>

              {/* <div className="form-group">
                <label>Bonding Method</label>
                <select
                  value={formData.mount_chip_housing.bonding_method}
                  onChange={(e) => handleInputChange('mount_chip_housing', 'bonding_method', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="wire_bonding">Wire Bonding</option>
                  <option value="flip_chip">Flip Chip</option>
                  <option value="tape_automated_bonding">TAB (Tape Automated Bonding)</option>
                  <option value="conductive_adhesive">Conductive Adhesive</option>
                </select>
              </div> */}

              {/* <div className="form-group">
                <label>Bond Quality</label>
                <select
                  value={formData.mount_chip_housing.bond_quality}
                  onChange={(e) => handleInputChange('mount_chip_housing', 'bond_quality', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select quality</option>
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="acceptable">Acceptable</option>
                  <option value="poor">Poor</option>
                  <option value="failed">Failed</option>
                </select>
              </div> */}

              {/* <div className="form-group">
                <label>Electrical Continuity</label>
                <select
                  value={formData.mount_chip_housing.electrical_continuity}
                  onChange={(e) => handleInputChange('mount_chip_housing', 'electrical_continuity', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select result</option>
                  <option value="all_connections_good">All Connections Good</option>
                  <option value="minor_issues">Minor Issues</option>
                  <option value="multiple_failures">Multiple Failures</option>
                  <option value="no_continuity">No Continuity</option>
                </select>
              </div> */}

              <div className="form-group">
                <label>Pass/Fail</label>
                <select
                  value={formData.mount_chip_housing.pass_fail}
                  onChange={(e) => handleInputChange('mount_chip_housing', 'pass_fail', e.target.value)}
                  disabled={user?.role === 'viewer'}
                  style={{ color: getStatusColor(formData.mount_chip_housing.pass_fail) }}
                >
                  {passFailOptions.map(option => (
                    <option key={option.value} value={option.value} style={{ color: option.color }}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Status</label>
                <select
                  value={formData.mount_chip_housing.status}
                  onChange={(e) => handleInputChange('mount_chip_housing', 'status', e.target.value)}
                  disabled={user?.role === 'viewer'}
                  style={{ color: getStatusColor(formData.mount_chip_housing.status) }}
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
                  value={formData.mount_chip_housing.notes}
                  onChange={(e) => handleInputChange('mount_chip_housing', 'notes', e.target.value)}
                  placeholder="Enter mounting process notes, alignment observations, bonding quality details..."
                  rows={4}
                  disabled={user?.role === 'viewer'}
                />
              </div>

              {renderImageUpload('mount_chip_housing', 'Chip Mounting Image')}
            </div>

            {user?.role !== 'viewer' && (
              <div className="button-group">
                <button 
                  onClick={() => markSectionComplete('mount_chip_housing')}
                  className="btn btn-success"
                  disabled={formData.mount_chip_housing.status === 'completed'}
                >
                  ✅ Mark as Complete
                </button>
              </div>
            )}
          </div>
        )}

        {currentSection === 'termination' && (
          <div className="card">
            <div className="section-header">
              <h3>Mount Termination Chip in Housing</h3>
              <div className="section-status-badge">
                <span 
                  className="status-badge"
                  style={{ backgroundColor: getStatusColor(formData.mount_termination.status) }}
                >
                  {getStatusLabel(formData.mount_termination.status)}
                </span>
              </div>
            </div>
            
            <div className="form-grid">
              <div className="form-group">
                <label>Termination Chip Serial</label>
                <input
                  type="text"
                  value={formData.mount_termination.termination_chip_serial}
                  onChange={(e) => handleInputChange('mount_termination', 'termination_chip_serial', e.target.value)}
                  placeholder="Enter termination chip serial"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              {/* <div className="form-group">
                <label>Termination Position</label>
                <select
                  value={formData.mount_termination.termination_position}
                  onChange={(e) => handleInputChange('mount_termination', 'termination_position', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select position</option>
                  <option value="input_side">Input Side</option>
                  <option value="output_side">Output Side</option>
                  <option value="both_sides">Both Sides</option>
                  <option value="corner_mount">Corner Mount</option>
                  <option value="edge_mount">Edge Mount</option>
                </select>
              </div> */}

              {/* <div className="form-group">
                <label>Termination Alignment</label>
                <select
                  value={formData.mount_termination.termination_alignment}
                  onChange={(e) => handleInputChange('mount_termination', 'termination_alignment', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select alignment</option>
                  <option value="perfect">Perfect Alignment</option>
                  <option value="within_spec">Within Specification</option>
                  <option value="marginal">Marginal</option>
                  <option value="out_of_spec">Out of Specification</option>
                </select>
              </div> */}

              {/* <div className="form-group">
                <label>Connection Method</label>
                <select
                  value={formData.mount_termination.connection_method}
                  onChange={(e) => handleInputChange('mount_termination', 'connection_method', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="solder">Solder</option>
                  <option value="conductive_epoxy">Conductive Epoxy</option>
                  <option value="wire_bonding">Wire Bonding</option>
                  <option value="pressure_contact">Pressure Contact</option>
                  <option value="spring_contact">Spring Contact</option>
                </select>
              </div>

              <div className="form-group">
                <label>Connection Quality</label>
                <select
                  value={formData.mount_termination.connection_quality}
                  onChange={(e) => handleInputChange('mount_termination', 'connection_quality', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select quality</option>
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="acceptable">Acceptable</option>
                  <option value="poor">Poor</option>
                  <option value="failed">Failed</option>
                </select>
              </div> */}

              <div className="form-group">
                <label>Impedance Check</label>
                <select
                  value={formData.mount_termination.impedance_check}
                  onChange={(e) => handleInputChange('mount_termination', 'impedance_check', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select result</option>
                  <option value="within_tolerance">Within Tolerance</option>
                  <option value="marginal">Marginal</option>
                  <option value="out_of_spec">Out of Specification</option>
                  <option value="measurement_failed">Measurement Failed</option>
                </select>
              </div>

              {/* <div className="form-group">
                <label>Signal Integrity</label>
                <select
                  value={formData.mount_termination.signal_integrity}
                  onChange={(e) => handleInputChange('mount_termination', 'signal_integrity', e.target.value)}
                  disabled={user?.role === 'viewer'}
                >
                  <option value="">Select result</option>
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="acceptable">Acceptable</option>
                  <option value="poor">Poor</option>
                  <option value="failed">Failed</option>
                </select>
              </div> */}

              <div className="form-group">
                <label>Pass/Fail</label>
                <select
                  value={formData.mount_termination.pass_fail}
                  onChange={(e) => handleInputChange('mount_termination', 'pass_fail', e.target.value)}
                  disabled={user?.role === 'viewer'}
                  style={{ color: getStatusColor(formData.mount_termination.pass_fail) }}
                >
                  {passFailOptions.map(option => (
                    <option key={option.value} value={option.value} style={{ color: option.color }}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Status</label>
                <select
                  value={formData.mount_termination.status}
                  onChange={(e) => handleInputChange('mount_termination', 'status', e.target.value)}
                  disabled={user?.role === 'viewer'}
                  style={{ color: getStatusColor(formData.mount_termination.status) }}
                >
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value} style={{ color: option.color }}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group full-width">
                <label>Termination Notes</label>
                <textarea
                  value={formData.mount_termination.notes}
                  onChange={(e) => handleInputChange('mount_termination', 'notes', e.target.value)}
                  placeholder="Enter termination mounting notes, connection quality, signal integrity observations..."
                  rows={4}
                  disabled={user?.role === 'viewer'}
                />
              </div>

              {renderImageUpload('mount_termination', 'Termination Mounting Image')}
            </div>

            {user?.role !== 'viewer' && (
              <div className="button-group">
                <button 
                  onClick={() => markSectionComplete('mount_termination')}
                  className="btn btn-success"
                  disabled={formData.mount_termination.status === 'completed'}
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
              {/* <div className="form-group">
                <label>Epoxy Type</label>
                <input
                  type="text"
                  value={formData.epoxy_cure.epoxy_type}
                  onChange={(e) => handleInputChange('epoxy_cure', 'epoxy_type', e.target.value)}
                  placeholder="Enter epoxy type/model"
                  disabled={user?.role === 'viewer'}
                />
              </div> */}

              <div className="form-group">
                <label>Epoxy Batch Number</label>
                <input
                  type="text"
                  value={formData.epoxy_cure.epoxy_batch_number}
                  onChange={(e) => handleInputChange('epoxy_cure', 'epoxy_batch_number', e.target.value)}
                  placeholder="Enter batch number"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              <div className="form-group">
                <label>Cure Temperature (°C)</label>
                <input
                  type="number"
                  value={formData.epoxy_cure.cure_temperature}
                  onChange={(e) => handleInputChange('epoxy_cure', 'cure_temperature', e.target.value)}
                  placeholder="Enter cure temperature"
                  disabled={user?.role === 'viewer'}
                />
              </div>

              {/* <div className="form-group">
                <label>Cure Pressure (PSI)</label>
                <input
                  type="number"
                  value={formData.epoxy_cure.cure_pressure}
                  onChange={(e) => handleInputChange('epoxy_cure', 'cure_pressure', e.target.value)}
                  placeholder="Enter cure pressure"
                  disabled={user?.role === 'viewer'}
                />
              </div> */}

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
                onClick={isTestMode ? handleTestComplete : saveInspection} 
                disabled={loading}
                className={`btn ${isTestMode ? 'btn-success' : 'btn-primary'} btn-lg`}
              >
                {loading ? (
                  'Processing...'
                ) : isTestMode ? (
                  '✅ Complete Test & Return'
                ) : (
                  '💾 Save Chip Inspection Workflow'
                )}
              </button>
            </div>
          </div>
        )}

        {/* Inspection History - Hidden in test mode */}
        {showHistory && !isTestMode && (
          <div className="card">
            <div className="history-header">
              <h3>Chip Inspection History</h3>
              
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
                  <p>No chip inspections found</p>
                </div>
              ) : (
                inspections.map((inspection) => (
                  <div key={inspection.id} className="inspection-card">
                    <div className="inspection-header">
                      <h4>Chip: {inspection.chip_number}</h4>
                      <span 
                        className="status-badge"
                        style={{ backgroundColor: getStatusColor(inspection.overall_status) }}
                      >
                        {getStatusLabel(inspection.overall_status)}
                      </span>
                    </div>
                    
                    <div className="inspection-details">
                      <p><strong>Wafer ID:</strong> {inspection.wafer_id}</p>
                      <p><strong>Operator:</strong> {inspection.operator}</p>
                      <p><strong>Date:</strong> {new Date(inspection.created_at).toLocaleDateString()}</p>
                      
                      <div className="section-progress">
                        <small>Progress:</small>
                        <div className="progress-indicators">
                          <span className={`progress-dot ${inspection.chip_inspection?.status === 'completed' ? 'completed' : ''}`} title="Chip Inspection"></span>
                          <span className={`progress-dot ${inspection.chip_paint?.status === 'completed' ? 'completed' : ''}`} title="Chip Paint"></span>
                          <span className={`progress-dot ${inspection.mount_chip_housing?.status === 'completed' ? 'completed' : ''}`} title="Mount in Housing"></span>
                          <span className={`progress-dot ${inspection.mount_termination?.status === 'completed' ? 'completed' : ''}`} title="Mount Termination"></span>
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
              <h3>Chip Inspection Details - {selectedInspection.chip_number}</h3>
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
                <h4>Chip Inspection</h4>
                <div className="section-detail-grid">
                  <div className="detail-item">
                    <label>Status:</label>
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedInspection.chip_inspection?.status) }}
                    >
                      {getStatusLabel(selectedInspection.chip_inspection?.status)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <label>Pass/Fail:</label>
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedInspection.chip_inspection?.pass_fail) }}
                    >
                      {getStatusLabel(selectedInspection.chip_inspection?.pass_fail)}
                    </span>
                  </div>
                  {selectedInspection.chip_inspection?.visual_inspection && (
                    <div className="detail-item">
                      <label>Visual Inspection:</label>
                      <span>{selectedInspection.chip_inspection.visual_inspection}</span>
                    </div>
                  )}
                  {selectedInspection.chip_inspection?.defect_count !== undefined && (
                    <div className="detail-item">
                      <label>Defect Count:</label>
                      <span>{selectedInspection.chip_inspection.defect_count}</span>
                    </div>
                  )}
                  {selectedInspection.chip_inspection?.notes && (
                    <div className="detail-item full-width">
                      <label>Notes:</label>
                      <div className="notes-content">{selectedInspection.chip_inspection.notes}</div>
                    </div>
                  )}
                </div>

                <h4>Chip Paint</h4>
                <div className="section-detail-grid">
                  <div className="detail-item">
                    <label>Status:</label>
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedInspection.chip_paint?.status) }}
                    >
                      {getStatusLabel(selectedInspection.chip_paint?.status)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <label>Pass/Fail:</label>
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedInspection.chip_paint?.pass_fail) }}
                    >
                      {getStatusLabel(selectedInspection.chip_paint?.pass_fail)}
                    </span>
                  </div>
                  {selectedInspection.chip_paint?.paint_type && (
                    <div className="detail-item">
                      <label>Paint Type:</label>
                      <span>{selectedInspection.chip_paint.paint_type}</span>
                    </div>
                  )}
                  {selectedInspection.chip_paint?.paint_thickness && (
                    <div className="detail-item">
                      <label>Thickness:</label>
                      <span>{selectedInspection.chip_paint.paint_thickness} μm</span>
                    </div>
                  )}
                  {selectedInspection.chip_paint?.notes && (
                    <div className="detail-item full-width">
                      <label>Notes:</label>
                      <div className="notes-content">{selectedInspection.chip_paint.notes}</div>
                    </div>
                  )}
                </div>

                <h4>Mount Chip in Housing</h4>
                <div className="section-detail-grid">
                  <div className="detail-item">
                    <label>Status:</label>
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedInspection.mount_chip_housing?.status) }}
                    >
                      {getStatusLabel(selectedInspection.mount_chip_housing?.status)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <label>Pass/Fail:</label>
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedInspection.mount_chip_housing?.pass_fail) }}
                    >
                      {getStatusLabel(selectedInspection.mount_chip_housing?.pass_fail)}
                    </span>
                  </div>
                  {selectedInspection.mount_chip_housing?.housing_serial && (
                    <div className="detail-item">
                      <label>Housing Serial:</label>
                      <span>{selectedInspection.mount_chip_housing.housing_serial}</span>
                    </div>
                  )}
                  {selectedInspection.mount_chip_housing?.bonding_method && (
                    <div className="detail-item">
                      <label>Bonding Method:</label>
                      <span>{selectedInspection.mount_chip_housing.bonding_method}</span>
                    </div>
                  )}
                  {selectedInspection.mount_chip_housing?.notes && (
                    <div className="detail-item full-width">
                      <label>Notes:</label>
                      <div className="notes-content">{selectedInspection.mount_chip_housing.notes}</div>
                    </div>
                  )}
                </div>

                <h4>Mount Termination Chip</h4>
                <div className="section-detail-grid">
                  <div className="detail-item">
                    <label>Status:</label>
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedInspection.mount_termination?.status) }}
                    >
                      {getStatusLabel(selectedInspection.mount_termination?.status)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <label>Pass/Fail:</label>
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedInspection.mount_termination?.pass_fail) }}
                    >
                      {getStatusLabel(selectedInspection.mount_termination?.pass_fail)}
                    </span>
                  </div>
                  {selectedInspection.mount_termination?.termination_chip_serial && (
                    <div className="detail-item">
                      <label>Termination Serial:</label>
                      <span>{selectedInspection.mount_termination.termination_chip_serial}</span>
                    </div>
                  )}
                  {selectedInspection.mount_termination?.connection_method && (
                    <div className="detail-item">
                      <label>Connection Method:</label>
                      <span>{selectedInspection.mount_termination.connection_method}</span>
                    </div>
                  )}
                  {selectedInspection.mount_termination?.notes && (
                    <div className="detail-item full-width">
                      <label>Notes:</label>
                      <div className="notes-content">{selectedInspection.mount_termination.notes}</div>
                    </div>
                  )}
                </div>

                <h4>Epoxy Cure</h4>
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
                  {selectedInspection.epoxy_cure?.epoxy_type && (
                    <div className="detail-item">
                      <label>Epoxy Type:</label>
                      <span>{selectedInspection.epoxy_cure.epoxy_type}</span>
                    </div>
                  )}
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

export default ChipInspection;