import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899'];

// API Configuration
const API_BASE_URL = 'http://localhost:8000';

// API Service Functions
const apiService = {
  async fetchSystemStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/system-status`);
      if (!response.ok) throw new Error('Failed to fetch system status');
      const data = await response.json();
      console.log('System Status API Response:', data); // Debug log
      return data;
    } catch (error) {
      console.error('Error fetching system status:', error);
      return {
        overall: 'offline',
        vna: 'offline',
        database: 'offline',
        storage: 'offline',
        tests_today: 0,
        success_rate: 0,
        active_users: 0
      };
    }
  },

  async fetchAnalyticsData() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/dashboard`);
      if (!response.ok) throw new Error('Failed to fetch analytics data');
      const data = await response.json();
      console.log('Analytics API Response:', data); // Debug log
      return data;
    } catch (error) {
      console.error('Error fetching analytics data:', error);
      return {
        chipInspection: { totalProcessed: 0, passed: 0, failed: 0, successRate: 0, avgProcessingTime: 0, recentActivity: [] },
        housingPrep: { totalProcessed: 0, passed: 0, failed: 0, successRate: 0, avgProcessingTime: 0, recentActivity: [] },
        wireBond: { totalProcessed: 0, passed: 0, failed: 0, successRate: 0, avgProcessingTime: 0, recentActivity: [] },
        s11Testing: { totalProcessed: 0, passed: 0, failed: 0, successRate: 0, avgProcessingTime: 0, recentActivity: [] },
        fiberAttach: { totalProcessed: 0, passed: 0, failed: 0, successRate: 0, avgProcessingTime: 0, recentActivity: [] },
        dcpiTesting: { totalProcessed: 0, passed: 0, failed: 0, successRate: 0, avgProcessingTime: 0, recentActivity: [] }
      };
    }
  },

  async fetchStageData(stageName) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/stages/${stageName}/analytics`);
      if (!response.ok) throw new Error(`Failed to fetch ${stageName} data`);
      const data = await response.json();
      console.log(`${stageName} API Response:`, data); // Debug log
      return data;
    } catch (error) {
      console.error(`Error fetching ${stageName} data:`, error);
      return { totalProcessed: 0, passed: 0, failed: 0, successRate: 0, avgProcessingTime: 0, recentActivity: [] };
    }
  }
};

// Debug Panel Component
const DebugPanel = ({ systemStatus, analyticsData, isVisible, onToggle }) => {
  if (!isVisible) {
    return (
      <button
        onClick={onToggle}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          padding: '10px 15px',
          backgroundColor: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '14px',
          zIndex: 1000
        }}
      >
        Show Debug Info
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      width: '400px',
      maxHeight: '70vh',
      backgroundColor: 'white',
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      overflow: 'auto',
      zIndex: 1000
    }}>
      <div style={{
        padding: '15px',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h3 style={{ margin: 0, fontSize: '16px' }}>Debug Information</h3>
        <button
          onClick={onToggle}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '18px',
            cursor: 'pointer',
            color: '#6b7280'
          }}
        >
          ×
        </button>
      </div>
      
      {/* <div style={{ padding: '15px' }}>
        <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#374151' }}>System Status Raw Data:</h4>
        <pre style={{
          backgroundColor: '#f9fafb',
          padding: '10px',
          borderRadius: '4px',
          fontSize: '12px',
          overflow: 'auto',
          marginBottom: '15px'
        }}>
          {JSON.stringify(systemStatus, null, 2)}
        </pre>
        
        <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#374151' }}>Analytics Data Raw Data:</h4>
        <pre style={{
          backgroundColor: '#f9fafb',
          padding: '10px',
          borderRadius: '4px',
          fontSize: '12px',
          overflow: 'auto'
        }}>
          {JSON.stringify(analyticsData, null, 2)}
        </pre>
      </div> */}
    </div>
  );
};

// Loading Component
const LoadingSpinner = () => (
  <div style={{
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100px'
  }}>
    <div style={{
      width: '32px',
      height: '32px',
      border: '3px solid #f3f4f6',
      borderTop: '3px solid #3b82f6',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    }}></div>
    <style>{`
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

