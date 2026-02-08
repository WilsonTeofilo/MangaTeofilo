<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SHITO: Fragmentos da Tempestade | Site Oficial</title>
    
<link rel="stylesheet" href="css/style.css">
    
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;700;900&display=swap" rel="stylesheet">
</head>
<body>

    <header class="main-banner">
        <div class="banner-content">
            <h1 class="game-logo">SHITO:</h1>
            <h2 class="game-sublogo">FRAGMENTOS DA TEMPESTADE</h2>
            <div class="scroll-indicator">DESCUBRA O DESTINO DE REITASU <span>▼</span></div>
        </div>
    </header>

    <section class="lore-summary">
        <div class="container">
            <h3>UM MUNDO QUEBRADO</h3>
            <p>
                Após 474 anos de silêncio, o Flágelo retornou. O mundo de <strong>Shito</strong> está sob a sombra de Yukio. 
                Quatro guerreiros improváveis emergem das cinzas de Reitasu para enfrentar os 6 Flagelos e restaurar a paz que foi perdida em 726 d.C.
            </p>
        </div>
        <div class="lore-banner-image">
        <img src="assets/fotos/shito.jpg" alt="Os Quatro Sobreviventes de Shito">
    </div>
    </section>

    

    

    <section class="characters-section">
        <h3 class="section-title">O ELENCO</h3>
        <div class="character-grid">

            <div class="char-card naraa">
                <div class="gif-box">
                    <img src="assets/Gifs/NaraaGIF.gif" alt="Naraa Combat">
                </div>
                <div class="char-desc">
                    <h4>NARAA</h4>
                    <p><strong>Shinobushi:</strong> Força bruta e Miasma Gélido. O despertar de um poder milenar.</p>
                </div>
            </div>

            <div class="char-card miomya">
                <div class="gif-box">
                    <img src="assets/Gifs/MiomyaGIF.gif" alt="Miomya Combat">
                </div>
                <div class="char-desc">
                    <h4>MIOMYA</h4>
                    <p><strong>Sourukirā:</strong> Névoa Dilacerante. Cortes internos que destroem o inimigo por dentro.</p>
                </div>
            </div>

            <div class="char-card rin">
                <div class="gif-box">
                    <img src="assets/Gifs/RinGIF.gif" alt="Rin Combat">
                </div>
                <div class="char-desc">
                    <h4>RIN</h4>
                    <p><strong>Ceifeira:</strong> Manipulação Gravitacional. Ninguém escapa do alcance de sua foice.</p>
                </div>
            </div>

            <div class="char-card kuroi">
                <div class="gif-box">
                    <img src="assets/Gifs/KuroiGIF.gif" alt="Kuroi Combat">
                </div>
                <div class="char-desc">
                    <h4>KUROI</h4>
                    <p><strong>Punho de Combustão:</strong> Explosões de impacto. Cada soco é uma sentença de fogo.</p>
                </div>
            </div>

        </div>
    </section>

    <footer class="site-footer">
        <div class="pre-save-container">
            <h3>PRÉ-SAVE DISPONÍVEL</h3>
            <p>LANÇAMENTO: 20/10/2028</p>
            
            <form action="save_email.php" method="POST" class="email-form">
                <input type="email" name="email" placeholder="Digite seu e-mail para ser notificado" required>
                <button type="submit">CADASTRAR</button>
            </form>
        </div>

        <div class="visit-counter">
            <?php include 'php/counter.php'; ?>
            <p>Visitantes que sentiram a tempestade: <span><?php echo $total_visitas; ?></span></p>
        </div>
    </footer>

</body>
</html>