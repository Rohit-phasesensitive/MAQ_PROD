import React from 'react';

const PDattach = () => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '80vh',
      padding: '40px',
      fontFamily: 'Arial, sans-serif',
      background: 'linear-gradient(135deg, #6b73ff 0%, #9c27b0 100%)',
      borderRadius: '20px',
      margin: '20px',
      color: 'white',
      textAlign: 'center'
    }}>
      {/* Icon */}
      <div style={{
        fontSize: '4rem',
        marginBottom: '20px',
        opacity: '0.8'
      }}>
        🔧
      </div>
      
      {/* Title */}
      <h1 style={{
        fontSize: '2.5rem',
        fontWeight: '600',
        marginBottom: '15px',
        margin: '0'
      }}>
        PD Attach Module
      </h1>
      
      {/* Subtitle */}
      <h2 style={{
        fontSize: '1.3rem',
        fontWeight: '400',
        marginBottom: '30px',
        opacity: '0.9',
        margin: '0 0 30px 0'
      }}>
        Under Development
      </h2>
      
      {/* Message */}
      <p style={{
        fontSize: '1.1rem',
        lineHeight: '1.6',
        maxWidth: '500px',
        marginBottom: '30px',
        opacity: '0.8'
      }}>
        This module is currently being developed and will be available soon. 
        
      </p>
      
      {/* Status Badge */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px 24px',
        background: 'rgba(255, 255, 255, 0.2)',
        borderRadius: '25px',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.3)',
        fontSize: '0.95rem',
        fontWeight: '600'
      }}>
        <span style={{ fontSize: '1.2rem' }}>⚡</span>
        Coming Soon
      </div>
      
      {/* Features List */}
      
    </div>
  );
};

export default PDattach;