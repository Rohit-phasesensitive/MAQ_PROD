// UserManagement.js - React component for user management
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000';

const UserManagement = ({ user, addNotification }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  
  // Form states
  const [createForm, setCreateForm] = useState({
    username: '',
    password: '',
    email: '',
    role: 'viewer'
  });
  
  const [editForm, setEditForm] = useState({
    email: '',
    role: '',
    is_active: true
  });
  
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });
  
  const [errors, setErrors] = useState({});
  const [validating, setValidating] = useState({});

  // Load users on component mount
  useEffect(() => {
    if (user.role === 'admin') {
      fetchUsers();
    }
  }, [user]);

const fetchUsers = async () => {
  try {
    const token = localStorage.getItem('authToken');
    const response = await axios.get(`${API_BASE_URL}/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    // Filter out inactive users
    const activeUsers = response.data.users.filter(user => user.is_active);
    setUsers(activeUsers);
    
  } catch (error) {
    console.error('Failed to fetch users:', error);
    addNotification('Failed to load users', 'error');
  } finally {
    setLoading(false);
  }
};

  // Real-time validation for create form
  const validateField = useCallback(async (field, value) => {
    if (!value) return;
    
    setValidating(prev => ({ ...prev, [field]: true }));
    
    try {
      const token = localStorage.getItem('authToken');
      const params = new URLSearchParams();
      params.append(field, value);
      
      const response = await axios.get(
        `${API_BASE_URL}/admin/users/check-availability?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (!response.data.available) {
        setErrors(prev => ({ ...prev, [field]: response.data.message }));
      } else {
        setErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors[field];
          return newErrors;
        });
      }
    } catch (error) {
      console.error('Validation error:', error);
    } finally {
      setValidating(prev => ({ ...prev, [field]: false }));
    }
  }, []);

  // Debounced validation
  useEffect(() => {
    const timer = setTimeout(() => {
      if (createForm.username.length >= 3) {
        validateField('username', createForm.username);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [createForm.username, validateField]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (createForm.email.includes('@')) {
        validateField('email', createForm.email);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [createForm.email, validateField]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const token = localStorage.getItem('authToken');
      const response = await axios.post(
        `${API_BASE_URL}/admin/users`,
        createForm,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      addNotification(response.data.message, 'success');
      setCreateForm({ username: '', password: '', email: '', role: 'viewer' });
      setShowCreateForm(false);
      setErrors({});
      await fetchUsers();
    } catch (error) {
      const message = error.response?.data?.detail || 'Failed to create user';
      addNotification(message, 'error');
      
      // Handle validation errors
      if (error.response?.status === 422) {
        const validationErrors = {};
        error.response.data.detail.forEach(err => {
          validationErrors[err.loc[1]] = err.msg;
        });
        setErrors(validationErrors);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!editingUser) return;
    
    setLoading(true);
    
    try {
      const token = localStorage.getItem('authToken');
      const response = await axios.put(
        `${API_BASE_URL}/admin/users/${editingUser.id}`,
        editForm,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      addNotification(response.data.message, 'success');
      setEditingUser(null);
      setEditForm({ email: '', role: '', is_active: true });
      await fetchUsers();
    } catch (error) {
      const message = error.response?.data?.detail || 'Failed to update user';
      addNotification(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId, username) => {
  if (!window.confirm(`Are you sure you want to delete user "${username}"?`)) {
    return;
  }
  
  try {
    const token = localStorage.getItem('authToken');
    const response = await axios.delete(
      `${API_BASE_URL}/admin/users/${userId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    addNotification(response.data.message, 'success');
    
    // Remove user from frontend state immediately
    setUsers(prevUsers => prevUsers.filter(user => user.id !== userId));
    
  } catch (error) {
    const message = error.response?.data?.detail || 'Failed to delete user';
    addNotification(message, 'error');
  }
};

  const handleChangePassword = async (e) => {
    e.preventDefault();
    
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      addNotification('New passwords do not match', 'error');
      return;
    }
    
    setLoading(true);
    
    try {
      const token = localStorage.getItem('authToken');
      const response = await axios.post(
        `${API_BASE_URL}/auth/change-password`,
        {
          current_password: passwordForm.current_password,
          new_password: passwordForm.new_password
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      addNotification(response.data.message, 'success');
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      setShowPasswordForm(false);
    } catch (error) {
      const message = error.response?.data?.detail || 'Failed to change password';
      addNotification(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const startEditUser = (userToEdit) => {
    setEditingUser(userToEdit);
    setEditForm({
      email: userToEdit.email || '',
      role: userToEdit.role || '',
      is_active: userToEdit.is_active
    });
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'admin': return '#e74c3c';
      case 'operator': return '#f39c12';
      case 'viewer': return '#27ae60';
      default: return '#95a5a6';
    }
  };

  const getStatusColor = (isActive) => {
    return isActive ? '#27ae60' : '#e74c3c';
  };

  if (user.role !== 'admin') {
    return (
      <div className="user-management">
        <div className="access-denied">
          <h2>🔒 Access Denied</h2>
          <p>You need admin privileges to access user management.</p>
          
          {/* Personal password change form */}
          <div className="personal-settings">
            <h3>👤 Personal Settings</h3>
            <button 
              onClick={() => setShowPasswordForm(!showPasswordForm)}
              className="quick-action-btn"
              style={{ marginBottom: '20px' }}
            >
              🔑 Change My Password
            </button>
            
            {showPasswordForm && (
              <div className="password-form">
                <form onSubmit={handleChangePassword}>
                  <div className="form-group">
                    <label>Current Password</label>
                    <input
                      type="password"
                      value={passwordForm.current_password}
                      onChange={(e) => setPasswordForm(prev => ({ 
                        ...prev, current_password: e.target.value 
                      }))}
                      required
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>New Password</label>
                    <input
                      type="password"
                      value={passwordForm.new_password}
                      onChange={(e) => setPasswordForm(prev => ({ 
                        ...prev, new_password: e.target.value 
                      }))}
                      required
                      minLength={6}
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Confirm New Password</label>
                    <input
                      type="password"
                      value={passwordForm.confirm_password}
                      onChange={(e) => setPasswordForm(prev => ({ 
                        ...prev, confirm_password: e.target.value 
                      }))}
                      required
                      minLength={6}
                    />
                  </div>
                  
                  <div className="form-actions">
                    <button type="submit" className="quick-action-btn" disabled={loading}>
                      {loading ? 'Changing...' : 'Change Password'}
                    </button>
                    <button 
                      type="button" 
                      onClick={() => setShowPasswordForm(false)}
                      className="quick-action-btn"
                      style={{ background: '#95a5a6' }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="user-management">
      <div className="user-management-header">
        <h2>👥 User Management</h2>
        <div className="header-actions">
          <button 
            onClick={() => setShowPasswordForm(!showPasswordForm)}
            className="quick-action-btn"
            style={{ marginRight: '10px' }}
          >
            🔑 Change My Password
          </button>
          <button 
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="quick-action-btn"
          >
            ➕ Create New User
          </button>
        </div>
      </div>

      {/* Personal Password Change Form */}
      {showPasswordForm && (
        <div className="dashboard-card" style={{ marginBottom: '20px' }}>
          <h3>🔑 Change My Password</h3>
          <form onSubmit={handleChangePassword}>
            <div className="form-row">
              <div className="form-group">
                <label>Current Password</label>
                <input
                  type="password"
                  value={passwordForm.current_password}
                  onChange={(e) => setPasswordForm(prev => ({ 
                    ...prev, current_password: e.target.value 
                  }))}
                  required
                />
              </div>
              
              <div className="form-group">
                <label>New Password</label>
                <input
                  type="password"
                  value={passwordForm.new_password}
                  onChange={(e) => setPasswordForm(prev => ({ 
                    ...prev, new_password: e.target.value 
                  }))}
                  required
                  minLength={6}
                />
              </div>
              
              <div className="form-group">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  value={passwordForm.confirm_password}
                  onChange={(e) => setPasswordForm(prev => ({ 
                    ...prev, confirm_password: e.target.value 
                  }))}
                  required
                  minLength={6}
                />
              </div>
            </div>
            
            <div className="form-actions">
              <button type="submit" className="quick-action-btn" disabled={loading}>
                {loading ? 'Changing...' : 'Change Password'}
              </button>
              <button 
                type="button" 
                onClick={() => setShowPasswordForm(false)}
                className="quick-action-btn"
                style={{ background: '#95a5a6' }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Create User Form */}
      {showCreateForm && (
        <div className="dashboard-card" style={{ marginBottom: '20px' }}>
          <h3>➕ Create New User</h3>
          <form onSubmit={handleCreateUser}>
            <div className="form-row">
              <div className="form-group">
                <label>Username</label>
                <input
                  type="text"
                  value={createForm.username}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, username: e.target.value }))}
                  required
                  minLength={3}
                  maxLength={50}
                  pattern="[a-zA-Z0-9_-]+"
                  title="Username can only contain letters, numbers, hyphens, and underscores"
                />
                {validating.username && <small>Checking availability...</small>}
                {errors.username && <small className="error">{errors.username}</small>}
              </div>
              
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, email: e.target.value }))}
                  required
                />
                {validating.email && <small>Checking availability...</small>}
                {errors.email && <small className="error">{errors.email}</small>}
              </div>
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, password: e.target.value }))}
                  required
                  minLength={6}
                  maxLength={100}
                />
                {errors.password && <small className="error">{errors.password}</small>}
              </div>
              
              <div className="form-group">
                <label>Role</label>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, role: e.target.value }))}
                  required
                >
                  <option value="viewer">Viewer</option>
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            
            <div className="form-actions">
              <button 
                type="submit" 
                className="quick-action-btn" 
                disabled={loading || Object.keys(errors).length > 0}
              >
                {loading ? 'Creating...' : 'Create User'}
              </button>
              <button 
                type="button" 
                onClick={() => {
                  setShowCreateForm(false);
                  setCreateForm({ username: '', password: '', email: '', role: 'viewer' });
                  setErrors({});
                }}
                className="quick-action-btn"
                style={{ background: '#95a5a6' }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit User Form */}
      {editingUser && (
        <div className="dashboard-card" style={{ marginBottom: '20px' }}>
          <h3>✏️ Edit User: {editingUser.username}</h3>
          <form onSubmit={handleUpdateUser}>
            <div className="form-row">
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>
              
              <div className="form-group">
                <label>Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm(prev => ({ ...prev, role: e.target.value }))}
                >
                  <option value="viewer">Viewer</option>
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Status</label>
                <select
                  value={editForm.is_active}
                  onChange={(e) => setEditForm(prev => ({ ...prev, is_active: e.target.value === 'true' }))}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            </div>
            
            <div className="form-actions">
              <button type="submit" className="quick-action-btn" disabled={loading}>
                {loading ? 'Updating...' : 'Update User'}
              </button>
              <button 
                type="button" 
                onClick={() => setEditingUser(null)}
                className="quick-action-btn"
                style={{ background: '#95a5a6' }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users Table */}
      <div className="dashboard-card">
        <h3>👥 All Users ({users.length})</h3>
        
        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div className="loading-spinner"></div>
            <p>Loading users...</p>
          </div>
        ) : (
          <div className="users-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e1e5e9' }}>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Username</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Email</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>Role</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>Created</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>Last Login</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(userItem => (
                  <tr key={userItem.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ fontWeight: '600' }}>{userItem.username}</span>
                        {userItem.id === user.id && (
                          <span style={{ 
                            marginLeft: '8px', 
                            fontSize: '0.8rem', 
                            background: '#667eea', 
                            color: 'white', 
                            padding: '2px 6px', 
                            borderRadius: '10px' 
                          }}>
                            You
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '12px' }}>{userItem.email || 'No email'}</td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <span style={{ 
                        background: getRoleColor(userItem.role), 
                        color: 'white', 
                        padding: '4px 8px', 
                        borderRadius: '12px', 
                        fontSize: '0.8rem',
                        fontWeight: '600'
                      }}>
                        {userItem.role.charAt(0).toUpperCase() + userItem.role.slice(1)}
                      </span>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <span style={{ 
                        background: getStatusColor(userItem.is_active), 
                        color: 'white', 
                        padding: '4px 8px', 
                        borderRadius: '12px', 
                        fontSize: '0.8rem',
                        fontWeight: '600'
                      }}>
                        {userItem.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center', fontSize: '0.9rem', color: '#666' }}>
                      {new Date(userItem.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center', fontSize: '0.9rem', color: '#666' }}>
                      {userItem.last_login ? new Date(userItem.last_login).toLocaleDateString() : 'Never'}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                        <button
                          onClick={() => startEditUser(userItem)}
                          style={{
                            background: '#f39c12',
                            color: 'white',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '0.8rem'
                          }}
                          title="Edit user"
                        >
                          ✏️ Edit
                        </button>
                        
                        {userItem.id !== user.id && (
                          <button
                            onClick={() => handleDeleteUser(userItem.id, userItem.username)}
                            style={{
                              background: '#e74c3c',
                              color: 'white',
                              border: 'none',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '0.8rem'
                            }}
                            title="Deactivate user"
                          >
                            🗑️ Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {users.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                <p>No users found.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* User Statistics */}
      <div className="dashboard-grid" style={{ marginTop: '20px' }}>
        <div className="dashboard-card">
          <h3>📊 User Statistics</h3>
          <div className="activity-stats">
            <div>Total Users: <strong>{users.length}</strong></div>
            <div>Active Users: <strong>{users.filter(u => u.is_active).length}</strong></div>
            <div>Admins: <strong>{users.filter(u => u.role === 'admin').length}</strong></div>
            <div>Operators: <strong>{users.filter(u => u.role === 'operator').length}</strong></div>
            <div>Viewers: <strong>{users.filter(u => u.role === 'viewer').length}</strong></div>
          </div>
        </div>
        
        <div className="dashboard-card">
          <h3>🔒 Security Info</h3>
          <div className="activity-stats">
            <div>Password Policy: <strong>Min 6 characters</strong></div>
            <div>Session Timeout: <strong>10 minutes</strong></div>
            <div>User Roles: <strong>Admin, Operator, Viewer</strong></div>
            <div>Account Status: <strong>Active/Inactive</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const additionalCSS = `
/* User Management Specific Styles */
.user-management {
  max-width: 1400px;
  margin: 0 auto;
}

.user-management-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.form-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.users-table {
  overflow-x: auto;
}

.users-table table {
  min-width: 800px;
}

.error {
  color: #e74c3c;
  font-size: 0.8rem;
  margin-top: 4px;
  display: block;
}

.access-denied {
  text-align: center;
  padding: 60px 20px;
  background: white;
  border-radius: 15px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

.personal-settings {
  margin-top: 40px;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 10px;
}

.password-form {
  margin-top: 20px;
  padding: 20px;
  background: white;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
}

@media (max-width: 768px) {
  .user-management-header {
    flex-direction: column;
    gap: 15px;
    align-items: stretch;
  }
  
  
  .header-actions {
    justify-content: center;
  }
  
  .form-row {
    grid-template-columns: 1fr;
  }
  
  .form-actions {
    flex-direction: column;
  }
  
  .users-table {
    font-size: 0.9rem;
  }
}
`;

export default UserManagement;