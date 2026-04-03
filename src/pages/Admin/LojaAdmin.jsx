import { Navigate } from 'react-router-dom';

/** Compat: `/admin/loja` → catálogo em `/admin/products`. */
export default function LojaAdmin() {
  return <Navigate to="/admin/products" replace />;
}
