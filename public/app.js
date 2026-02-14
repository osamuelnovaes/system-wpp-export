// ==========================================
// WPP Export — Frontend Application
// ==========================================

const socket = io();

// State
let currentGroups = [];
let currentContacts = [];
let selectedGroupId = null;
let selectedGroupName = '';

// ==========================================
// DOM Elements
// ==========================================
const stepQR = document.getElementById('stepQR');
const stepLoading = document.getElementById('stepLoading');
const stepGroups = document.getElementById('stepGroups');
const stepContacts = document.getElementById('stepContacts');
const qrImage = document.getElementById('qrImage');
const qrLoading = document.getElementById('qrLoading');
const headerStatus = document.getElementById('headerStatus');
const btnLogout = document.getElementById('btnLogout');

// ==========================================
// Particles Background
// ==========================================
function createParticles() {
    const container = document.getElementById('particles');
    for (let i = 0; i < 30; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.top = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 8 + 's';
        particle.style.animationDuration = (6 + Math.random() * 6) + 's';
        container.appendChild(particle);
    }
}
createParticles();

// ==========================================
// Navigation / Steps
// ==========================================
function showStep(stepId) {
    [stepQR, stepLoading, stepGroups, stepContacts].forEach(s => {
        s.style.display = 'none';
        s.classList.remove('active');
    });

    const step = document.getElementById(stepId);
    step.style.display = 'block';
    // Trigger re-animation
    void step.offsetWidth;
    step.classList.add('active');
}

function updateStatus(state, text) {
    const dot = headerStatus.querySelector('.status-dot');
    const label = headerStatus.querySelector('.status-text');
    dot.className = 'status-dot ' + state;
    label.textContent = text;
}

// ==========================================
// Socket.IO Events
// ==========================================
socket.on('qr', (qrDataUrl) => {
    qrImage.src = qrDataUrl;
    qrImage.style.display = 'block';
    qrLoading.style.display = 'none';
    showStep('stepQR');
    updateStatus('connecting', 'Aguardando leitura...');
});

socket.on('authenticated', () => {
    updateStatus('connecting', 'Autenticado, carregando...');
    showStep('stepLoading');
    document.getElementById('loadingTitle').textContent = 'Carregando dados...';
    document.getElementById('loadingMessage').textContent = 'Sincronizando conversas do WhatsApp';
});

socket.on('loading', ({ percent, message }) => {
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    progressBar.style.display = 'block';
    progressFill.style.width = percent + '%';
    document.getElementById('loadingMessage').textContent = message || 'Carregando...';
});

socket.on('ready', (info) => {
    updateStatus('connected', `Conectado: ${info.name}`);
    btnLogout.style.display = 'flex';
    loadGroups();
});

socket.on('auth_failure', () => {
    updateStatus('disconnected', 'Falha na autenticação');
    showStep('stepQR');
    qrLoading.style.display = 'flex';
    qrImage.style.display = 'none';
    showToast('Falha na autenticação. Tente novamente.', 'error');
});

socket.on('disconnected', () => {
    updateStatus('disconnected', 'Desconectado');
    btnLogout.style.display = 'none';
    showStep('stepQR');
    qrLoading.style.display = 'flex';
    qrImage.style.display = 'none';
});

// ==========================================
// API Calls
// ==========================================
async function loadGroups() {
    showStep('stepLoading');
    document.getElementById('loadingTitle').textContent = 'Buscando grupos...';
    document.getElementById('loadingMessage').textContent = 'Carregando a lista de grupos do WhatsApp. Isso pode levar alguns segundos...';
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    progressBar.style.display = 'block';
    progressFill.style.width = '30%';

    try {
        const res = await fetch('/api/groups');
        progressFill.style.width = '90%';
        const data = await res.json();

        if (!res.ok) throw new Error(data.error);

        progressFill.style.width = '100%';
        currentGroups = data.groups;

        if (data.total === 0) {
            renderGroups([]);
            showStep('stepGroups');
            showToast('Nenhum grupo encontrado. Tente recarregar.', 'error');
        } else {
            renderGroups(currentGroups);
            showStep('stepGroups');
            showToast(`${data.total} grupos encontrados`, 'success');
        }
    } catch (err) {
        showToast('Erro ao carregar grupos: ' + err.message, 'error');
        showStep('stepGroups');
        renderGroups([]);
    } finally {
        progressBar.style.display = 'none';
        progressFill.style.width = '0%';
    }
}

