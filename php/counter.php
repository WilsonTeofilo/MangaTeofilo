<?php

$arquivo_txt = "visitantes.txt";

// Verifica se o arquivo já existe. Se não, cria com o valor inicial 0.
if (!file_exists($arquivo_txt)) {
    file_put_contents($arquivo_txt, "0");
}

// Lê o valor atual do arquivo e converte para um número inteiro
$total_visitas = (int)file_get_contents($arquivo_txt);


session_start();
if (!isset($_SESSION['visitou'])) {
    $total_visitas++; // Incrementa o contador
    file_put_contents($arquivo_txt, (string)$total_visitas); // Salva o novo valor
    $_SESSION['visitou'] = true; // Marca que este usuário já foi contado
}


?>