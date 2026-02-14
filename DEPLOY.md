# 🚀 Deploy na Koyeb — Guia Passo a Passo

## Pré-requisitos
- Conta no [GitHub](https://github.com) (gratuita)
- Conta na [Koyeb](https://app.koyeb.com) (gratuita)

---

## Passo 1: Subir o código para o GitHub

1. Crie um **novo repositório** no GitHub:
   - Acesse https://github.com/new
   - Nome: `system-wpp-export` (ou o que preferir)
   - Visibilidade: **Private** (recomendado)
   - **NÃO** adicione README, .gitignore ou license
   - Clique em **Create repository**

2. No terminal, execute os comandos que o GitHub mostrar:
   ```bash
   cd "/Users/samuelnovaes/Desktop/system-wpp-export_V2 - cópia"
   git add .
   git commit -m "Preparar para deploy na Koyeb"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/system-wpp-export.git
   git push -u origin main
   ```

---

## Passo 2: Criar conta na Koyeb

1. Acesse https://app.koyeb.com
2. Clique em **Sign Up**
3. Faça login com sua **conta do GitHub** (mais fácil)

---

## Passo 3: Criar o serviço

1. No dashboard da Koyeb, clique em **Create Web Service**
2. Selecione **GitHub** como fonte
3. Conecte sua conta do GitHub e selecione o repositório `system-wpp-export`
4. Configure:
   - **Builder**: `Dockerfile` (a Koyeb vai detectar automaticamente)
   - **Instance type**: `Free` (nano)
   - **Region**: Washington, D.C. (padrão)
   - **Port**: `8000`
   - **Health check path**: `/health`
5. Clique em **Deploy**

---

## Passo 4: Aguardar o deploy

- O build leva de **3 a 8 minutos** (instalação do Chromium)
- Quando finalizar, a Koyeb fornecerá uma URL como:
  `https://seu-app-koyeb.app`
- Acesse essa URL para ver seu sistema!

---

## ⚠️ Notas Importantes

### Sessão do WhatsApp
- A **sessão do WhatsApp** (QR Code) é salva dentro do container
- Se a Koyeb reiniciar o container, **você precisará escanear o QR Code novamente**
- Isso é uma limitação do free tier (sem volume persistente)

### Limites do Free Tier
- **512 MB RAM** / **0.1 vCPU**
- **1 serviço web** gratuito
- Sem spin-down (app fica sempre ativo)

### Se precisar rodar localmente
O app agora usa a porta `8000` por padrão. Para rodar local:
```bash
npm start
# Acesse http://localhost:8000
```

Ou define a variável de ambiente:
```bash
PORT=1999 npm start
# Acesse http://localhost:1999
```