async function loadContacts(groupId, groupName) {
    selectedGroupId = groupId;
    selectedGroupName = groupName;

    showStep('stepLoading');
    document.getElementById('loadingTitle').textContent = 'Buscando contatos...';
    document.getElementById('loadingMessage').textContent = `Carregando participantes de "${groupName}"`;

    try {
        const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/contacts`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error);

        currentContacts = data.contacts;
        document.getElementById('contactsTitle').textContent = data.group;
        document.getElementById('contactsSubtitle').textContent = `${data.total} contatos encontrados`;
        renderContacts(currentContacts);
        showStep('stepContacts');
    } catch (err) {
        showToast('Erro ao carregar contatos: ' + err.message, 'error');
        showStep('stepGroups');
    }
}

async function exportCSV() {
    if (!selectedGroupId) return;

    const btn = document.getElementById('btnExport');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0;"></div> Exportando...';
    btn.disabled = true;

    try {
        const res = await fetch(`/api/groups/${encodeURIComponent(selectedGroupId)}/export`);

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Extract filename from header
        const disposition = res.headers.get('Content-Disposition');
        const match = disposition && disposition.match(/filename="?(.+?)"?$/);
        a.download = match ? match[1] : `contatos_${selectedGroupName.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`Planilha exportada com ${currentContacts.length} contatos!`, 'success');
    } catch (err) {
        showToast('Erro ao exportar: ' + err.message, 'error');
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
}

async function logout() {
    try {
        await fetch('/api/logout');
        updateStatus('disconnected', 'Desconectado');
        btnLogout.style.display = 'none';
        showStep('stepQR');
        qrLoading.style.display = 'flex';
        qrImage.style.display = 'none';
        currentGroups = [];
        currentContacts = [];
        showToast('Desconectado com sucesso', 'success');
    } catch (err) {
        showToast('Erro ao desconectar', 'error');
    }
}

// ==========================================
// Rendering
// ==========================================
function renderGroups(groups) {
    const grid = document.getElementById('groupsGrid');
    const stats = document.getElementById('groupsStats');

    stats.textContent = `Mostrando ${groups.length} grupo${groups.length !== 1 ? 's' : ''}`;

    if (groups.length === 0) {
        grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <p style="font-size: 1.1rem; margin-bottom: 8px;">Nenhum grupo encontrado</p>
        <p style="font-size: 0.85rem;">Verifique se você possui grupos no WhatsApp</p>
      </div>
    `;
        return;
    }

    grid.innerHTML = groups.map(g => `
    <div class="group-card" onclick="loadContacts('${g.id}', '${escapeHTML(g.name)}')" title="${escapeHTML(g.name)}">
      <div class="group-card-name">${escapeHTML(g.name)}</div>
      <div class="group-card-meta">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        ${g.participantCount} participantes
      </div>
    </div>
  `).join('');
}

function renderContacts(contacts) {
    const tbody = document.getElementById('contactsBody');

    if (contacts.length === 0) {
        tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 40px; color: var(--text-muted);">
          Nenhum contato encontrado
        </td>
      </tr>
    `;
        return;
    }

    tbody.innerHTML = contacts.map((c, i) => `
    <tr>
      <td style="color: var(--text-muted); font-size: 0.8rem;">${i + 1}</td>
      <td class="contact-name">${escapeHTML(c.name) || '<span style="color:var(--text-muted)">Sem nome</span>'}</td>
      <td class="contact-phone">${escapeHTML(c.phoneFormatted)}</td>
      <td>
        <span class="badge-admin ${c.isAdmin ? 'admin' : 'member'}">
          ${c.isSuperAdmin ? 'Criador' : c.isAdmin ? 'Admin' : 'Membro'}
        </span>
      </td>
    </tr>
  `).join('');
}

// ==========================================
// Filtering
// ==========================================
function filterGroups() {
    const query = document.getElementById('searchGroups').value.toLowerCase();
    const filtered = currentGroups.filter(g => g.name.toLowerCase().includes(query));
    renderGroups(filtered);
}

function filterContacts() {
    const query = document.getElementById('searchContacts').value.toLowerCase();
    const filtered = currentContacts.filter(c =>
        (c.name && c.name.toLowerCase().includes(query)) ||
        c.phone.includes(query) ||
        c.phoneFormatted.includes(query)
    );
    renderContacts(filtered);
}

// ==========================================
// Navigation helpers
// ==========================================
function goBackToGroups() {
    showStep('stepGroups');
    currentContacts = [];
    selectedGroupId = null;
    selectedGroupName = '';
}

// ==========================================
// Utilities
// ==========================================
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = `<span class="toast-icon">${icon}</span>${escapeHTML(message)}`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Check initial status
fetch('/api/status')
    .then(r => r.json())
    .then(data => {
        if (data.connected) {
            updateStatus('connected', `Conectado: ${data.user.name}`);
            btnLogout.style.display = 'flex';
            loadGroups();
        }
    })
    .catch(() => { });
