import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './App.css';
import Webbapp from './dashboard';
// Import sub-applications (these would be separate components)
import S11TestingApp from './modules/S11TestingApp';
import ChipinspectionApp from './modules/ChipinspectionApp';
import DCvpitestingApp from './modules/DCvpitestingApp';
import FiberattachApp from './modules/FiberattachApp';
import HousingprepApp from './modules/HousingprepApp';
import PDattachApp from './modules/PDattachApp';
import RFvpitestingApp from './modules/RFvpitestingApp';
import S21TestingApp from './modules/S21TestingApp';
import TwotonetestingApp from './modules/TwotonetestingApp';
import WirebondApp from './modules/WirebondApp';
import UserManagement from './modules/UserManagement';
import ManufacturingOrders from './modules/ManufacturingOrders';
import TestingWorkflowApp from './TestingWorkflowApp';
import './index.css'; // or './App.css' depending on where Tailwind is imported

const API_BASE_URL = 'http://localhost:8000';

// Constants moved outside component to avoid dependency issues
const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds
const WARNING_TIME = 2 * 60 * 1000; // Warn 2 minutes before timeout

// Session Timer Component - Shows idle timeout
const SessionTimer = ({ lastActivity, onRefresh }) => {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      if (lastActivity) {
        const now = Date.now();
        const timeSinceActivity = now - lastActivity;
        const remaining = Math.max(0, IDLE_TIMEOUT - timeSinceActivity);
        setTimeLeft(Math.floor(remaining / 1000));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [lastActivity]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimerColor = () => {
    if (timeLeft < 120) return '#ef4444'; // Red if less than 2 minutes
    if (timeLeft < 300) return '#f59e0b'; // Orange if less than 5 minutes
    return '#10b981'; // Green otherwise
  };

  const handleActivityReset = () => {
    onRefresh(); // This resets the activity timer
  };

  if (timeLeft <= 0) return null;

  return (
    <div className="session-timer-widget">
      <span style={{ color: getTimerColor() }}>
        💤 Idle timeout: {formatTime(timeLeft)}
      </span>
      {timeLeft < 300 && (
        <button 
          onClick={handleActivityReset} 
          className="refresh-btn"
          title="Reset idle timer"
        >
          👆
        </button>
      )}
    </div>
  );
};

// Tab configuration
const TAB_CONFIG = [
  { id: 'user-management', name: 'User Management', icon: '👥', component: UserManagement, roles: ['admin'] },
  { id: 'Manufacturing-orders', name: 'Create MO', icon: '🆕📝' , component: ManufacturingOrders, roles: ['admin'] },
  { id: 'dashboard', name: 'Dashboard', icon: '🏠', component: null, roles: ['admin', 'viewer'] },
  { id: 'chip-inspection', name: 'Chip Inspection', icon: '🔍', component: ChipinspectionApp, roles: ['admin', 'operator'] },
  { id: 'housing-prep', name: 'Housing Inspection', icon: '🔍', component: HousingprepApp, roles: ['admin', 'operator'] },
  { id: 'wirebond', name: 'Wire Bond', icon: '➖⚪➖', component: WirebondApp, roles: ['admin', 'operator'] },
  { id: 's11-testing', name: 'S11', icon: '📈',component: S11TestingApp, roles: ['admin', 'operator'] },
  { id: 'fiber-attach', name: 'Fiber Attach', icon: '➖🔲➖', component: FiberattachApp, roles: ['admin', 'operator'] },
  { id: 'dcpi-testing', name: 'DCVπ', icon: '📈', component: DCvpitestingApp, roles: ['admin', 'operator'] },
  { id: 's21-testing', name: 'S21', icon: '📈', component: S21TestingApp, roles: ['admin', 'operator'] },
  { id: 'twotone-testing', name: '1 GHz Vπ', icon: '📈', component: TwotonetestingApp, roles: ['admin', 'operator'] },
  { id: 'pd-attach', name: 'PD Attach', icon: '⏹️', component: PDattachApp, roles: ['admin', 'operator'] },
  { id: 'rfvpi-testing', name: 'Phase modulator Vπ', icon: '📶' , component: RFvpitestingApp, roles: ['admin', 'operator'] },
  // {  id: 'testing-workflow', name: 'Test Flow',  icon: '🧪',  component: TestingWorkflowApp,  roles: ['admin', 'operator']},

  
  
  
];

const MAQ_Lab_Manager = () => {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastActivity, setLastActivity] = useState(Date.now());

  // Application state
  const [activeTab, setActiveTab] = useState('dashboard');
  const [notifications, setNotifications] = useState([]);
  const [systemStatus, setSystemStatus] = useState({});

  // Login form state
  const [loginForm, setLoginForm] = useState({
    username: '',
    password: ''
  });
  const [loginError, setLoginError] = useState('');

  // Use useCallback for functions that are dependencies in useEffect
  const addNotification = useCallback((message, type = 'info') => {
    const notification = {
      id: Date.now(),
      message,
      type,
      timestamp: new Date().toISOString()
    };
    setNotifications(prev => [notification, ...prev.slice(0, 9)]);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('authToken');
    setUser(null);
    setIsAuthenticated(false);
    setLastActivity(Date.now());
    setActiveTab('dashboard');
    addNotification('Logged out successfully', 'info');
  }, [addNotification]);

  // Idle timeout configuration - moved to constants outside component

  // Track user activity for idle timeout
  useEffect(() => {
    const resetActivity = () => {
      setLastActivity(Date.now());
    };

    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    if (isAuthenticated) {
      // Add event listeners for user activity
      activityEvents.forEach(event => {
        document.addEventListener(event, resetActivity, true);
      });
    }

    return () => {
      // Cleanup event listeners
      activityEvents.forEach(event => {
        document.removeEventListener(event, resetActivity, true);
      });
    };
  }, [isAuthenticated]);

  // Idle timeout management
  useEffect(() => {
    let idleTimer;
    let warningTimer;

    if (isAuthenticated) {
      const checkIdleTimeout = () => {
        const now = Date.now();
        const timeSinceActivity = now - lastActivity;
        const timeUntilTimeout = IDLE_TIMEOUT - timeSinceActivity;

        if (timeUntilTimeout <= 0) {
          // User has been idle too long
          addNotification('Session expired due to inactivity', 'error');
          handleLogout();
          return;
        }

        // Clear any existing timers
        if (idleTimer) clearTimeout(idleTimer);
        if (warningTimer) clearTimeout(warningTimer);

        // Set warning timer
        const warningTime = timeUntilTimeout - WARNING_TIME;
        if (warningTime > 0) {
          warningTimer = setTimeout(() => {
            addNotification('You will be logged out in 2 minutes due to inactivity', 'warning');
          }, warningTime);
        }

        // Set logout timer
        idleTimer = setTimeout(() => {
          addNotification('Session expired due to inactivity', 'error');
          handleLogout();
        }, timeUntilTimeout);
      };

      checkIdleTimeout();

      // Recheck every time activity changes
      const activityInterval = setInterval(checkIdleTimeout, 60000); // Check every minute

      return () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (warningTimer) clearTimeout(warningTimer);
        clearInterval(activityInterval);
      };
    }
  }, [isAuthenticated, lastActivity, addNotification, handleLogout]);

  useEffect(() => {
    checkAuthStatus();
    if (isAuthenticated) {
      fetchSystemStatus();
      setupNotifications();
    }
  }, [isAuthenticated]);

  useEffect(() => {
  // Check for navigation from testing workflow
  const checkTestNavigation = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const navigateTo = urlParams.get('navigateTo');
    
    if (navigateTo) {
      // Map URLs to tab IDs
      const urlToTabMap = {
        'chip-inspection': 'chip-inspection',
        'housing-prep': 'housing-prep', 
        'wirebond': 'wirebond',
        's11-testing': 's11-testing',
        'fiberattach': 'fiber-attach',
        'dcvpitesting': 'dcpi-testing',
        's21-testing': 's21-testing',
        'twotone-testing': 'twotone-testing',
        'pd-attach': 'pd-attach',
        'rfvpi-testing': 'rfvpi-testing'
      };
      
      const targetTab = urlToTabMap[navigateTo];
      if (targetTab) {
        setActiveTab(targetTab);
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
        addNotification(`Navigated to ${targetTab.replace('-', ' ')} module`, 'info');
      }
    }
    
    // Check for return from test module
    const returnFrom = urlParams.get('returnFrom');
    const testCompleted = urlParams.get('testCompleted');
    
    if (returnFrom === 'testModule' && testCompleted) {
      // Switch back to dashboard (which contains TestingWorkflowApp)
      setActiveTab('dashboard');
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      addNotification('Test completed successfully!', 'success');
    }
  };

  checkTestNavigation();
}, [addNotification]); // Add this as a dependency

  const checkAuthStatus = async () => {
    try {
      const token = localStorage.getItem('authToken');
      if (token) {
        const response = await axios.get(`${API_BASE_URL}/auth/verify`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setUser(response.data.user);
        setIsAuthenticated(true);
        setLastActivity(Date.now()); // Reset activity on auth check
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      localStorage.removeItem('authToken');
      setIsAuthenticated(false);
    }
    setLoading(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoading(true);

    console.log('Attempting login with:', { username: loginForm.username, password: loginForm.password });

    try {
      console.log('Sending request to:', `${API_BASE_URL}/auth/login`);
      const response = await axios.post(`${API_BASE_URL}/auth/login`, loginForm);
      console.log('Login response:', response.data);
      
      const { token, user } = response.data;
      
      localStorage.setItem('authToken', token);
      setUser(user);
      setIsAuthenticated(true);
      setLastActivity(Date.now()); // Reset activity timer
      setLoginForm({ username: '', password: '' });
      
      addNotification(`Welcome ${user.username}! You will be logged out after 10 minutes of inactivity.`, 'success');
      
      console.log('Login successful, user:', user);
    } catch (error) {
      console.error('Login error:', error);
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);
      
      if (error.response?.status === 404) {
        setLoginError('Server not found. Make sure the backend is running on port 8000.');
      } else if (error.response?.status === 401) {
        setLoginError('Invalid username or password');
      } else if (error.code === 'ERR_NETWORK') {
        setLoginError('Cannot connect to server. Please check if the backend is running.');
      } else {
        setLoginError(error.response?.data?.detail || error.message || 'Login failed');
      }
    }
    setLoading(false);
  };

  const fetchSystemStatus = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/system/status`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` }
      });
      setSystemStatus(response.data);
    } catch (error) {
      console.error('Failed to fetch system status:', error);
    }
  };

  const setupNotifications = () => {
    try {
      // Setup WebSocket for real-time notifications
      const ws = new WebSocket(`ws://localhost:8000/ws/notifications?token=${localStorage.getItem('authToken')}`);
      
      ws.onmessage = (event) => {
        const notification = JSON.parse(event.data);
        setNotifications(prev => [notification, ...prev.slice(0, 9)]); // Keep last 10
      };

      ws.onerror = (error) => {
        console.log('WebSocket connection failed:', error);
      };

      return () => ws.close();
    } catch (error) {
      console.log('WebSocket setup failed:', error);
    }
  };

  const getFilteredTabs = () => {
    if (!user) return [];
    return TAB_CONFIG.filter(tab => 
      tab.roles.includes(user.role) || user.role === 'admin'
    );
  };

