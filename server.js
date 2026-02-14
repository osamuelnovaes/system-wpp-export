const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 8000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// =====================
// WhatsApp Client Setup
// =====================
let whatsappClient = null;
let isClientReady = false;
let clientInfo = null;
let lastQR = null;

function createWhatsAppClient() {
  // Build Puppeteer options
  const puppeteerOptions = {
    headless: true,
    protocolTimeout: 300000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--disable-gpu',
      '--disable-extensions',
      '--single-process',
      '--disable-software-rasterizer',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-zygote',
      '--js-flags=--max-old-space-size=256'
    ]
  };

  // Use system Chromium if CHROME_PATH is set (Docker/production)
  if (process.env.CHROME_PATH) {
    puppeteerOptions.executablePath = process.env.CHROME_PATH;
    console.log('🔧 Usando Chrome do sistema:', process.env.CHROME_PATH);
  }

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: puppeteerOptions
  });

  client.on('qr', async (qr) => {
    console.log('📱 QR Code recebido!');
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, {
        width: 280,
        margin: 2,
        color: { dark: '#ffffff', light: '#00000000' }
      });
      lastQR = qrDataUrl;
      io.emit('qr', qrDataUrl);
      console.log('📱 QR Code enviado para o frontend');
    } catch (err) {
      console.error('Erro ao gerar QR:', err);
    }
  });

  client.on('ready', async () => {
    console.log('✅ WhatsApp conectado!');
    isClientReady = true;
    lastQR = null;
    clientInfo = client.info;

    // Wait a moment for chats to fully sync before notifying frontend
    console.log('⏳ Aguardando sincronização de chats...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('✅ Sincronização inicial concluída, notificando frontend');

    io.emit('ready', {
      name: clientInfo.pushname,
      phone: clientInfo.wid.user
    });
  });

  client.on('authenticated', () => {
    console.log('🔐 Autenticado com sucesso');
    lastQR = null;
    io.emit('authenticated');
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ Falha na autenticação:', msg);
    isClientReady = false;
    io.emit('auth_failure', msg);
  });

  client.on('disconnected', (reason) => {
    console.log('🔌 Desconectado:', reason);
    isClientReady = false;
    clientInfo = null;
    io.emit('disconnected', reason);
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Carregando: ${percent}% - ${message}`);
    io.emit('loading', { percent, message });
  });

  client.initialize().catch(err => {
    console.error('❌ Erro ao inicializar cliente:', err.message);
  });

  return client;
}

// =====================
// Helper: Get Groups
// =====================

// Get groups using official whatsapp-web.js API with retry logic
async function getGroupsWithRetry(maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📋 Tentativa ${attempt}/${maxRetries} de buscar grupos...`);

      // Use the official getChats() API
      const allChats = await whatsappClient.getChats();
      console.log(`📋 Total de chats carregados: ${allChats.length}`);

      const groups = allChats
        .filter(chat => chat.isGroup)
        .map(chat => ({
          id: chat.id._serialized,
          name: chat.name || 'Grupo sem nome',
          participantCount: chat.groupMetadata ? chat.groupMetadata.participants.length : 0,
          timestamp: chat.timestamp || 0
        }));

      console.log(`📋 Grupos encontrados: ${groups.length}`);

      if (groups.length > 0) {
        return groups;
      }

      // If no groups found and we have more retries, wait and try again
      if (attempt < maxRetries) {
        const delay = attempt * 3000; // 3s, 6s, 9s, 12s, 15s
        console.log(`⏳ Nenhum grupo encontrado, aguardando ${delay / 1000}s para nova tentativa...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (err) {
      console.error(`❌ Erro na tentativa ${attempt}:`, err.message);
      if (attempt < maxRetries) {
        const delay = attempt * 3000;
        console.log(`⏳ Aguardando ${delay / 1000}s para nova tentativa...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // Fallback: try direct Store access as a last resort
  console.log('📋 Tentando acesso direto ao Store como fallback...');
  try {
    return await getGroupsDirectFallback();
  } catch (err) {
    console.error('❌ Fallback também falhou:', err.message);
    return [];
  }
}

// Fallback: Direct Store Access (less reliable but faster)
async function getGroupsDirectFallback() {
  const page = whatsappClient.pupPage;
  if (!page) return [];

  const groups = await page.evaluate(() => {
    const store = window.Store;
    if (!store || !store.Chat) return [];

    const result = [];
    const models = typeof store.Chat.getModelsArray === 'function'
      ? store.Chat.getModelsArray()
      : (store.Chat._models || []);

    models.forEach(chat => {
      if (chat.isGroup) {
        result.push({
          id: chat.id._serialized || chat.id.toString(),
          name: chat.name || chat.formattedTitle || 'Grupo sem nome',
          participantCount: chat.groupMetadata ? chat.groupMetadata.participants.length : 0,
          timestamp: chat.t || 0
        });
      }
    });
    return result;
  });

  console.log(`📋 Fallback encontrou ${groups.length} grupos`);
  return groups;
}

// Get group participants using official API
async function getGroupParticipants(groupId) {
  try {
    console.log(`👥 Buscando chat: ${groupId}`);
    const chat = await whatsappClient.getChatById(groupId);

    if (!chat || !chat.isGroup) {
      console.log(`❌ Chat não encontrado ou não é grupo: ${groupId}`);
      return null;
    }

    // Get participants from group metadata
    const participants = [];
    if (chat.participants && chat.participants.length > 0) {
      for (const p of chat.participants) {
        let name = '';
        try {
          const contact = await whatsappClient.getContactById(p.id._serialized);
          if (contact) {
            name = contact.pushname || contact.name || contact.shortName || '';
          }
        } catch (e) {
          console.log(`⚠️ Não foi possível obter contato: ${p.id._serialized}`);
        }

        participants.push({
          phone: p.id.user,
          phoneFormatted: '+' + p.id.user,
          name: name,
          isAdmin: p.isAdmin || false,
          isSuperAdmin: p.isSuperAdmin || false
        });
      }
    }

    return {
      name: chat.name || 'Grupo',
      participants
    };
  } catch (err) {
    console.error(`❌ Erro ao buscar participantes via API oficial:`, err.message);

    // Fallback to direct store access
    console.log('👥 Tentando fallback via Store...');
    return await getGroupParticipantsDirectFallback(groupId);
  }
}

// Fallback: Direct Store access for participants
async function getGroupParticipantsDirectFallback(groupId) {
  const page = whatsappClient.pupPage;
  if (!page) return null;

  const data = await page.evaluate(async (gId) => {
    const store = window.Store;
    if (!store || !store.Chat) return null;

    const chat = store.Chat.get(gId);
    if (!chat || !chat.isGroup) return null;

    // Make sure group metadata is loaded
    if (!chat.groupMetadata || !chat.groupMetadata.participants || chat.groupMetadata.participants.length === 0) {
      try {
        if (store.GroupMetadata && store.GroupMetadata.update) {
          await store.GroupMetadata.update(gId);
        }
      } catch (e) {
        // ignore
      }
    }

    const meta = chat.groupMetadata;
    if (!meta || !meta.participants) return { name: chat.name, participants: [] };

    const participants = [];
    const models = typeof meta.participants.getModelsArray === 'function'
      ? meta.participants.getModelsArray()
      : (meta.participants._models || meta.participants || []);

    for (const p of models) {
      let name = '';
      try {
        const contact = store.Contact.get(p.id._serialized || p.id.toString());
        if (contact) {
          name = contact.pushname || contact.name || contact.shortName || contact.formattedName || '';
        }
      } catch (e) { }

      participants.push({
        phone: p.id.user,
        phoneFormatted: '+' + p.id.user,
        name: name,
        isAdmin: p.isAdmin || false,
        isSuperAdmin: p.isSuperAdmin || false
      });
    }

    return {
      name: chat.name || chat.formattedTitle || 'Grupo',
      participants
    };
  }, groupId);

  return data;
}

// =====================
// Socket.IO Events
// =====================
io.on('connection', (socket) => {
  console.log('🌐 Cliente conectado via Socket.IO');

  if (isClientReady && clientInfo) {
    socket.emit('ready', {
      name: clientInfo.pushname,
      phone: clientInfo.wid.user
    });
  } else if (lastQR) {
    console.log('📱 Re-enviando QR Code para novo cliente');
    socket.emit('qr', lastQR);
  }

  socket.on('disconnect', () => {
    console.log('🌐 Cliente desconectado do Socket.IO');
  });
});

// =====================
// REST API Routes
// =====================

function requireWhatsApp(req, res, next) {
  if (!isClientReady || !whatsappClient) {
    return res.status(503).json({
      error: 'WhatsApp não está conectado. Escaneie o QR Code primeiro.'
    });
  }
  next();
}

// Health check endpoint for Koyeb
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/status', (req, res) => {
  res.json({
    connected: isClientReady,
    user: clientInfo ? {
      name: clientInfo.pushname,
      phone: clientInfo.wid.user
    } : null
  });
});

// DEBUG endpoint - inspect Store structure
app.get('/api/debug', requireWhatsApp, async (req, res) => {
  try {
    const page = whatsappClient.pupPage;
    const debug = await page.evaluate(() => {
      const info = {
        hasStore: !!window.Store,
        storeKeys: window.Store ? Object.keys(window.Store).slice(0, 50) : [],
        hasChat: !!(window.Store && window.Store.Chat),
        chatMethods: [],
        chatCount: 0,
        sampleChats: [],
        groupCount: 0
      };

      if (window.Store && window.Store.Chat) {
        info.chatMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(window.Store.Chat)).slice(0, 20);

        // Try getModelsArray
        if (typeof window.Store.Chat.getModelsArray === 'function') {
          const models = window.Store.Chat.getModelsArray();
          info.chatCount = models.length;
          info.groupCount = models.filter(c => c.isGroup).length;

          // Sample first 5 chats
          info.sampleChats = models.slice(0, 5).map(c => ({
            id: c.id ? (c.id._serialized || c.id.toString()) : 'no-id',
            name: c.name || c.formattedTitle || 'no-name',
            isGroup: c.isGroup,
            keys: Object.keys(c).slice(0, 15)
          }));
        }

        // Try _models
        if (window.Store.Chat._models) {
          info.modelsCount = window.Store.Chat._models.length;
        }

        // Try serialize/toArray variations
        if (typeof window.Store.Chat.serialize === 'function') {
          info.hasSerialize = true;
        }
        if (typeof window.Store.Chat.toArray === 'function') {
          info.hasToArray = true;
        }
        if (typeof window.Store.Chat.forEach === 'function') {
          info.hasForEach = true;
        }
      }

      return info;
    });

    console.log('🔍 Debug info:', JSON.stringify(debug, null, 2));
    res.json(debug);
  } catch (err) {
    console.error('Debug error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups - using direct store access
app.get('/api/groups', requireWhatsApp, async (req, res) => {
  try {
    console.log('📋 Buscando grupos...');
    const groups = await getGroupsWithRetry();
    console.log(`📋 Total de grupos retornados: ${groups.length}`);

    groups.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json({ groups, total: groups.length });
  } catch (err) {
    console.error('❌ Erro ao listar grupos:', err.message);
    res.status(500).json({ error: 'Erro ao listar grupos: ' + err.message });
  }
});

// GET /api/groups/:id/contacts - using direct store access
app.get('/api/groups/:id/contacts', requireWhatsApp, async (req, res) => {
  try {
    const chatId = req.params.id;
    console.log(`👥 Buscando contatos do grupo: ${chatId}`);

    const data = await getGroupParticipants(chatId);

    if (!data) {
      return res.status(404).json({ error: 'Grupo não encontrado' });
    }

    const contacts = data.participants || [];
    console.log(`👥 Contatos encontrados: ${contacts.length}`);

    // Sort: admins first, then by name
    contacts.sort((a, b) => {
      if (a.isAdmin !== b.isAdmin) return b.isAdmin - a.isAdmin;
      return (a.name || a.phone || '').localeCompare(b.name || b.phone || '');
    });

    res.json({
      group: data.name,
      contacts,
      total: contacts.length
    });
  } catch (err) {
    console.error('❌ Erro ao buscar contatos:', err.message);
    res.status(500).json({ error: 'Erro ao buscar contatos do grupo: ' + err.message });
  }
});

// GET /api/groups/:id/export - Export contacts as XLSX (Excel)
app.get('/api/groups/:id/export', requireWhatsApp, async (req, res) => {
  try {
    const chatId = req.params.id;
    const data = await getGroupParticipants(chatId);

    if (!data) {
      return res.status(404).json({ error: 'Grupo não encontrado' });
    }

    const groupName = data.name || 'Grupo';

    // Build rows for the spreadsheet
    const rows = (data.participants || []).map(p => ({
      'Nome': p.name || '',
      'Telefone': p.phoneFormatted,
      'Grupo': groupName,
      'Admin': p.isSuperAdmin ? 'Criador' : p.isAdmin ? 'Sim' : 'Não'
    }));

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Auto-fit column widths
    const maxNameLen = rows.reduce((max, r) => Math.max(max, (r['Nome'] || '').length), 0);
    const colWidths = [
      { wch: Math.max(20, maxNameLen) },
      { wch: 18 },
      { wch: Math.max(15, groupName.length + 2) },
      { wch: 10 }
    ];
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Contatos');

    // Generate buffer
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const safeName = groupName.replace(/[^a-zA-Z0-9 ]/g, '_').trim();
    const filename = 'contatos_' + safeName + '_' + Date.now() + '.xlsx';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('❌ Erro ao exportar contatos:', err.message);
    res.status(500).json({ error: 'Erro ao exportar contatos' });
  }
});

// GET /api/logout
app.get('/api/logout', async (req, res) => {
  try {
    if (whatsappClient) {
      await whatsappClient.logout();
      await whatsappClient.destroy();
      isClientReady = false;
      clientInfo = null;
      lastQR = null;
      whatsappClient = createWhatsAppClient();
      res.json({ success: true, message: 'Desconectado com sucesso' });
    } else {
      res.json({ success: true, message: 'Nenhuma sessão ativa' });
    }
  } catch (err) {
    console.error('Erro ao desconectar:', err);
    res.status(500).json({ error: 'Erro ao desconectar' });
  }
});

// =====================
// Graceful shutdown
// =====================
process.on('SIGINT', async () => {
  console.log('\n🛑 Encerrando servidor...');
  if (whatsappClient) {
    try {
      await whatsappClient.destroy();
    } catch (e) { }
  }
  process.exit(0);
});

// =====================
// Start Server
// =====================
server.listen(PORT, () => {
  console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}\n`);
  whatsappClient = createWhatsAppClient();
});