// Error Component
const ErrorMessage = ({ message, onRetry }) => (
  <div style={{
    padding: '20px',
    backgroundColor: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    color: '#991b1b',
    textAlign: 'center'
  }}>
    <p style={{ margin: '0 0 12px 0' }}>⚠️ {message}</p>
    <button
      onClick={onRetry}
      style={{
        padding: '8px 16px',
        backgroundColor: '#dc2626',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer'
      }}
    >
      Retry
    </button>
  </div>
);

// Connection Status Indicator
const ConnectionStatus = ({ isConnected, isLoading }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '14px',
    backgroundColor: isConnected ? '#dcfce7' : '#fee2e2',
    color: isConnected ? '#166534' : '#991b1b',
    border: `1px solid ${isConnected ? '#bbf7d0' : '#fecaca'}`
  }}>
    <div style={{
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      backgroundColor: isLoading ? '#f59e0b' : (isConnected ? '#22c55e' : '#ef4444')
    }}></div>
    {isLoading ? 'Connecting...' : (isConnected ? 'Connected to Backend' : 'Backend Offline')}
  </div>
);

// Stage Analytics Card Component
const StageAnalyticsCard = ({ title, data, icon, isLoading, error, onRetry }) => {
  if (isLoading) return <div style={{ background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb' }}><LoadingSpinner /></div>;
  if (error) return <div style={{ background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', border: '1px solid #e5e7eb' }}><ErrorMessage message={error} onRetry={onRetry} /></div>;

  // More flexible data access - try different possible field names
  const totalProcessed = data.totalProcessed || data.total_processed || data.processed || 0;
  const passed = data.passed || data.success || data.successful || 0;
  const failed = data.failed || data.failure || data.error || 0;
  const avgProcessingTime = data.avgProcessingTime || data.avg_processing_time || data.average_time || 0;
  const successRate = totalProcessed > 0 ? ((passed / totalProcessed) * 100).toFixed(1) : 0;
  
  console.log(`${title} - Processed data:`, { totalProcessed, passed, failed, successRate, avgProcessingTime }); // Debug log
  
  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      padding: '20px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      border: '1px solid #e5e7eb'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px'
      }}>
        <h3 style={{
          margin: 0,
          color: '#1f2937',
          fontSize: '16px',
          fontWeight: '600'
        }}>
          {icon} {title}
        </h3>
        <span style={{
          padding: '4px 8px',
          borderRadius: '12px',
          fontSize: '12px',
          fontWeight: '500',
          background: successRate > 95 ? '#dcfce7' : successRate > 90 ? '#fef3c7' : '#fecaca',
          color: successRate > 95 ? '#166534' : successRate > 90 ? '#92400e' : '#991b1b'
        }}>
          {successRate}% Success
        </span>
      </div>
      
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '12px',
        marginBottom: '16px'
      }}>
        <div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Total Processed</div>
          <div style={{ fontSize: '20px', fontWeight: '600', color: '#1f2937' }}>{totalProcessed}</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Avg Time (sec)</div>
          <div style={{ fontSize: '20px', fontWeight: '600', color: '#1f2937' }}>{avgProcessingTime}</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Passed</div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: '#059669' }}>{passed}</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Failed</div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: '#dc2626' }}>{failed}</div>
        </div>
      </div>
      
      <div style={{ height: '120px' }}>
        {data.recentActivity && data.recentActivity.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.recentActivity}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="time" fontSize={10} />
              <YAxis fontSize={10} />
              <Tooltip />
              <Line type="monotone" dataKey="processed" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>
            No recent activity data
          </div>
        )}
      </div>
    </div>
  );
};

