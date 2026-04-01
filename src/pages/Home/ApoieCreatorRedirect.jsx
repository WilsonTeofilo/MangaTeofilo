import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';

/** Redireciona `/apoie/criador/:creatorId` → `/apoie?creatorId=…` */
export default function ApoieCreatorRedirect() {
  const { creatorId } = useParams();
  const location = useLocation();
  const raw = decodeURIComponent(String(creatorId || '').trim());
  if (!raw || raw.length < 10 || raw.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(raw)) {
    return <Navigate to="/apoie" replace />;
  }
  const next = new URLSearchParams(location.search || '');
  next.set('creatorId', raw);
  return <Navigate to={`/apoie?${next.toString()}`} replace />;
}
