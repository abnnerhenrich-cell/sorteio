import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, where, getDocs, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const cfg = window.SORTEIO_CONFIG || {tipo:'dezenas',label:'Dezenas',itemName:'dezena',total:100,digits:2};

// Firebase novo da Kelly - projeto: sorteio-f5431
// Este mesmo projeto salva dezenas e centenas em coleções separadas.
const firebaseConfig = {
  apiKey: "AIzaSyAP0iTU9ZuHkEpZ8T1SED8kKdTB8nvmbVA",
  authDomain: "sorteio-kelly.firebaseapp.com",
  projectId: "sorteio-kelly",
  storageBucket: "sorteio-kelly.firebasestorage.app",
  messagingSenderId: "792044241286",
  appId: "1:792044241286:web:ff417bb6d36625b835ec07",
  measurementId: "G-CEXRJ22YYD"
};
const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);
const auth = getAuth(app);

// E-mail autorizado para acessar o painel admin.
// Crie este usuário no Firebase Authentication > Users.
const ADMIN_EMAIL = 'lucasnickk@hotmail.com';

let currentSorteioId = null;
let selectedNumeros = [];
let sorteios = [];
let participantes = [];
let ganhadores = [];
let settings = {nome:'Kelly Menezes JB',rodape:'Kelly Menezes JB',cadastroUrl:''};
let adminLogado = false;
let authReady = false;
let renderPendente = false;
let participantesInscritos = false;
let ganhadoresInscritos = false;

const $ = (id) => document.getElementById(id);
const col = (nome) => collection(firestore, `${nome}_${cfg.tipo}`);
const configDoc = () => doc(firestore, 'config', `site_${cfg.tipo}`);
const reservaDoc = (sorteioId, numero) => doc(firestore, `reservas_${cfg.tipo}`, `${sorteioId}_${numero}`);
const whatsDoc = (sorteioId, whatsLimpo) => doc(firestore, `whats_${cfg.tipo}`, `${sorteioId}_${whatsLimpo}`);

function agendarRender(){
  if(renderPendente) return;
  renderPendente = true;
  requestAnimationFrame(() => {
    renderPendente = false;
    renderAll();
  });
}

function quandoLivre(fn, espera = 250){
  if('requestIdleCallback' in window){
    window.requestIdleCallback(fn, {timeout: espera + 1000});
  }else{
    setTimeout(fn, espera);
  }
}

