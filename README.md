# Aliá Farma

Farmácia online: HTML/CSS/JS no front-end e Node.js + Express no back-end. Funciona em qualquer navegador (Android, iOS, Windows, Mac, Linux) e pode ser instalada na tela inicial do celular.

## Rodar no computador
1. Instale o Node.js 18+ (versão LTS).
2. `npm install` e depois `npm start` (ou `npm run dev` para reiniciar sozinho ao editar o servidor).
3. Abra http://localhost:3000

Admin local: admin@aliafarma.com / admin123.

## Publicar no Render (resumo)
1. Envie a pasta para um repositório no GitHub (o `.gitignore` já exclui `node_modules`, `data` e `.env`).
2. Render → **New → Web Service** → escolha o repositório.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free
3. Em **Environment**, crie:
   - `NODE_VERSION` = `20`
   - `JWT_SECRET` = texto longo e aleatório (32+ caracteres)
   - `ADMIN_EMAIL` e `ADMIN_PASSWORD` = login do administrador
   - `PHARMACIST_PHONE` (opcional) = WhatsApp do farmacêutico com DDD. Também dá para definir no painel do admin.
4. Clique em **Create Web Service** e aguarde o deploy. Teste `https://SEU-SITE.onrender.com/healthz` (deve responder `ok`).

### Plano gratuito: o que esperar
- O serviço "dorme" após 15 minutos sem acessos e leva cerca de 1 minuto para acordar.
- O sistema de arquivos é temporário: tudo o que o site grava em `data/db.json` (contas de clientes, pedidos, produtos e banners editados) é perdido a cada deploy, reinício ou quando o serviço dorme. Produtos e banners iniciais e o admin (pelas variáveis) são recriados.
- Para guardar os dados: serviço pago com **Disk** (monte em `/var/data` e crie `DATA_DIR=/var/data`) ou migrar para um banco Postgres.

## Pix (simulado)
O QR Code aponta para um link de pagamento do próprio site (`/pagar/...`). Ao abrir o link e tocar em "Simular pagamento", o pedido vira Pago e a tela do cliente atualiza sozinha. Para cobrar de verdade, integre um gateway (Mercado Pago, Pagar.me, Stripe...).

## Fotos e banners
No painel do admin, cole qualquer link **direto** de imagem (termina em .jpg, .png, .webp...) ou um link de arquivo do Google Drive compartilhado com "qualquer pessoa com o link". Banners sem foto mostram os produtos da categoria escolhida.