const renderDashboard = () => (

      <div className="dashboard-grid">
        <div className="dashboard-card">
          {/* <h3>🔔 Recent Notifications</h3>
          <div className="notifications-list">
            {notifications.slice(0, 5).map(notification => (
              <div key={notification.id} className={`notification-item ${notification.type}`}>
                <span className="notification-time">
                  {new Date(notification.timestamp).toLocaleTimeString()}
                </span>
                <span className="notification-message">{notification.message}</span>
              </div>
            ))}
            {notifications.length === 0 && (
              <div className="no-notifications">No recent notifications</div>
            )}
          </div> */}
          <TestingWorkflowApp></TestingWorkflowApp>
        </div>
        
        
          <Webbapp>
          
          </Webbapp>
      {/* </div> */}
    </div>
  );
  const renderActiveModule = () => {
    if (activeTab === 'dashboard') {
      return renderDashboard();
    }

    const activeTabConfig = TAB_CONFIG.find(tab => tab.id === activeTab);
    if (activeTabConfig && activeTabConfig.component) {
      const Component = activeTabConfig.component;
      return <Component user={user} addNotification={addNotification} />;
    }

    return (
      <div className="module-placeholder">
        <h2>{activeTabConfig?.name || 'Module'}</h2>
        <p>This module is under development.</p>
      </div>
    );
  };

  // Loading screen
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="company-logo">
              <img src="/logo.png" alt="Company Logo" className="logo-image" />
            </div>
            <h1>MAQ_Lab_Manager</h1>
            
          </div>

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={loginForm.username}
                onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                placeholder="Enter your username"
                required
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                placeholder="Enter your password"
                required
              />
            </div>

            {loginError && (
              <div className="login-error">{loginError}</div>
            )}

            <button type="submit" disabled={loading} className="login-btn">
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
            
          </form>

          <div className="login-footer">
            <p>Demo Credentials:</p>
            <p><strong>Admin:</strong> admin / admin123</p>
            <p><strong>Operator:</strong> operator / op123</p>
            <p><strong>Viewer:</strong> viewer / view123</p>
          </div>
        </div>
      </div>
    );
  }

  // Main application
  return (
    <div className="unified-app">
      {/* Header */}
      <header className="app-header">
        <div className="nav-logo">
            <img src="/logo.png" alt="Company Logo" className="nav-logo-image" />
          </div>
        <div className="header-left">
          <h1>MAQ_Lab_Manager</h1>
          <span className="version">v1.0</span>
        </div>
        

        <div className="header-center">
          <div className="system-info">
            <span className="current-time">
              {new Date().toLocaleString()}
            </span>
            {isAuthenticated && (
              <div className="session-timer">
                <SessionTimer lastActivity={lastActivity} onRefresh={() => setLastActivity(Date.now())} />
              </div>
            )}
          </div>
        </div>

        <div className="header-right">
          <div className="notifications-badge">
            🔔
            {notifications.length > 0 && (
              <span className="badge-count">{notifications.length}</span>
            )}
          </div>

          <div className="user-info">
            <span className="user-name">👤 {user.username}</span>
            <span className="user-role">({user.role})</span>
            <button onClick={handleLogout} className="logout-btn">Logout</button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="nav-tabs">
        <div className="nav-tabs-left">
          {getFilteredTabs().map(tab => (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tab-icon">{tab.icon}</span>
              <span className="tab-name">{tab.name}</span>
            </button>
          ))}
        </div>
        <div className="nav-tabs-right">
          
        </div>
      </nav>

      {/* Main Content */}
      <main className="main-content">
        {renderActiveModule()}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        
        <div className="footer-right">
          <span>Connected Users: {systemStatus.active_users || 0}</span>
          <span>System Health: {systemStatus.overall || 'Unknown'}</span>
        </div>
      </footer>
    </div>
  );
};

export default MAQ_Lab_Manager;