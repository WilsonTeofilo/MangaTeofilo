# TASK-001: Deploy Backend (Spring Boot) on Oracle Cloud Free Tier

**Objetivo Técnico**
- Provisionar uma instância VM **Always Free** na Oracle Cloud (Ubuntu 22.04) para hospedar a stack completa de produção (PostgreSQL, MongoDB, Redis e aplicação Spring Boot).
- Configurar Docker + Docker‑Compose com o arquivo `docker-compose.prod.yml` já presente no repositório.
- Expor a API em **HTTPS** através de um sub‑domínio `api.manganetworking.pages.dev` usando Cloudflare Workers como proxy reverso ou, alternativamente, certificado Let's Encrypt direto na VM.
- Garantir que variáveis sensíveis (senhas, chaves JWT, credenciais SMTP, tokens Mercado Pago) sejam fornecidas via **secrets** e nunca versionadas.
- Atualizar configuração de CORS e cookies no backend para produção segura.

**Regras de Segurança**
- **TLS**: Todas as comunicações externas devem usar HTTPS. Se usar Cloudflare Workers, o tráfego entre o worker e a VM pode ser HTTP interno, mas a conexão do cliente ao worker deve ser TLS.
- **Variáveis de Ambiente**: `POSTGRES_PASSWORD`, `MONGODB_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `AES_KEY`, `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, etc., devem ser definidas como secrets no ambiente da VM ou no Cloudflare Workers KV (não hard‑coded).
- **CORS**: `allowedOrigins` deve incluir apenas `https://manganetworking.pages.dev` e `https://api.manganetworking.pages.dev`.
- **Cookies**: `SameSite=Strict`, `HttpOnly=true`, `Secure=true`.
- **Firewall**: Abrir apenas as portas necessárias (`80/443` para o proxy, `8085` interno para a API, `5432`, `27017`, `6379` restritas ao contêiner interno).
- **Hardening da VM**: Atualizar pacotes, desativar login root via senha, usar chave SSH.

**Critérios de Aceite**
- [ ] Instância VM criada e acessível via SSH.
- [ ] Docker e Docker‑Compose instalados e versão mínima 24.0.
- [ ] Arquivo `.env` criado na VM com todas as variáveis de ambiente necessárias (valores fictícios para teste).
- [ ] `docker compose -f docker-compose.prod.yml up -d` executado com sucesso; todos os containers (`postgres`, `mongodb`, `redis`, `backend`) iniciam sem erros.
- [ ] Endpoint de saúde `GET https://api.manganetworking.pages.dev/api/health` retorna `200 OK` com corpo `{"status":"UP"}`.
- [ ] Cookies de sessão são emitidos com `Secure; HttpOnly; SameSite=Strict`.
- [ ] CORS permite apenas o domínio do frontend.
- [ ] Webhook de Mercado Pago configurado e recebe eventos de teste (`sandbox`) com resposta `200`.
- [ ] Documentação atualizada em `README_DEPLOY_BACKEND.md` com instruções de replicação.

**Procedimento de Auditoria**
1. Verificar logs da VM (`docker logs <container>`). 
2. Testar fluxo de login completo através do frontend publicado.
3. Executar chamada ao endpoint de 2FA (`/api/auth/2fa/request`) e confirmar entrega de e‑mail (Mailpit ou SMTP real).
4. Simular pagamento sandbox e validar webhook.
5. Rodar testes de carga leves (ex.: `hey -n 100 -c 10 https://api.manganetworking.pages.dev/api/work`) e confirmar que a RAM utilizada < 6 GB.

**Assinaturas**
- **Assinado por:** Hermes (Tech Lead / Gerente / Arquiteto)
- **Aprovado por:** (a ser preenchido pelo OpenCode Backend ao concluir a tarefa)