function escapeHtml(v){
  return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function escapeAttr(v){ return escapeHtml(v).replace(/"/g,'&quot;'); }
function capitalize(s){ return String(s||'').charAt(0).toUpperCase()+String(s||'').slice(1); }
function normalizarWhats(w){ return String(w||'').replace(/[^0-9]/g,''); }
function formatDate(d){
  if(!d) return '-';
  if(String(d).includes('-')){
    const [y,m,day]=String(d).split('-');
    return `${day}/${m}/${y}`;
  }
  return d;
}
function limiteSorteio(sorteio){
  const n = Number(sorteio?.limiteNumeros || 1);
  return n === 2 ? 2 : 1;
}
function numerosDoParticipante(p){
  if(Array.isArray(p?.numeros)) return p.numeros;
  if(p?.numero) return String(p.numero).split(',').map(x=>x.trim()).filter(Boolean);
  return [];
}
function textoNumeros(p){ return numerosDoParticipante(p).join(', '); }
function todosNumeros(){
  const start = Number(cfg.start ?? 0);
  const total = Number(cfg.total ?? 100);
  return Array.from({length:total},(_,i)=>String(i + start).padStart(cfg.digits,'0'));
}
function numerosOcupados(sorteioId){
  return participantes
    .filter(p => p.sorteioId === sorteioId)
    .flatMap(p => numerosDoParticipante(p));
}

function hideAllPages(){
  ['homePage','ganhadoresPage','adminPage'].forEach(id => $(id)?.classList.add('hidden'));
}

function showPage(page){
  hideAllPages();

  if(page === 'ganhadores'){
    inscreverGanhadores();
    $('ganhadoresPage')?.classList.remove('hidden');
    renderAll();
    window.scrollTo({top:0, behavior:'smooth'});
    return;
  }

  if(page === 'admin'){
    inscreverParticipantes();
    inscreverGanhadores();
    if(!adminLogado){
      openLogin();
      return;
    }
    $('adminPage')?.classList.remove('hidden');
    renderAll();
    adminTab('dashboard');
    window.scrollTo({top:0, behavior:'smooth'});
    return;
  }

  $('homePage')?.classList.remove('hidden');
  renderAll();
  window.scrollTo({top:0, behavior:'smooth'});
}

function openLogin(){
  const modal = $('loginModal');
  const email = $('adminEmail');
  const senha = $('adminSenha');
  if(email && !email.value) email.value = ADMIN_EMAIL;
  if(senha) senha.value = '';
  if(modal) modal.classList.remove('hidden');
  setTimeout(()=>senha?.focus(), 80);
}

function closeModal(id){
  $(id)?.classList.add('hidden');
}

async function loginAdmin(){
  const email = ($('adminEmail')?.value || '').trim().toLowerCase();
  const senha = $('adminSenha')?.value || '';
  if(!email || !senha) return alert('Preencha e-mail e senha do administrador.');
  if(email !== ADMIN_EMAIL.toLowerCase()) return alert('Este e-mail não está autorizado como admin.');

  const btn = $('btnEntrarAdmin');
  if(btn){ btn.disabled = true; btn.textContent = 'Entrando...'; }
  try{
    await signInWithEmailAndPassword(auth, email, senha);
    closeModal('loginModal');
    showPage('admin');
  }catch(err){
    console.error('Erro no login admin:', err);
    alert('Não foi possível entrar. Confira se o usuário foi criado no Firebase Authentication e se a senha está correta.');
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = '🚀 Entrar no Painel'; }
  }
}

async function logoutAdmin(){
  await signOut(auth);
  adminLogado = false;
  showPage('home');
}

function adminTab(tab){
  if(!adminLogado){
    openLogin();
    return;
  }
  renderAdmin();
  const tabs = {
    dashboard: $('tabDashboard'),
    sorteios: $('tabSorteios'),
    participantes: $('tabParticipantes'),
    premiados: $('tabPremiados'),
    aparencia: $('tabAparencia')
  };
  document.querySelectorAll('.admin-tab').forEach(el => el.classList.add('hidden'));
  tabs[tab]?.classList.remove('hidden');
}

function abrirCadastro(){
  const url = String(settings.cadastroUrl || '').trim();
  if(!url) return alert('Cadastre a URL da banca no Admin > Aparência.');
  window.open(url, '_blank');
}

function renderAll(){
  if($('siteLogo')) $('siteLogo').innerHTML = '<span>' + escapeHtml(settings.nome) + '</span>';
  if($('footerName')) $('footerName').textContent = settings.rodape;
  if($('year')) $('year').textContent = new Date().getFullYear();

  if($('countSorteios')) $('countSorteios').textContent = sorteios.length;
  if($('countParticipantes')) $('countParticipantes').textContent = participantes.length;
  if($('countGanhadores')) $('countGanhadores').textContent = ganhadores.length;

  const visiveis = sorteios.filter(s => s.status === 'ativo' || s.status === 'pausado');
  const sorteiosGrid = $('sorteiosGrid');
  if(sorteiosGrid){
    sorteiosGrid.innerHTML = visiveis.map(s => {
      const ocupadas = numerosOcupados(s.id).length;
      const livres = cfg.total - ocupadas;
      const limite = limiteSorteio(s);
      const pausado = s.status === 'pausado';
      return `<div class="sorteio ${pausado?'paused-card':''}">
        <div>
          <span class="tag ${pausado?'paused-tag':''}">${pausado?'PAUSADO':'ATIVO'}</span>
          <h3>${escapeHtml(s.titulo)}</h3>
          <p>${escapeHtml(s.descricao || '')}</p>
          <div class="price">${escapeHtml(s.premio)}</div>
          <p>Data: ${formatDate(s.data)}</p>
          <span class="limit-chip">Cada cliente escolhe ${limite} ${cfg.itemName}${limite>1?'s':''}</span>
          <div class="numero-info">
            <span class="mini-tag">${livres} ${cfg.itemName}s livres</span>
            <span class="mini-tag">${ocupadas} escolhidas</span>
          </div>
          ${pausado?'<div class="notice">Sorteio pausado: aparece para todos, mas não aceita novas escolhas.</div>':''}
        </div>
        <button type="button" class="btn ${pausado?'secondary':'ok'}" ${pausado?'disabled':''} data-participar="${s.id}">${pausado?'⏸️ Pausado':'🎯 Quero Participar'}</button>
      </div>`;
    }).join('') || `<div class="sorteio">Nenhum sorteio de ${cfg.label.toLowerCase()} disponível no momento.</div>`;
  }

  const ganhadoresGrid = $('ganhadoresGrid');
  if(ganhadoresGrid){
    ganhadoresGrid.innerHTML = ganhadores.map(g => `<div class="sorteio">
      <span class="tag">GANHADOR</span>
      <h3>${escapeHtml(g.nome)}</h3>
      <p>Sorteio: ${escapeHtml(g.sorteioTitulo)}</p>
      <div class="price">${escapeHtml(g.premio)}</div>
      <p>${capitalize(cfg.itemName)}: <strong>${escapeHtml(g.numero || textoNumeros(g) || '-')}</strong></p>
      <p>WhatsApp: ${escapeHtml(g.whats)}</p>
      <p>Data: ${formatDate(g.data)}</p>
    </div>`).join('') || '<div class="sorteio">Nenhum ganhador divulgado ainda.</div>';
  }

  if(adminLogado) renderAdmin();
}

function openParticipar(id){
  inscreverParticipantes();
  currentSorteioId = id;
  selectedNumeros = [];
  const s = sorteios.find(x => x.id === id);
  if(!s) return alert('Sorteio não encontrado.');
  if(s.status === 'pausado') return alert('Este sorteio está pausado. Ele aparece para todos, mas não aceita escolhas agora.');

  const ocupadas = numerosOcupados(id);
  const limite = limiteSorteio(s);

  $('participarInfo').innerHTML = `<p class="lead"><strong>${escapeHtml(s.titulo)}</strong><br>${escapeHtml(s.premio)}</p>
    <div class="notice">Escolha ${limite} ${cfg.itemName}${limite>1?'s':''} disponível${limite>1?'is':''}. Cada WhatsApp pode participar uma vez neste sorteio.</div>
    <div id="contadorEscolhas" class="choice-counter">Selecionadas: 0 de ${limite}</div>
    <div class="numeros-grid">${todosNumeros().map(n => `<button type="button" class="numero-btn ${ocupadas.includes(n)?'taken':''}" ${ocupadas.includes(n)?'disabled':''} data-numero="${n}">${n}</button>`).join('')}</div>
    <div id="numeroEscolhido" class="notice hidden"></div>`;

  if($('pNome')) $('pNome').value = '';
  if($('pWhats')) $('pWhats').value = '';
  $('participarModal')?.classList.remove('hidden');
}

function selecionarNumero(numero){
  const s = sorteios.find(x => x.id === currentSorteioId);
  const limite = limiteSorteio(s);

  if(selectedNumeros.includes(numero)){
    selectedNumeros = selectedNumeros.filter(n => n !== numero);
  }else{
    if(selectedNumeros.length >= limite){
      alert(`Você só pode escolher ${limite} ${cfg.itemName}${limite>1?'s':''} neste sorteio.`);
      return;
    }
    selectedNumeros.push(numero);
  }

  document.querySelectorAll('.numero-btn').forEach(btn => {
    btn.classList.toggle('selected', selectedNumeros.includes(btn.dataset.numero));
  });

  const contador = $('contadorEscolhas');
  if(contador) contador.textContent = `Selecionadas: ${selectedNumeros.length} de ${limite}`;

  const box = $('numeroEscolhido');
  if(box){
    box.textContent = selectedNumeros.length ? `${capitalize(cfg.itemName)} escolhida${selectedNumeros.length>1?'s':''}: ${selectedNumeros.join(', ')}` : '';
    box.classList.toggle('hidden', selectedNumeros.length === 0);
  }
}

async function salvarParticipacao(){
  const nome = $('pNome')?.value.trim() || '';
  const whats = $('pWhats')?.value.trim() || '';
  const whatsLimpo = normalizarWhats(whats);

  const s = sorteios.find(x => x.id === currentSorteioId);
  if(!s) return alert('Sorteio não encontrado.');
  if(s.status === 'pausado') return alert('Este sorteio está pausado e não aceita novas escolhas.');

  const limite = limiteSorteio(s);
  if(!nome || !whats) return alert('Preencha nome e WhatsApp.');
  if(whatsLimpo.length < 10 || whatsLimpo.length > 11) return alert('Digite um WhatsApp válido usando apenas números, com DDD.');
  if(selectedNumeros.length !== limite) return alert(`Escolha exatamente ${limite} ${cfg.itemName}${limite>1?'s':''}.`);

  const numerosEscolhidos = [...selectedNumeros];

  try{
    await runTransaction(firestore, async (transaction) => {
      const whatsRef = whatsDoc(s.id, whatsLimpo);
      const whatsSnap = await transaction.get(whatsRef);
      if(whatsSnap.exists()){
        throw new Error('WHATS_DUPLICADO');
      }

      const reservaRefs = numerosEscolhidos.map(numero => reservaDoc(s.id, numero));
      for(let i = 0; i < reservaRefs.length; i++){
        const reservaSnap = await transaction.get(reservaRefs[i]);
        if(reservaSnap.exists()){
          throw new Error(`NUMERO_OCUPADO:${numerosEscolhidos[i]}`);
        }
      }

      const participanteRef = doc(col('participantes'));
      const payload = {
        tipo: cfg.tipo,
        sorteioId: s.id,
        sorteioTitulo: s.titulo,
        nome,
        whats,
        whatsLimpo,
        numeros: numerosEscolhidos,
        numero: numerosEscolhidos.join(', '),
        limiteNumeros: limite,
        data: new Date().toISOString().slice(0,10),
        criadoEm: serverTimestamp()
      };

      transaction.set(participanteRef, payload);
      transaction.set(whatsRef, {
        tipo: cfg.tipo,
        sorteioId: s.id,
        whatsLimpo,
        participanteId: participanteRef.id,
        criadoEm: serverTimestamp()
      });

      reservaRefs.forEach((ref, i) => {
        transaction.set(ref, {
          tipo: cfg.tipo,
          sorteioId: s.id,
          numero: numerosEscolhidos[i],
          participanteId: participanteRef.id,
          whatsLimpo,
          criadoEm: serverTimestamp()
        });
      });
    });

    selectedNumeros = [];
    closeModal('participarModal');
    alert('Participação confirmada! Boa sorte.');
  }catch(err){
    if(err?.message === 'WHATS_DUPLICADO') return alert('Este WhatsApp já participou deste sorteio.');
    if(String(err?.message || '').startsWith('NUMERO_OCUPADO:')){
      const numero = String(err.message).split(':')[1];
      return alert(`A ${cfg.itemName} ${numero} já foi escolhida. Atualize e escolha outra.`);
    }
    mostrarErroFirebase(err, 'salvar participação');
  }
}

function renderAdmin(){
  if(!adminLogado) return;

  if($('tabDashboard')) $('tabDashboard').innerHTML = `
    <h2 class="section-title">Painel Admin - ${cfg.label}</h2>
    <div class="stats">
      <div class="stat"><strong>${sorteios.length}</strong>Sorteios</div>
      <div class="stat"><strong>${participantes.length}</strong>Participantes</div>
      <div class="stat"><strong>${ganhadores.length}</strong>Premiados</div>
    </div>
    <div class="notice">Firebase ativo: ${cfg.itemName}s atualizam em tempo real.</div>`;

  if($('tabSorteios')) $('tabSorteios').innerHTML = `
    <h2 class="section-title">Gerenciar Sorteios</h2>
    <div class="form">
      <label>Título do sorteio</label>
      <input id="sTitulo" placeholder="Ex: Sorteio das 21H">
      <label>Descrição</label>
      <textarea id="sDesc" placeholder="Descrição do sorteio"></textarea>
      <label>Prêmio</label>
      <input id="sPremio" placeholder="Ex: R$ 50,00">
      <label>Data</label>
      <input id="sData" type="date">
      <label>Quantidade que cada cliente pode escolher</label>
      <select id="sLimiteNumeros">
        <option value="1">1 ${cfg.itemName}</option>
        <option value="2">2 ${cfg.itemName}s</option>
      </select>
      <button type="button" class="btn ok" id="btnCriarSorteio">➕ Criar Sorteio</button>
    </div><br>${tableSorteios()}`;

  if($('tabParticipantes')) $('tabParticipantes').innerHTML = `
    <h2 class="section-title">Participantes</h2>
    <div class="form">
      <label>Filtrar participantes por ${cfg.itemName}</label>
      <select id="filtroNumeroParticipante">
        <option value="">Todas</option>
        ${todosNumeros().map(n => `<option value="${n}">${n}</option>`).join('')}
      </select>
      <div id="resultadoFiltroParticipante" class="notice">Selecione uma ${cfg.itemName} para ver quem escolheu.</div>
      <button type="button" class="btn danger" id="btnLimparParticipantes">🗑️ Excluir histórico de participantes</button>
    </div><br>${tableParticipantes()}`;

  if($('tabPremiados')) $('tabPremiados').innerHTML = `
    <h2 class="section-title">Selecionar Ganhador</h2>
    <div class="form">
      <div class="notice">Filtro rápido: selecione uma ${cfg.itemName} e veja automaticamente quem escolheu.</div>
      <label>Filtrar por ${cfg.itemName}</label>
      <select id="filtroNumeroGanhador">
        <option value="">Selecione uma ${cfg.itemName}</option>
        ${todosNumeros().map(n => `<option value="${n}">${n}</option>`).join('')}
      </select>
      <div id="resultadoFiltroGanhador" class="notice">Escolha uma ${cfg.itemName} para listar os participantes.</div>
      <label>Confirmar ganhador manualmente</label>
      <select id="ganhadorManual">
        <option value="">Selecione o ganhador</option>
        ${participantes.map(p => `<option value="${p.id}">${escapeHtml(textoNumeros(p))} - ${escapeHtml(p.nome)} | ${escapeHtml(p.sorteioTitulo)}</option>`).join('')}
      </select>
      <button type="button" class="btn ok" id="btnConfirmarGanhador">🏆 Confirmar Ganhador</button>
      <button type="button" class="btn danger" id="btnLimparGanhadores">🗑️ Excluir histórico de ganhadores</button>
    </div><br>${tableGanhadores()}`;

  if($('tabAparencia')) $('tabAparencia').innerHTML = `
    <h2 class="section-title">Aparência</h2>
    <div class="form">
      <label>Nome do site</label>
      <input id="setNome" value="${escapeAttr(settings.nome)}">
      <label>Rodapé/assinatura</label>
      <input id="setRodape" value="${escapeAttr(settings.rodape)}">
      <label>URL do botão de cadastro</label>
      <input id="setCadastroUrl" placeholder="https://seulinkdecadastro.com" value="${escapeAttr(settings.cadastroUrl || '')}">
      <button type="button" class="btn ok" id="btnSalvarAparencia">Salvar Aparência</button>
      <button type="button" class="btn danger" id="btnLimparTudo">Limpar todos os dados de ${cfg.label}</button>
    </div>`;
}

function tableSorteios(){
  return `<div class="table-wrap"><table class="table">
    <tr><th>Título</th><th>Prêmio</th><th>Escolhas</th><th>${cfg.label}</th><th>Status</th><th>Ação</th></tr>
    ${sorteios.map(s => {
      const qtd = numerosOcupados(s.id).length;
      const limite = limiteSorteio(s);
      return `<tr>
        <td>${escapeHtml(s.titulo)}</td><td>${escapeHtml(s.premio)}</td><td>${limite}</td><td>${qtd}/${cfg.total}</td><td>${s.status}</td>
        <td><button type="button" class="btn secondary" data-toggle-sorteio="${s.id}">Ativar/Pausar</button>
        <button type="button" class="btn danger" data-excluir-sorteio="${s.id}">Excluir</button></td>
      </tr>`;
    }).join('')}
  </table></div>`;
}

function tableParticipantes(){
  return `<div class="table-wrap"><table class="table">
    <tr><th>${capitalize(cfg.itemName)}(s)</th><th>Nome</th><th>WhatsApp</th><th>Sorteio</th></tr>
    ${participantes.map(p => `<tr><td><strong>${escapeHtml(textoNumeros(p) || '-')}</strong></td><td>${escapeHtml(p.nome)}</td><td>${escapeHtml(p.whats)}</td><td>${escapeHtml(p.sorteioTitulo)}</td></tr>`).join('')}
  </table></div>`;
}

function tableGanhadores(){
  return `<div class="table-wrap"><table class="table">
    <tr><th>${capitalize(cfg.itemName)}(s)</th><th>Nome</th><th>Sorteio</th><th>Prêmio</th><th>Data</th></tr>
    ${ganhadores.map(g => `<tr><td><strong>${escapeHtml(g.numero || textoNumeros(g) || '-')}</strong></td><td>${escapeHtml(g.nome)}</td><td>${escapeHtml(g.sorteioTitulo)}</td><td>${escapeHtml(g.premio)}</td><td>${formatDate(g.data)}</td></tr>`).join('')}
  </table></div>`;
}

async function criarSorteio(){
  if(window.__criandoSorteio) return;
  window.__criandoSorteio = true;

  const titulo = $('sTitulo')?.value.trim() || '';
  const descricao = $('sDesc')?.value.trim() || '';
  const premio = $('sPremio')?.value.trim() || '';
  const data = $('sData')?.value || new Date().toISOString().slice(0,10);
  const limiteNumeros = Number($('sLimiteNumeros')?.value || 1);

  if(!titulo){
    window.__criandoSorteio = false;
    return alert('Preencha o título do sorteio.');
  }

  try{
    const payload = {
      tipo: cfg.tipo,
      titulo,
      descricao: descricao || `Escolha ${limiteNumeros} ${cfg.itemName}${limiteNumeros>1?'s':''} para participar.`,
      premio: premio || '',
      limiteNumeros,
      status: 'ativo',
      data,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    };

    const ref = await addDoc(col('sorteios'), payload);
    const confirmado = await getDoc(ref);

    if(!confirmado.exists()){
      throw new Error('O Firebase não confirmou a gravação do sorteio.');
    }

    alert('Sorteio criado e salvo no Firebase com sucesso!');

    if($('sTitulo')) $('sTitulo').value = '';
    if($('sDesc')) $('sDesc').value = '';
    if($('sPremio')) $('sPremio').value = '';
    if($('sData')) $('sData').value = '';
    if($('sLimiteNumeros')) $('sLimiteNumeros').value = '1';

    renderAll();
    adminTab('sorteios');
  }catch(err){
    mostrarErroFirebase(err, 'criar sorteio');
  }finally{
    window.__criandoSorteio = false;
  }
}

async function toggleSorteio(id){
  const s = sorteios.find(x => x.id === id);
  if(!s) return;
  try{
    await updateDoc(doc(firestore, `sorteios_${cfg.tipo}`, id), {status:s.status==='ativo'?'pausado':'ativo'});
  }catch(err){
    mostrarErroFirebase(err, 'ativar/pausar sorteio');
  }
}

async function excluirSorteio(id){
  if(!confirm('Excluir este sorteio? Isso também apaga participantes e ganhadores dele.')) return;
  await deleteDoc(doc(firestore, `sorteios_${cfg.tipo}`, id));
  const partSnap = await getDocs(query(col('participantes'), where('sorteioId','==',id)));
  for(const item of partSnap.docs) await deleteDoc(doc(firestore, `participantes_${cfg.tipo}`, item.id));
  const ganhSnap = await getDocs(query(col('ganhadores'), where('sorteioId','==',id)));
  for(const item of ganhSnap.docs) await deleteDoc(doc(firestore, `ganhadores_${cfg.tipo}`, item.id));
  const resSnap = await getDocs(query(collection(firestore, `reservas_${cfg.tipo}`), where('sorteioId','==',id)));
  for(const item of resSnap.docs) await deleteDoc(doc(firestore, `reservas_${cfg.tipo}`, item.id));
  const whatsSnap = await getDocs(query(collection(firestore, `whats_${cfg.tipo}`), where('sorteioId','==',id)));
  for(const item of whatsSnap.docs) await deleteDoc(doc(firestore, `whats_${cfg.tipo}`, item.id));
}


function participantesPorNumero(numero){
  return participantes.filter(p => numerosDoParticipante(p).includes(numero));
}

function renderFiltroNumero(targetId, numero){
  const box = $(targetId);
  if(!box) return;
  if(!numero){
    box.innerHTML = `Selecione uma ${cfg.itemName} para ver quem escolheu.`;
    return;
  }
  const lista = participantesPorNumero(numero);
  box.innerHTML = lista.length
    ? `<strong>${lista.length} participante(s) escolheram ${escapeHtml(numero)}:</strong><br>` + lista.map(p => `• ${escapeHtml(p.nome)} — ${escapeHtml(p.whats)} — ${escapeHtml(p.sorteioTitulo)}`).join('<br>')
    : `Ninguém escolheu a ${cfg.itemName} ${escapeHtml(numero)} ainda.`;
}

async function limparGanhadores(){
  if(!confirm(`Excluir todo o histórico de ganhadores de ${cfg.label}?`)) return;
  for(const g of ganhadores) await deleteDoc(doc(firestore, `ganhadores_${cfg.tipo}`, g.id));
  alert('Histórico de ganhadores excluído.');
}

async function limparParticipantes(){
  if(!confirm(`Excluir todos os participantes de ${cfg.label}? Isso também libera as escolhas.`)) return;
  for(const p of participantes) await deleteDoc(doc(firestore, `participantes_${cfg.tipo}`, p.id));
  const resSnap = await getDocs(collection(firestore, `reservas_${cfg.tipo}`));
  for(const item of resSnap.docs) await deleteDoc(doc(firestore, `reservas_${cfg.tipo}`, item.id));
  const whatsSnap = await getDocs(collection(firestore, `whats_${cfg.tipo}`));
  for(const item of whatsSnap.docs) await deleteDoc(doc(firestore, `whats_${cfg.tipo}`, item.id));
  alert('Histórico de participantes excluído e escolhas liberadas.');
}

async function sortearGanhador(){
  const participanteId = $('ganhadorManual')?.value || '';
  if(!participanteId) return alert('Selecione um participante.');
  const p = participantes.find(x => x.id === participanteId);
  if(!p) return alert('Participante não encontrado.');
  const s = sorteios.find(x => x.id === p.sorteioId);
  const nums = numerosDoParticipante(p);
  const ja = ganhadores.some(g => g.participanteId === p.id);
  if(ja) return alert('Esse participante já está marcado como ganhador.');

  await addDoc(col('ganhadores'), {
    tipo: cfg.tipo,
    participanteId: p.id,
    nome: p.nome,
    whats: p.whats,
    numeros: nums,
    numero: nums.join(', '),
    sorteioId: p.sorteioId,
    sorteioTitulo: p.sorteioTitulo,
    premio: s?.premio || '',
    data: new Date().toISOString().slice(0,10),
    criadoEm: serverTimestamp()
  });
  alert('Ganhador confirmado: ' + p.nome);
}

async function salvarAparencia(){
  await setDoc(configDoc(), {
    nome: $('setNome')?.value || settings.nome,
    rodape: $('setRodape')?.value || settings.rodape,
    cadastroUrl: $('setCadastroUrl')?.value || ''
  }, {merge:true});
  alert('Aparência salva com sucesso!');
}

async function limparTudo(){
  if(!confirm(`Tem certeza? Isso apaga sorteios, participantes e ganhadores de ${cfg.label}.`)) return;
  for(const s of sorteios) await deleteDoc(doc(firestore, `sorteios_${cfg.tipo}`, s.id));
  for(const p of participantes) await deleteDoc(doc(firestore, `participantes_${cfg.tipo}`, p.id));
  for(const g of ganhadores) await deleteDoc(doc(firestore, `ganhadores_${cfg.tipo}`, g.id));
  const resSnap = await getDocs(collection(firestore, `reservas_${cfg.tipo}`));
  for(const item of resSnap.docs) await deleteDoc(doc(firestore, `reservas_${cfg.tipo}`, item.id));
  const whatsSnap = await getDocs(collection(firestore, `whats_${cfg.tipo}`));
  for(const item of whatsSnap.docs) await deleteDoc(doc(firestore, `whats_${cfg.tipo}`, item.id));
}

function bindEvents(){
  if(window.__kellyController){
    window.__kellyController.abort();
  }
  window.__kellyController = new AbortController();
  const signal = window.__kellyController.signal;

  const on = (id, event, fn) => {
    const el = document.getElementById(id);
    if(el) el.addEventListener(event, fn, {signal});
  };

  on('btnInicio', 'click', () => showPage('home'));
  on('btnGanhadores', 'click', () => showPage('ganhadores'));
  on('btnVerGanhadores', 'click', () => showPage('ganhadores'));
  on('btnAdmin', 'click', () => openLogin());
  on('btnEntrarAdmin', 'click', () => loginAdmin());
  on('btnParticiparAgora', 'click', () => document.getElementById('sorteios')?.scrollIntoView({behavior:'smooth'}));
  on('btnCadastro', 'click', () => abrirCadastro());
  on('btnConfirmarParticipacao', 'click', () => salvarParticipacao());
  on('btnSairAdmin', 'click', () => logoutAdmin());

  document.addEventListener('click', async (e) => {
    const close = e.target.closest('[data-close-modal]');
    if(close){
      e.preventDefault();
      closeModal(close.dataset.closeModal);
      return;
    }

    const participar = e.target.closest('[data-participar]');
    if(participar){
      e.preventDefault();
      openParticipar(participar.dataset.participar);
      return;
    }

    const numero = e.target.closest('[data-numero]');
    if(numero){
      e.preventDefault();
      selecionarNumero(numero.dataset.numero);
      return;
    }

    const adminButton = e.target.closest('[data-admin-tab]');
    if(adminButton){
      e.preventDefault();
      adminTab(adminButton.dataset.adminTab);
      return;
    }

    const criar = e.target.closest('#btnCriarSorteio');
    if(criar){
      e.preventDefault();
      if(criar.dataset.loading === '1') return;
      criar.dataset.loading = '1';
      criar.disabled = true;
      try{
        await criarSorteio();
      }finally{
        criar.dataset.loading = '0';
        criar.disabled = false;
      }
      return;
    }

    const filtroG = e.target.closest('#filtroNumeroGanhador');
    if(filtroG){
      renderFiltroNumero('resultadoFiltroGanhador', filtroG.value);
      return;
    }

    const filtroP = e.target.closest('#filtroNumeroParticipante');
    if(filtroP){
      renderFiltroNumero('resultadoFiltroParticipante', filtroP.value);
      return;
    }

    const ganhador = e.target.closest('#btnConfirmarGanhador');
    if(ganhador){
      e.preventDefault();
      sortearGanhador();
      return;
    }

    const salvar = e.target.closest('#btnSalvarAparencia');
    if(salvar){
      e.preventDefault();
      salvarAparencia();
      return;
    }

    const limparG = e.target.closest('#btnLimparGanhadores');
    if(limparG){
      e.preventDefault();
      limparGanhadores();
      return;
    }

    const limparP = e.target.closest('#btnLimparParticipantes');
    if(limparP){
      e.preventDefault();
      limparParticipantes();
      return;
    }

    const limpar = e.target.closest('#btnLimparTudo');
    if(limpar){
      e.preventDefault();
      limparTudo();
      return;
    }

    const toggle = e.target.closest('[data-toggle-sorteio]');
    if(toggle){
      e.preventDefault();
      toggleSorteio(toggle.dataset.toggleSorteio);
      return;
    }

    const excluir = e.target.closest('[data-excluir-sorteio]');
    if(excluir){
      e.preventDefault();
      excluirSorteio(excluir.dataset.excluirSorteio);
      return;
    }
  }, {signal});

  document.addEventListener('change', e => {
    if(e.target?.id === 'filtroNumeroGanhador') renderFiltroNumero('resultadoFiltroGanhador', e.target.value);
    if(e.target?.id === 'filtroNumeroParticipante') renderFiltroNumero('resultadoFiltroParticipante', e.target.value);
  }, {signal});

  document.getElementById('adminSenha')?.addEventListener('keydown', e => {
    if(e.key === 'Enter') loginAdmin();
  }, {signal});
  document.getElementById('adminEmail')?.addEventListener('keydown', e => {
    if(e.key === 'Enter') loginAdmin();
  }, {signal});
}


let firebaseAvisoMostrado = false;
function mostrarErroFirebase(erro, acao='operação'){
  console.error('Erro Firebase em '+acao+':', erro);
  if(firebaseAvisoMostrado) return;
  firebaseAvisoMostrado = true;
  alert(
    'Erro no Firebase ao tentar fazer '+acao+'.\n\n' +
    'Se o sorteio aparece e some ao atualizar, quase sempre é porque o Firestore está bloqueando a gravação/leitura.\n\n' +
    'Cole e publique as regras do arquivo firebase-rules.txt em Firestore Database > Regras.'
  );
  setTimeout(()=>firebaseAvisoMostrado=false, 4000);
}

function iniciarAuth(){
  onAuthStateChanged(auth, user => {
    authReady = true;
    adminLogado = !!(user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
    if(user && !adminLogado){
      signOut(auth);
      alert('Este login não tem permissão de administrador.');
    }
    if(adminLogado){
      closeModal('loginModal');
      if(location.hash === '#admin') showPage('admin');
    }else if(!adminLogado && !($('adminPage')?.classList.contains('hidden'))){
      showPage('home');
    }
    renderAll();
  });
}

let unsubscribeSorteios = null;
let unsubscribeParticipantes = null;
let unsubscribeGanhadores = null;
let unsubscribeConfig = null;

function inscreverParticipantes(){
  if(participantesInscritos) return;
  participantesInscritos = true;
  unsubscribeParticipantes = onSnapshot(col('participantes'), snap => {
    participantes = snap.docs.map(d => ({id:d.id, ...d.data()}));
    agendarRender();
  }, erro => mostrarErroFirebase(erro, 'ler participantes'));
}

function inscreverGanhadores(){
  if(ganhadoresInscritos) return;
  ganhadoresInscritos = true;
  unsubscribeGanhadores = onSnapshot(col('ganhadores'), snap => {
    ganhadores = snap.docs.map(d => ({id:d.id, ...d.data()}));
    agendarRender();
  }, erro => mostrarErroFirebase(erro, 'ler ganhadores'));
}

function iniciarFirebase(){
  // Primeiro carrega somente o essencial para a tela abrir rápido no celular.
  unsubscribeConfig = onSnapshot(configDoc(), snap => {
    if(snap.exists()) settings = {...settings, ...snap.data()};
    agendarRender();
  }, erro => mostrarErroFirebase(erro, 'ler configurações'));

  unsubscribeSorteios = onSnapshot(col('sorteios'), snap => {
    sorteios = snap.docs
      .map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => String(b.data||'').localeCompare(String(a.data||'')));
    agendarRender();
  }, erro => mostrarErroFirebase(erro, 'ler sorteios'));

  // Participantes e ganhadores entram depois, para não travar a primeira tela no iPhone/Safari.
  quandoLivre(() => inscreverParticipantes(), 600);
  quandoLivre(() => inscreverGanhadores(), 1000);
}

if(window.matchMedia && window.matchMedia('(pointer: fine)').matches){
  window.addEventListener('mousemove', e => {
    document.body.style.setProperty('--mx', `${(e.clientX/window.innerWidth)*100}%`);
    document.body.style.setProperty('--my', `${(e.clientY/window.innerHeight)*100}%`);
  }, {passive:true});
}
// deixa disponível também para qualquer onclick antigo que tenha sobrado
Object.assign(window, {
  showPage, openLogin, loginAdmin, closeModal, adminTab, abrirCadastro,
  openParticipar, selecionarNumero, salvarParticipacao
});


Object.assign(window, {
  showPage, openLogin, loginAdmin, closeModal, adminTab, abrirCadastro,
  openParticipar, selecionarNumero, salvarParticipacao, logoutAdmin
});


function iniciarInterfaceSegura(){
  bindEvents();
  if(location.hash === '#admin') openLogin();
  renderAll();
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', iniciarInterfaceSegura, {once:true});
}else{
  iniciarInterfaceSegura();
}

iniciarAuth();
iniciarFirebase();
