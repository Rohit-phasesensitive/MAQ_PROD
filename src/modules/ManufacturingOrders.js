// src/modules/ManufacturingOrders.js - Manufacturing Orders Management (No ID Column)

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './ManufacturingOrders.css';

const API_BASE_URL = 'http://localhost:8000';

const ManufacturingOrders = ({ user, addNotification }) => {
  const [activeTab, setActiveTab] = useState('manufacturing-orders');
  const [loading, setLoading] = useState(false);
  const [manufacturingOrders, setManufacturingOrders] = useState([]);
  const [productLines, setProductLines] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showCreateMOModal, setShowCreateMOModal] = useState(false);

  const [newManufacturingOrder, setNewManufacturingOrder] = useState({
    manufacturing_order_number: '',
    customer_name: '',
    product_line: '',
    device_details: [{ device_type: '', quantity: '', description: '' }],
    priority: 'medium',
    due_date: '',
    notes: '',
    file: null
  });

  const [filters, setFilters] = useState({
    status: 'all',
    priority: 'all',
    product_line: 'all'
  });

  const [analytics, setAnalytics] = useState({
    manufacturing_order_stats: {},
    priority_stats: {},
    product_line_stats: [],
    recent_activity: {}
  });

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchManufacturingOrders();
      fetchProductLines();
      fetchDeviceTypes();
      fetchAnalytics();
    }
  }, [user, filters]);

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('authToken')}`
  });

  const fetchManufacturingOrders = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.status !== 'all') params.append('status', filters.status);
      if (filters.priority !== 'all') params.append('priority', filters.priority);
      if (filters.product_line !== 'all') params.append('product_line', filters.product_line);

      const response = await axios.get(`${API_BASE_URL}/admin/manufacturing-orders?${params}`, {
        headers: getAuthHeaders()
      });
      setManufacturingOrders(response.data.orders || []);
    } catch (error) {
      console.error('Error fetching manufacturing orders:', error);
      addNotification('Failed to fetch manufacturing orders', 'error');
    }
  };

  const fetchProductLines = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/admin/product-lines`, {
        headers: getAuthHeaders()
      });
      setProductLines(response.data.product_lines || []);
    } catch (error) {
      console.error('Error fetching product lines:', error);
    }
  };

  const fetchDeviceTypes = async (productLine = null) => {
    try {
      const params = productLine ? `?product_line=${productLine}` : '';
      const response = await axios.get(`${API_BASE_URL}/admin/device-types${params}`, {
        headers: getAuthHeaders()
      });
      setDeviceTypes(response.data.device_types || []);
    } catch (error) {
      console.error('Error fetching device types:', error);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/admin/analytics/summary`, {
        headers: getAuthHeaders()
      });
      setAnalytics(response.data || {});
    } catch (error) {
      console.error('Error fetching analytics:', error);
    }
  };

  const validateDeviceTypes = async (productLine, deviceDetails) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/admin/validate-device-types`, {
        product_line: productLine,
        device_types: deviceDetails.map(d => d.device_type).filter(Boolean)
      }, {
        headers: getAuthHeaders()
      });
      return response.data.valid;
    } catch (error) {
      addNotification('Error validating device types', 'error');
      return false;
    }
  };

  const handleCreateManufacturingOrder = async () => {
    if (user?.role !== 'admin') {
      addNotification('Only admins can create manufacturing orders', 'error');
      return;
    }

    // Validate required fields
    const required = ['manufacturing_order_number', 'customer_name', 'product_line'];
    const missing = required.filter(field => !newManufacturingOrder[field]);
    
    if (missing.length > 0) {
      addNotification(`Please fill in: ${missing.join(', ')}`, 'error');
      return;
    }

    // Validate device details
    const validDevices = newManufacturingOrder.device_details.filter(d => d.device_type && d.quantity);
    if (validDevices.length === 0) {
      addNotification('Please add at least one valid device', 'error');
      return;
    }

    // Validate device types against product line
    const isValid = await validateDeviceTypes(newManufacturingOrder.product_line, validDevices);
    if (!isValid) {
      addNotification('Some device types are not valid for the selected product line', 'error');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('manufacturing_order_number', newManufacturingOrder.manufacturing_order_number);
      formData.append('customer_name', newManufacturingOrder.customer_name);
      formData.append('product_line', newManufacturingOrder.product_line);
      formData.append('device_details', JSON.stringify(validDevices));
      formData.append('priority', newManufacturingOrder.priority);
      if (newManufacturingOrder.due_date) formData.append('due_date', newManufacturingOrder.due_date);
      formData.append('notes', newManufacturingOrder.notes);
      if (newManufacturingOrder.file) formData.append('file', newManufacturingOrder.file);

      await axios.post(`${API_BASE_URL}/admin/manufacturing-orders`, formData, {
        headers: getAuthHeaders()
      });

      addNotification('Manufacturing order created successfully', 'success');
      setShowCreateMOModal(false);
      resetManufacturingOrderForm();
      fetchManufacturingOrders();
    } catch (error) {
      console.error('Error creating manufacturing order:', error);
      addNotification(error.response?.data?.detail || 'Failed to create manufacturing order', 'error');
    }
    setLoading(false);
  };

  const resetManufacturingOrderForm = () => {
    setNewManufacturingOrder({
      manufacturing_order_number: '',
      customer_name: '',
      product_line: '',
      device_details: [{ device_type: '', quantity: '', description: '' }],
      priority: 'medium',
      due_date: '',
      notes: '',
      file: null
    });
  };

  const addDeviceDetail = () => {
    setNewManufacturingOrder(prev => ({
      ...prev,
      device_details: [...prev.device_details, { device_type: '', quantity: '', description: '' }]
    }));
  };

  const removeDeviceDetail = (index) => {
    setNewManufacturingOrder(prev => ({
      ...prev,
      device_details: prev.device_details.filter((_, i) => i !== index)
    }));
  };

  const updateDeviceDetail = (index, field, value) => {
    setNewManufacturingOrder(prev => ({
      ...prev,
      device_details: prev.device_details.map((detail, i) => 
        i === index ? { ...detail, [field]: value } : detail
      )
    }));
  };

  const handleProductLineChange = (productLine) => {
    setNewManufacturingOrder(prev => ({
      ...prev,
      product_line: productLine,
      device_details: [{ device_type: '', quantity: '', description: '' }]
    }));
    fetchDeviceTypes(productLine);
  };

  const updateOrderStatus = async (moNumber, newStatus) => {
    try {
      await axios.put(`${API_BASE_URL}/admin/manufacturing-orders/${moNumber}/status`, {
        status: newStatus
      }, {
        headers: getAuthHeaders()
      });
      
      addNotification('Manufacturing order status updated successfully', 'success');
      fetchManufacturingOrders();
    } catch (error) {
      addNotification('Failed to update manufacturing order status', 'error');
    }
  };

  const downloadFile = async (moNumber, filename) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/admin/manufacturing-orders/${moNumber}/file`, {
        headers: getAuthHeaders(),
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      addNotification('Failed to download file', 'error');
    }
  };

  const generateMONumber = () => {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    const moNumber = `MO${month}${day}${year}-${random}`;
    setNewManufacturingOrder(prev => ({ ...prev, manufacturing_order_number: moNumber }));
  };

  const getStatusColor = (status) => {
    const colors = {
      'pending': '#FF9800',
      'created': '#2196F3',
      'in_progress': '#FF9800', 
      'testing': '#9C27B0',
      'completed': '#4CAF50',
      'on_hold': '#9E9E9E',
      'cancelled': '#F44336'
    };
    return colors[status] || '#666';
  };

  const getPriorityColor = (priority) => {
    const colors = {
      'low': '#4CAF50',
      'medium': '#FF9800',
      'high': '#F44336',
      'urgent': '#E91E63'
    };
    return colors[priority] || '#666';
  };

  if (user?.role !== 'admin') {
    return (
      <div className="mo-module">
        <div className="access-denied">
          <h2>🔒 Access Denied</h2>
          <p>Only administrators can access Manufacturing Order Management.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mo-module">
      {/* Module Header */}
      <div className="module-header">
        <h2>🏭 Manufacturing Order Management</h2>
        <div className="module-actions">
          <button 
            onClick={() => setShowCreateMOModal(true)}
            className="btn btn-primary"
          >
            + Create Manufacturing Order
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button 
          className={`tab-btn ${activeTab === 'manufacturing-orders' ? 'active' : ''}`}
          onClick={() => setActiveTab('manufacturing-orders')}
        >
          🏭 Manufacturing Orders
        </button>
        <button 
          className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          📊 Analytics
        </button>
      </div>

      <div className="module-content">
        {/* Manufacturing Orders Tab */}
        {activeTab === 'manufacturing-orders' && (
          <div className="manufacturing-orders-tab">
            {/* Filters */}
            <div className="filters-section">
              <div className="filters">
                <select 
                  value={filters.status} 
                  onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                >
                  <option value="all">All Status</option>
                  <option value="created">Created</option>
                  <option value="in_progress">In Progress</option>
                  <option value="testing">Testing</option>
                  <option value="completed">Completed</option>
                  <option value="on_hold">On Hold</option>
                  <option value="cancelled">Cancelled</option>
                </select>

                <select 
                  value={filters.priority} 
                  onChange={(e) => setFilters(prev => ({ ...prev, priority: e.target.value }))}
                >
                  <option value="all">All Priorities</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>

                <select 
                  value={filters.product_line} 
                  onChange={(e) => setFilters(prev => ({ ...prev, product_line: e.target.value }))}
                >
                  <option value="all">All Product Lines</option>
                  {productLines.map(line => (
                    <option key={line} value={line}>{line}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Manufacturing Orders Grid */}
            <div className="orders-grid">
              {manufacturingOrders.length === 0 ? (
                <div className="no-data">
                  <p>No manufacturing orders found</p>
                </div>
              ) : (
                manufacturingOrders.map((order) => (
                  <div key={order.manufacturing_order_number} className="order-card">
                    <div className="order-header">
                      <h3>{order.manufacturing_order_number}</h3>
                      <div className="order-badges">
                        <span 
                          className="status-badge"
                          style={{ backgroundColor: getStatusColor(order.status) }}
                        >
                          {order.status.replace('_', ' ').toUpperCase()}
                        </span>
                        <span 
                          className="priority-badge"
                          style={{ backgroundColor: getPriorityColor(order.priority) }}
                        >
                          {order.priority.toUpperCase()}
                        </span>
                        <span className="product-line-badge">
                          {order.product_line}
                        </span>
                      </div>
                    </div>

                    <div className="order-details">
                      <div className="detail-row">
                        <span className="label">Customer:</span>
                        <span className="value">{order.customer_name}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Total Devices:</span>
                        <span className="value">
                          {order.device_details?.reduce((sum, device) => 
                            sum + parseInt(device.quantity || 0), 0)} units
                        </span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Device Types:</span>
                        <span className="value">{order.device_details?.length || 0} types</span>
                      </div>
                      {order.due_date && (
                        <div className="detail-row">
                          <span className="label">Due Date:</span>
                          <span className="value">{new Date(order.due_date).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>

                    <div className="order-actions">
                      <button 
                        onClick={() => setSelectedOrder(order)}
                        className="btn btn-sm btn-primary"
                      >
                        View Details
                      </button>
                      
                      {order.has_file && (
                        <button 
                          onClick={() => downloadFile(order.manufacturing_order_number, order.original_filename)}
                          className="btn btn-sm btn-secondary"
                        >
                          📄 Download
                        </button>
                      )}
                      
                      <select
                        value={order.status}
                        onChange={(e) => updateOrderStatus(order.manufacturing_order_number, e.target.value)}
                        className="status-select"
                      >
                        <option value="created">Created</option>
                        <option value="in_progress">In Progress</option>
                        <option value="testing">Testing</option>
                        <option value="completed">Completed</option>
                        <option value="on_hold">On Hold</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="analytics-tab">
            <div className="analytics-cards">
              <div className="analytics-card">
                <h3>Total Manufacturing Orders</h3>
                <div className="metric">{manufacturingOrders.length}</div>
              </div>
              <div className="analytics-card">
                <h3>Active Orders</h3>
                <div className="metric">
                  {manufacturingOrders.filter(o => ['created', 'in_progress', 'testing'].includes(o.status)).length}
                </div>
              </div>
              <div className="analytics-card">
                <h3>High Priority Orders</h3>
                <div className="metric">
                  {manufacturingOrders.filter(o => ['high', 'urgent'].includes(o.priority)).length}
                </div>
              </div>
              <div className="analytics-card">
                <h3>This Week</h3>
                <div className="metric">{analytics.recent_activity?.mo_this_week || 0}</div>
              </div>
            </div>

            {/* Product Line Analytics */}
            <div className="product-line-analytics">
              <h3>Product Line Breakdown</h3>
              <div className="product-line-grid">
                {productLines.map(productLine => {
                  const lineOrders = manufacturingOrders.filter(o => o.product_line === productLine);
                  
                  return (
                    <div key={productLine} className="product-line-card">
                      <h4>{productLine}</h4>
                      <div className="line-stats">
                        <div className="stat">
                          <span className="stat-label">Manufacturing Orders:</span>
                          <span className="stat-value">{lineOrders.length}</span>
                        </div>
                        <div className="stat">
                          <span className="stat-label">Total Devices:</span>
                          <span className="stat-value">
                            {lineOrders.reduce((sum, mo) => 
                              sum + mo.device_details.reduce((deviceSum, device) => 
                                deviceSum + parseInt(device.quantity || 0), 0), 0)}
                          </span>
                        </div>
                        <div className="stat">
                          <span className="stat-label">Active Orders:</span>
                          <span className="stat-value">
                            {lineOrders.filter(o => ['created', 'in_progress', 'testing'].includes(o.status)).length}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create Manufacturing Order Modal */}
      {showCreateMOModal && (
        <div className="modal-overlay" onClick={() => setShowCreateMOModal(false)}>
          <div className="modal-content create-mo-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Manufacturing Order</h3>
              <button onClick={() => setShowCreateMOModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Manufacturing Order Number *</label>
                  <div className="input-with-button">
                    <input
                      type="text"
                      value={newManufacturingOrder.manufacturing_order_number}
                      onChange={(e) => setNewManufacturingOrder(prev => ({ ...prev, manufacturing_order_number: e.target.value }))}
                      placeholder="Enter MO number"
                    />
                    <button onClick={generateMONumber} className="btn btn-sm btn-secondary">
                      Auto Generate
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label>Customer Name *</label>
                  <input
                    type="text"
                    value={newManufacturingOrder.customer_name}
                    onChange={(e) => setNewManufacturingOrder(prev => ({ ...prev, customer_name: e.target.value }))}
                    placeholder="Enter customer name"
                  />
                </div>

                <div className="form-group">
                  <label>Product Line *</label>
                  <select
                    value={newManufacturingOrder.product_line}
                    onChange={(e) => handleProductLineChange(e.target.value)}
                  >
                    <option value="">Select product line</option>
                    {productLines.map(line => (
                      <option key={line} value={line}>{line}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Priority</label>
                  <select
                    value={newManufacturingOrder.priority}
                    onChange={(e) => setNewManufacturingOrder(prev => ({ ...prev, priority: e.target.value }))}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Due Date</label>
                  <input
                    type="date"
                    value={newManufacturingOrder.due_date}
                    onChange={(e) => setNewManufacturingOrder(prev => ({ ...prev, due_date: e.target.value }))}
                  />
                </div>

                <div className="form-group full-width">
                  <label>Order File</label>
                  <input
                    type="file"
                    onChange={(e) => setNewManufacturingOrder(prev => ({ ...prev, file: e.target.files[0] }))}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                  />
                  <small>Accepted formats: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG (Max 10MB)</small>
                </div>
              </div>

              {/* Device Details Section */}
              <div className="device-details-section">
                <div className="section-header">
                  <h4>Device Details</h4>
                  <button 
                    type="button" 
                    onClick={addDeviceDetail} 
                    className="btn btn-sm btn-secondary"
                    disabled={!newManufacturingOrder.product_line}
                  >
                    + Add Device
                  </button>
                </div>

                {newManufacturingOrder.device_details.map((device, index) => (
                  <div key={index} className="device-detail-row">
                    <div className="device-form-grid">
                      <div className="form-group">
                        <label>Device Type *</label>
                        <select
                          value={device.device_type}
                          onChange={(e) => updateDeviceDetail(index, 'device_type', e.target.value)}
                          disabled={!newManufacturingOrder.product_line}
                        >
                          <option value="">Select device type</option>
                          {deviceTypes.map(type => (
                            <option key={type.device_type} value={type.device_type}>
                              {type.device_type} - {type.description}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Quantity *</label>
                        <input
                          type="number"
                          value={device.quantity}
                          onChange={(e) => updateDeviceDetail(index, 'quantity', e.target.value)}
                          placeholder=""
                          min="1"
                        />
                      </div>

                      <div className="form-group">
                        <label>Description</label>
                        <input
                          type="text"
                          value={device.description}
                          onChange={(e) => updateDeviceDetail(index, 'description', e.target.value)}
                          placeholder="Optional description"
                        />
                      </div>

                      <div className="form-group">
                        <button 
                          type="button" 
                          onClick={() => removeDeviceDetail(index)} 
                          className="btn btn-sm btn-danger"
                          disabled={newManufacturingOrder.device_details.length === 1}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="form-group full-width">
                <label>Notes</label>
                <textarea
                  value={newManufacturingOrder.notes}
                  onChange={(e) => setNewManufacturingOrder(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Enter any additional notes..."
                  rows={3}
                />
              </div>

              <div className="modal-actions">
                <button 
                  onClick={() => setShowCreateMOModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleCreateManufacturingOrder}
                  disabled={loading}
                  className="btn btn-primary"
                >
                  {loading ? 'Creating...' : 'Create Manufacturing Order'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order Details Modal */}
      {selectedOrder && (
        <div className="modal-overlay" onClick={() => setSelectedOrder(null)}>
          <div className="modal-content order-details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Manufacturing Order Details - {selectedOrder.manufacturing_order_number}</h3>
              <button onClick={() => setSelectedOrder(null)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <label>Manufacturing Order Number:</label>
                  <span>{selectedOrder.manufacturing_order_number}</span>
                </div>
                <div className="detail-item">
                  <label>Customer Name:</label>
                  <span>{selectedOrder.customer_name}</span>
                </div>
                <div className="detail-item">
                  <label>Product Line:</label>
                  <span>{selectedOrder.product_line}</span>
                </div>
                <div className="detail-item">
                  <label>Status:</label>
                  <span 
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(selectedOrder.status) }}
                  >
                    {selectedOrder.status.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
                <div className="detail-item">
                  <label>Priority:</label>
                  <span 
                    className="priority-badge"
                    style={{ backgroundColor: getPriorityColor(selectedOrder.priority) }}
                  >
                    {selectedOrder.priority.toUpperCase()}
                  </span>
                </div>
                <div className="detail-item">
                  <label>Created:</label>
                  <span>{new Date(selectedOrder.created_at).toLocaleString()}</span>
                </div>
                {/* <div className="detail-item">
                  <label>Created By:</label>
                  <span>{selectedOrder.created_by_username}</span>
                </div> */}
                {selectedOrder.due_date && (
                  <div className="detail-item">
                    <label>Due Date:</label>
                    <span>{new Date(selectedOrder.due_date).toLocaleDateString()}</span>
                  </div>
                )}
                
                {/* Device Details */}
                <div className="detail-item full-width">
                  <label>Device Details:</label>
                  <div className="device-details-list">
                    {selectedOrder.device_details?.map((device, index) => (
                      <div key={index} className="device-detail-item">
                        <strong>{device.device_type}</strong> - Quantity: {device.quantity}
                        {device.description && <div className="device-description">{device.description}</div>}
                      </div>
                    ))}
                  </div>
                </div>
                
                {selectedOrder.notes && (
                  <div className="detail-item full-width">
                    <label>Notes:</label>
                    <div className="notes-content">{selectedOrder.notes}</div>
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

export default ManufacturingOrders;