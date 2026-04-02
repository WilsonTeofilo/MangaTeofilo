import React from 'react';
import './LoadingScreen.css';

export default function LoadingScreen() {
  return (
    <div className="shito-loading-overlay">
      <div className="loading-content">
        <h1 className="loading-logo shito-glitch">KOKUIN</h1>
        <div className="loading-bar-container">
          <div className="loading-bar-fill"></div>
        </div>
        <p className="loading-text">Sincronizando com a Tempestade...</p>
      </div>
    </div>
  );
}
