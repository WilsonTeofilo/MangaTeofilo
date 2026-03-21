import React, { useState, useEffect } from 'react';
import { updateProfile } from 'firebase/auth'; // Removido getAuth daqui
import { ref, update } from "firebase/database"; // Removido getDatabase daqui
import { useNavigate } from 'react-router-dom';

// 1. IMPORTAÇÃO CENTRALIZADA (Usa a mesma conexão que o Leitor)
import { auth, db } from '../../services/firebase'; 

// 2. CSS NA MESMA PASTA
import './Perfil.css';

export default function Perfil() {
  const navigate = useNavigate();
  const user = auth.currentUser;

  const [novoNome, setNovoNome] = useState('');
  const [avatarSelecionado, setAvatarSelecionado] = useState('');
  const [loading, setLoading] = useState(false);
  const [mensagem, setMensagem] = useState({ texto: '', tipo: '' });

  // Avatares apontando para a raiz da pasta public
  const listaAvatares = Array.from({ length: 17 }, (_, i) => `/assets/avatares/ava${i + 1}.webp`);

  useEffect(() => {
    if (!user) {
      navigate('/login');
    } else {
      setNovoNome(user.displayName || '');
      setAvatarSelecionado(user.photoURL || listaAvatares[0]);
    }
  }, [user, navigate]);

  const handleSalvar = async (e) => {
    e.preventDefault();
    if (!novoNome.trim()) return setMensagem({ texto: "Dê um nome à sua alma!", tipo: 'erro' });
    
    setLoading(true);
    setMensagem({ texto: '', tipo: '' });

    try {
      // 1. ATUALIZA NO AUTH (Sistema de Login do Firebase)
      await updateProfile(user, {
        displayName: novoNome.trim(),
        photoURL: avatarSelecionado
      });

      // 2. ATUALIZA NO DATABASE (Onde o Leitor.jsx "escuta" a mudança)
      // Usando o 'db' centralizado para garantir sincronia imediata
      const userRef = ref(db, `usuarios/${user.uid}`);
      await update(userRef, {
        userName: novoNome.trim(),
        userAvatar: avatarSelecionado,
        uid: user.uid
      });

      setMensagem({ texto: "Perfil forjado com sucesso!", tipo: 'sucesso' });
      
      // Pequeno delay para o usuário ver o sucesso
      setTimeout(() => navigate('/'), 1500);
    } catch (error) {
      console.error("Erro na forja:", error);
      setMensagem({ texto: "Erro ao atualizar: " + error.message, tipo: 'erro' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="perfil-page">
      <div className="perfil-card">
        <h1 className="perfil-title">FORJA DE ALMA</h1>
        <p className="perfil-subtitle">Altere sua identidade em Shito</p>

        <form onSubmit={handleSalvar}>
          <div className="avatar-big-preview">
            <div className="circle-wrap">
              <img src={avatarSelecionado} alt="Preview Avatar" />
            </div>
          </div>

          <div className="input-group">
            <label>NOME DE EXIBIÇÃO</label>
            <input 
              type="text" 
              className="perfil-input" 
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              maxLength={25}
              placeholder="Ex: Guerreiro de Brajiru"
            />
          </div>

          <div className="avatar-selection-section">
            <label>ESCOLHA SEU NOVO VISUAL</label>
            <div className="avatar-options-grid">
              {listaAvatares.map((url, i) => (
                <div 
                  key={i} 
                  className={`avatar-option-card ${avatarSelecionado === url ? 'active' : ''}`}
                  onClick={() => setAvatarSelecionado(url)}
                >
                  <img src={url} alt={`Opção ${i + 1}`} />
                </div>
              ))}
            </div>
          </div>

          {mensagem.texto && (
            <p className={`feedback-msg ${mensagem.tipo}`}>{mensagem.texto}</p>
          )}

          <div className="perfil-actions">
            <button type="submit" className="btn-save-perfil" disabled={loading}>
              {loading ? 'SINCRONIZANDO...' : 'SALVAR ALTERAÇÕES'}
            </button>
            <button type="button" className="btn-cancel-perfil" onClick={() => navigate('/')}>
              CANCELAR
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}