// Main Dashboard Component
const ConnectedDashboard = () => {
  const [activeView, setActiveView] = useState('overview');
  const [systemStatus, setSystemStatus] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const [statusData, analyticsData] = await Promise.all([
        apiService.fetchSystemStatus(),
        apiService.fetchAnalyticsData()
      ]);
      
      console.log('Fetched status data:', statusData);
      console.log('Fetched analytics data:', analyticsData);
      
      setSystemStatus(statusData);
      setAnalyticsData(analyticsData);
      setIsConnected(true);
    } catch (err) {
      console.error('Fetch error:', err);
      setError('Failed to connect to backend');
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    
    // Set up periodic refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRetry = () => {
    fetchData();
  };

  if (isLoading && !systemStatus) {
    return (
      <div style={{ padding: '20px', backgroundColor: '#f9fafb', minHeight: '100vh' }}>
        <LoadingSpinner />
      </div>
    );
  }

  if (error && !systemStatus) {
    return (
      <div style={{ padding: '20px', backgroundColor: '#f9fafb', minHeight: '100vh' }}>
        <ErrorMessage message={error} onRetry={handleRetry} />
      </div>
    );
  }

  // More flexible data processing - handle different possible structures
  const processStageData = (stageData) => {
    if (!stageData) return { totalProcessed: 0, passed: 0, failed: 0 };
    
    return {
      totalProcessed: stageData.totalProcessed || stageData.total_processed || stageData.processed || 0,
      passed: stageData.passed || stageData.success || stageData.successful || 0,
      failed: stageData.failed || stageData.failure || stageData.error || 0
    };
  };

  const overallStats = analyticsData ? {
    totalProcessed: Object.values(analyticsData).reduce((sum, stage) => {
      const processed = processStageData(stage);
      return sum + processed.totalProcessed;
    }, 0),
    totalPassed: Object.values(analyticsData).reduce((sum, stage) => {
      const processed = processStageData(stage);
      return sum + processed.passed;
    }, 0),
    totalFailed: Object.values(analyticsData).reduce((sum, stage) => {
      const processed = processStageData(stage);
      return sum + processed.failed;
    }, 0),
  } : { totalProcessed: 0, totalPassed: 0, totalFailed: 0 };
  
  console.log('Overall stats:', overallStats); // Debug log
  
  const stageComparison = analyticsData ? [
    { name: 'Chip Inspection', ...processStageData(analyticsData.chipInspection) },
    { name: 'Housing Prep', ...processStageData(analyticsData.housingPrep) },
    { name: 'Wire Bond', ...processStageData(analyticsData.wireBond) },
    { name: 'S11 Testing', ...processStageData(analyticsData.s11Testing) },
    { name: 'Fiber Attach', ...processStageData(analyticsData.fiberAttach) },
    { name: 'DCVπ Testing', ...processStageData(analyticsData.dcpiTesting) }
  ].map(stage => ({
    ...stage,
    successRate: stage.totalProcessed > 0 ? ((stage.passed / stage.totalProcessed) * 100).toFixed(1) : 0
  })) : [];
  
  const pieData = [
    { name: 'Passed', value: overallStats.totalPassed, color: '#10b981' },
    { name: 'Failed', value: overallStats.totalFailed, color: '#ef4444' }
  ];

  return (
    <div style={{
      padding: '20px',
      backgroundColor: '#f9fafb',
      minHeight: '100vh'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px'
      }}>
        <div>
          <h1 style={{
            margin: 0,
            color: '#1f2937',
            fontSize: '28px',
            fontWeight: '700'
          }}>
            Production Analytics
          </h1>
          {/*  */}
        </div>
        
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <ConnectionStatus isConnected={isConnected} isLoading={isLoading} />
          
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveView('overview')}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: activeView === 'overview' ? '2px solid #3b82f6' : '1px solid #d1d5db',
                background: activeView === 'overview' ? '#eff6ff' : 'white',
                color: activeView === 'overview' ? '#1d4ed8' : '#374151',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveView('stages')}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: activeView === 'stages' ? '2px solid #3b82f6' : '1px solid #d1d5db',
                background: activeView === 'stages' ? '#eff6ff' : 'white',
                color: activeView === 'stages' ? '#1d4ed8' : '#374151',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Station Performance
            </button>
            <button
              onClick={handleRetry}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                background: 'white',
                color: '#374151',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              🔄 Refresh
            </button>
          </div>
        </div>
      </div>

      {activeView === 'overview' && (
        <>
          {/* Overview Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '16px',
            marginBottom: '24px'
          }}>
            <div style={{
              background: 'white',
              borderRadius: '8px',
              padding: '20px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              border: '1px solid #e5e7eb'
            }}>
              <h3 style={{ margin: '0 0 12px 0', color: '#1f2937', fontSize: '16px' }}>📊 Total Processed</h3>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#1f2937' }}>
                {overallStats.totalProcessed.toLocaleString()}
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                Across all stages today
              </div>
            </div>
            
            <div style={{
              background: 'white',
              borderRadius: '8px',
              padding: '20px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              border: '1px solid #e5e7eb'
            }}>
              <h3 style={{ margin: '0 0 12px 0', color: '#1f2937', fontSize: '16px' }}>✅ Success Rate</h3>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#059669' }}>
                {overallStats.totalProcessed > 0 ? ((overallStats.totalPassed / overallStats.totalProcessed) * 100).toFixed(1) : 0}%
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                {overallStats.totalPassed.toLocaleString()} passed / {overallStats.totalFailed.toLocaleString()} failed
              </div>
            </div>
            
            {/* <div style={{
              background: 'white',
              borderRadius: '8px',
              padding: '20px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              border: '1px solid #e5e7eb'
            }}>
              <h3 style={{ margin: '0 0 12px 0', color: '#1f2937', fontSize: '16px' }}>🔧 System Status</h3>
              <div style={{ fontSize: '24px', fontWeight: '700', color: systemStatus?.overall === 'healthy' ? '#059669' : '#dc2626', marginBottom: '8px' }}>
                {systemStatus?.overall === 'healthy' ? '🟢 Healthy' : '🔴 Issues'}
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>
                {systemStatus?.overall === 'healthy' ? 'All systems operational' : 'Check system components'}
              </div>
            </div> */}
            
            
          </div>

          {/* Charts */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr',
            gap: '20px',
            marginBottom: '24px'
          }}>
            <div style={{
              background: 'white',
              borderRadius: '8px',
              padding: '20px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              border: '1px solid #e5e7eb'
            }}>
              <h3 style={{ margin: '0 0 20px 0', color: '#1f2937', fontSize: '18px' }}>
                Stage Comparison - Success Rates
              </h3>
              <div style={{ height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stageComparison}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" fontSize={10} angle={-45} textAnchor="end" height={80} />
                    <YAxis fontSize={10} />
                    <Tooltip />
                    <Bar dataKey="successRate" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            <div style={{
              background: 'white',
              borderRadius: '8px',
              padding: '20px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              border: '1px solid #e5e7eb'
            }}>
              <h3 style={{ margin: '0 0 20px 0', color: '#1f2937', fontSize: '18px' }}>
                Overall Pass/Fail Ratio
              </h3>
              <div style={{ height: '240px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {activeView === 'stages' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
          gap: '20px'
        }}>
          <StageAnalyticsCard
            title="Chip Inspection"
            data={analyticsData?.chipInspection || {}}
            icon="🔍"
            isLoading={isLoading}
            error={error}
            onRetry={handleRetry}
          />
          <StageAnalyticsCard
            title="Housing Preparation"
            data={analyticsData?.housingPrep || {}}
            icon="🏠"
            isLoading={isLoading}
            error={error}
            onRetry={handleRetry}
          />
          <StageAnalyticsCard
            title="Wire Bonding"
            data={analyticsData?.wireBond || {}}
            icon="➖⚪➖"
            isLoading={isLoading}
            error={error}
            onRetry={handleRetry}
          />
          <StageAnalyticsCard
            title="S11 Testing"
            data={analyticsData?.s11Testing || {}}
            icon="📈"
            isLoading={isLoading}
            error={error}
            onRetry={handleRetry}
          />
          <StageAnalyticsCard
            title="Fiber Attachment"
            data={analyticsData?.fiberAttach || {}}
            icon="➖➖"
            isLoading={isLoading}
            error={error}
            onRetry={handleRetry}
          />
          <StageAnalyticsCard
            title="DCVπ Testing"
            data={analyticsData?.dcpiTesting || {}}
            icon="📊"
            isLoading={isLoading}
            error={error}
            onRetry={handleRetry}
          />
        </div>
      )}

      {/* Debug Panel
      <DebugPanel 
        systemStatus={systemStatus}
        analyticsData={analyticsData}
        isVisible={showDebug}
      //   onToggle={() => setShowDebug(!showDebug)} */}
      
    </div>
  );
};

export default ConnectedDashboard;