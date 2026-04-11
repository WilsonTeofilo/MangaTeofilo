import React from 'react';

export default function ChapterUploadProgress({ loading, porcentagem, progressoMsg }) {
  if (!loading) return null;
  return (
    <div className="progress-container">
      <div className="progress-bar" style={{ width: `${porcentagem}%` }}></div>
      <p>{porcentagem}% - {progressoMsg}</p>
    </div>
  );
}
