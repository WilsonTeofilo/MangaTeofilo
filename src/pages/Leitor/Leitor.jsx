import React, { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { getDatabase, ref, onValue, push, set, runTransaction, serverTimestamp } from "firebase/database"

import LoadingScreen from "../../components/LoadingScreen"
import "./Leitor.css"

export default function Leitor({ user }) {

const { id } = useParams()
const navigate = useNavigate()
const db = getDatabase()

/* =============================
ESTADOS
============================= */

const [capitulo, setCapitulo] = useState(null)
const [carregando, setCarregando] = useState(true)

const [comentarioTexto, setComentarioTexto] = useState("")
const [listaComentarios, setListaComentarios] = useState([])
const [perfisUsuarios, setPerfisUsuarios] = useState({})

const [filtro, setFiltro] = useState("relevantes")

/* leitor */

const [modoLeitura, setModoLeitura] = useState(
localStorage.getItem("modoLeitura") || "vertical"
)

const [zoom, setZoom] = useState(
Number(localStorage.getItem("zoom")) || 100
)

const [paginaAtual, setPaginaAtual] = useState(0)
const [mostrarConfig, setMostrarConfig] = useState(false)

/* swipe */

const touchStartX = useRef(0)
const touchEndX = useRef(0)

/* controle de perfis */

const unsubPerfis = useRef({})

/* =============================
SALVAR CONFIG
============================= */

useEffect(() => {
localStorage.setItem("modoLeitura", modoLeitura)
}, [modoLeitura])

useEffect(() => {
localStorage.setItem("zoom", zoom)
}, [zoom])

/* =============================
CARREGAR PERFIL
============================= */

const escutarPerfil = useCallback((uid) => {

if (!uid || unsubPerfis.current[uid]) return

const perfilRef = ref(db, `usuarios/${uid}`)

const unsubscribe = onValue(perfilRef, snap => {

if (snap.exists()) {

setPerfisUsuarios(prev => ({
...prev,
[uid]: snap.val()
}))

}

})

unsubPerfis.current[uid] = unsubscribe

}, [db])

/* =============================
CARREGAR CAPITULO
============================= */

useEffect(() => {

const capRef = ref(db, `capitulos/${id}`)

runTransaction(
ref(db, `capitulos/${id}/visualizacoes`),
(v) => (v || 0) + 1
)

const unsubscribe = onValue(capRef, snap => {

if (!snap.exists()) {
setCapitulo(null)
setCarregando(false)
return
}

const dados = snap.val()

setCapitulo(dados)

if (dados.comentarios) {

const lista = Object.keys(dados.comentarios).map(key => ({
id: key,
...dados.comentarios[key]
}))

setListaComentarios(lista)

lista.forEach(c => {
if (c.userId) escutarPerfil(c.userId)
})

} else {

setListaComentarios([])

}

setCarregando(false)

})

return () => {

unsubscribe()

Object.values(unsubPerfis.current).forEach(unsub => unsub?.())

unsubPerfis.current = {}

}

}, [id, db, escutarPerfil])

/* =============================
NAVEGAÇÃO
============================= */

const totalPaginas = capitulo?.paginas?.length || 0

const irParaProximaPagina = () => {
setPaginaAtual(p => Math.min(p + 1, totalPaginas - 1))
}

const irParaPaginaAnterior = () => {
setPaginaAtual(p => Math.max(p - 1, 0))
}

/* =============================
TECLADO
============================= */

useEffect(() => {

const handleKey = (e) => {

if (modoLeitura !== "horizontal") return

if (e.key === "ArrowRight") irParaProximaPagina()
if (e.key === "ArrowLeft") irParaPaginaAnterior()

}

window.addEventListener("keydown", handleKey)

return () => window.removeEventListener("keydown", handleKey)

}, [modoLeitura, totalPaginas])

/* =============================
SWIPE
============================= */

const handleTouchStart = e => {
touchStartX.current = e.changedTouches[0].screenX
}

const handleTouchMove = e => {
touchEndX.current = e.changedTouches[0].screenX
}

const handleTouchEnd = () => {

const dist = touchStartX.current - touchEndX.current

if (dist > 50) irParaProximaPagina()
if (dist < -50) irParaPaginaAnterior()

}

/* =============================
COMENTAR
============================= */

const handleEnviarComentario = async e => {

e.preventDefault()

if (!user) {
navigate("/login")
return
}

if (!comentarioTexto.trim()) return

try {

const novoRef = push(ref(db, `capitulos/${id}/comentarios`))

await set(novoRef, {
texto: comentarioTexto.trim(),
userId: user.uid,
data: serverTimestamp(),
likes: 0
})

setComentarioTexto("")

} catch (err) {

console.error("Erro ao comentar:", err)

}

}

/* =============================
LIKE
============================= */

const handleLike = (comentId) => {

if (!user) {
navigate("/login")
return
}

const likeRef = ref(db, `capitulos/${id}/comentarios/${comentId}`)

runTransaction(likeRef, post => {

if (!post) return post

if (!post.usuariosQueCurtiram)
post.usuariosQueCurtiram = {}

if (post.usuariosQueCurtiram[user.uid]) {

post.likes = Math.max(0, (post.likes || 1) - 1)
delete post.usuariosQueCurtiram[user.uid]

} else {

post.likes = (post.likes || 0) + 1
post.usuariosQueCurtiram[user.uid] = true

}

return post

})

}

/* =============================
ORDENAR COMENTARIOS
============================= */

const comentariosOrdenados = [...listaComentarios].sort((a, b) => {

if (filtro === "relevantes") {
return (b.likes || 0) - (a.likes || 0)
}

return (b.data || 0) - (a.data || 0)

})

/* =============================
LOADING
============================= */

if (carregando) return <LoadingScreen/>

if (!capitulo) return <div>Capítulo não encontrado</div>

/* =============================
RENDER
============================= */

return (

<div className="leitor-container">

<header className="leitor-header">

<h1>{capitulo.titulo}</h1>

<button
className="btn-config"
onClick={() => setMostrarConfig(v => !v)}
>
⚙
</button>

</header>

{mostrarConfig && (

<div className="config-panel">

<button
className={modoLeitura === "vertical" ? "active" : ""}
onClick={() => setModoLeitura("vertical")}
>
Vertical
</button>

<button
className={modoLeitura === "horizontal" ? "active" : ""}
onClick={() => setModoLeitura("horizontal")}
>
Horizontal
</button>

<div>

<button onClick={() => setZoom(z => Math.max(50, z - 10))}>-</button>

<span>{zoom}%</span>

<button onClick={() => setZoom(z => Math.min(200, z + 10))}>+</button>

</div>

</div>

)}

{modoLeitura === "vertical" ? (

<main className="paginas-lista">

{capitulo.paginas?.map((url, index) => (

<img
key={index}
src={url}
alt={`página ${index + 1}`}
loading="lazy"
style={{
width: `${zoom}%`,
display: "block",
margin: "0 auto"
}}
/>

))}

</main>

) : (

<div
className="horizontal-reader"
onTouchStart={handleTouchStart}
onTouchMove={handleTouchMove}
onTouchEnd={handleTouchEnd}
>

<button
type="button"
className="seta esquerda"
onClick={irParaPaginaAnterior}
disabled={paginaAtual === 0}
>
‹
</button>

<div className="pagina-unica">

<img
src={capitulo.paginas?.[paginaAtual]}
alt={`pagina ${paginaAtual + 1}`}
style={{
width: `${zoom}%`,
margin: "0 auto",
display: "block"
}}
/>

</div>

<button
type="button"
className="seta direita"
onClick={irParaProximaPagina}
disabled={paginaAtual >= totalPaginas - 1}
>
›
</button>

<div className="contador">
{paginaAtual + 1} / {totalPaginas}
</div>

</div>

)}

<footer className="leitor-footer">

<button onClick={() => navigate("/capitulos")}>
Voltar ao mangá
</button>

</footer>

<section className="comentarios-section">

<h3>Comentários</h3>

<form onSubmit={handleEnviarComentario}>

<textarea
value={comentarioTexto}
onChange={e => setComentarioTexto(e.target.value)}
placeholder="Escreva algo..."
/>

<button type="submit">
Enviar
</button>

</form>

<div>

{comentariosOrdenados.map(c => {

const perfil = perfisUsuarios[c.userId]
const isLiked = c.usuariosQueCurtiram?.[user?.uid]

return (

<div key={c.id} className="comentario">

<img
src={perfil?.userAvatar || "/assets/avatares/ava1.webp"}
alt="avatar"
/>

<div>

<strong>
{perfil?.userName || "Usuário"}
</strong>

<p>{c.texto}</p>

<button
type="button"
onClick={() => handleLike(c.id)}
>

{isLiked ? "❤️" : "🤍"} {c.likes || 0}

</button>

</div>

</div>

)

})}

</div>

</section>

</div>

)

}