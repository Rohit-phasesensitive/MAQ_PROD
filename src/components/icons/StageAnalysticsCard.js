// src/components/StageAnalyticsCard.js
import React from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts'

export default function StageAnalyticsCard({ title, icon, data }) {
  // defend against zeroes
  const successRate =
    data.totalProcessed > 0
      ? ((data.passed / data.totalProcessed) * 100).toFixed(1)
      : 0

  return (
    <div
      style={{
        background: 'white',
        borderRadius: 8,
        padding: 20,
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        border: '1px solid #e5e7eb',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {icon} {title}
        </h3>
        <span
          style={{
            padding: '4px 8px',
            borderRadius: 12,
            fontSize: 12,
            fontWeight: 500,
            background:
              successRate > 95
                ? '#dcfce7'
                : successRate > 90
                ? '#fef3c7'
                : '#fecaca',
            color:
              successRate > 95 ? '#166534' : successRate > 90 ? '#92400e' : '#991b1b',
          }}
        >
          {successRate}% Success
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2,1fr)',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <small style={{ color: '#6b7280' }}>Total Processed</small>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{data.totalProcessed}</div>
        </div>
        <div>
          <small style={{ color: '#6b7280' }}>Avg Time (sec)</small>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{data.avgProcessingTime}</div>
        </div>
        <div>
          <small style={{ color: '#6b7280' }}>Passed</small>
          <div style={{ color: '#059669', fontWeight: 600 }}>{data.passed}</div>
        </div>
        <div>
          <small style={{ color: '#6b7280' }}>Failed</small>
          <div style={{ color: '#dc2626', fontWeight: 600 }}>{data.failed}</div>
        </div>
      </div>

      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.recentActivity}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="time" fontSize={10} />
            <YAxis fontSize={10} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="processed"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="failed"
              stroke="#ef4444"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
