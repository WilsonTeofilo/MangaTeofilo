import emailjs from '@emailjs/browser';
import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, increment, update } from "firebase/database";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import './App.css';

// --- CONFIGURAÇÃO FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyCIfoyLhykhz6IstjXNfHvMOltnPUHNvIA",
  authDomain: "shitoproject-ed649.firebaseapp.com",
  projectId: "shitoproject-ed649",
  storageBucket: "shitoproject-ed649.firebasestorage.app",
  messagingSenderId: "613627655546",
  appId: "1:613627655546:web:370838bb5e3867f431d2c3",
  measurementId: "G-5QNETWX5RW",
  databaseURL: "https://shitoproject-ed649-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

emailjs.init("Nb2y-2UnBdpeLWHr9");

// MUDANÇA AQUI: De "App" para "ShitoGame"
export default function ShitoGame() { 
  const [email, setEmail] = useState("");
  const [visitas, setVisitas] = useState(0);
  const [preSavesCount, setPreSavesCount] = useState(0);
  const [usuario, setUsuario] = useState(null);
  const hasIncremented = useRef(false);

  useEffect(() => {
    if (!hasIncremented.current) {
      update(ref(db, 'stats'), { contador: increment(1) });
      hasIncremented.current = true;
    }
    
    const unsubVisitas = onValue(ref(db, 'stats/contador'), (s) => setVisitas(s.val() || 0));
    const unsubPreSaves = onValue(ref(db, 'stats/totalPreSaves'), (s) => setPreSavesCount(s.val() || 0));
    const unsubAuth = onAuthStateChanged(auth, (user) => setUsuario(user));

    return () => {
      unsubVisitas();
      unsubPreSaves();
      unsubAuth();
    };
  }, []);

  const enviarEmailConfirmacao = (emailDestino, nomeUsuario = "Aventureiro") => {
    const templateParams = {
      email: emailDestino,
      name: nomeUsuario,
      reply_to: 'drakenteofilo@gmail.com'
    };

    emailjs.send(
      'service_ggs06v8',
      'template_jjncsqm',
      templateParams,
      'Nb2y-2UnBdpeLWHr9'
    )
    .then((res) => console.log("Sucesso! E-mail enviado:", res.status))
    .catch((err) => console.error("Falha no EmailJS:", err));
  };

  const incrementarPreSave = () => {
    update(ref(db, 'stats'), { totalPreSaves: increment(1) });
  };

  const loginGoogle = () => {
    signInWithPopup(auth, googleProvider).then((res) => {
      update(ref(db, 'usuarios/' + res.user.uid), {
        nome: res.user.displayName,
        email: res.user.email,
        vincular_alma: "Sucesso"
      });
      incrementarPreSave();
      enviarEmailConfirmacao(res.user.email, res.user.displayName);
      alert("Sua alma foi vinculada via Google!");
    }).catch(err => console.error("Erro no Login Google:", err));
  };

  const salvarEmail = (e) => {
    e.preventDefault();
    const emailAEnviar = email;
    set(ref(db, 'preSaves/' + emailAEnviar.replace(/\./g, '_')), {
      email: emailAEnviar,
      timestamp: Date.now()
    }).then(() => {
      incrementarPreSave();
      enviarEmailConfirmacao(emailAEnviar);
      alert("Sua alma foi vinculada!");
      setEmail("");
    });
  };

  return (
    <div className="shito-page">
      <header className="main-banner">
        <div className="banner-content">
          <h1 className="game-logo">SHITO:</h1>
          <h2 className="game-sublogo">FRAGMENTOS DA TEMPESTADE</h2>
        </div>
      </header>

      <section className="lore-summary">
        <h3>UM MUNDO QUEBRADO</h3>
        <p>Após 474 anos, o Flágelo retornou.</p>
        <div className="lore-banner-image">
          <img src="/assets/fotos/shito.jpg" alt="Banner" />
        </div>
      </section>

      <section className="characters-section">
        <div className="character-grid">
          <div className="char-card naraa">
            <div className="gif-box"><img src="/assets/Gifs/NaraaGIF.gif" alt="Naraa" /></div>
            <div className="char-desc"><h4>NARAA</h4><p>Miasma Gélido.</p></div>
          </div>
          <div className="char-card miomya">
            <div className="gif-box"><img src="/assets/Gifs/MiomyaGIF.gif" alt="Miomya" /></div>
            <div className="char-desc"><h4>MIOMYA</h4><p>Névoa Dilacerante.</p></div>
          </div>
          <div className="char-card rin">
            <div className="gif-box"><img src="/assets/Gifs/RinGIF.gif" alt="Rin" /></div>
            <div className="char-desc"><h4>RIN</h4><p>Gravidade.</p></div>
          </div>
          <div className="char-card kuroi">
            <div className="gif-box"><img src="/assets/Gifs/KuroiGIF.gif" alt="Kuroi" /></div>
            <div className="char-desc"><h4>KUROI</h4><p>Combustão.</p></div>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="pre-save-container">
          <h3 className="section-title">PRÉ-SAVE DISPONÍVEL</h3>
          {!usuario ? (
            <div className="auth-box">
              <button onClick={loginGoogle} className="google-btn-custom">PRÉ-SAVE COM GOOGLE</button>
              <form className="email-form" onSubmit={salvarEmail}>
                <input type="email" placeholder="Seu e-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <button type="submit">CADASTRAR</button>
              </form>
            </div>
          ) : (
            <div className="user-logged">
              <p>Guerreiro: <strong>{usuario.displayName}</strong></p>
              <button onClick={() => signOut(auth)}>SAIR</button>
            </div>
          )}
        </div>

        <div className="visit-counter">
          <p>Almas Vinculadas (Pré-Saves): <span>{preSavesCount}</span></p>
          <p>Visitantes na Tempestade: <span>{visitas}</span></p>
        </div>
      </footer>
    </div>
  );
}