(function () {
  'use strict';

  // SUPABASE CONFIG & CLIENT
  const SUPABASE_URL = 'https://gadnzexvcdtzxatysktn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_6D3RGeNdk_YzTzBwVTnCrg_J4n_8xvR';
  const supabaseClient = window.supabase && window.supabase.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { apikey: SUPABASE_KEY } }
  }) : null;

  var ST_PEND = 'Pendente';
  var ST_TOTVS = 'Bloqueado por alçada';
  var ST_DONE = 'Concluído';
  var URG_ORDER = { 'Alta': 0, 'Média': 1, 'Baixa': 2 };

  var currentUser = null;

  function pfLabel(u) { return u.nome; }
  async function loadProfile(authUser) {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('id, nome, perfil, setor')
      .eq('id', authUser.id)
      .single();

    if (error) throw error;
    if (!data || !data.nome || !['ADMIN', 'MON', 'PF'].includes(data.perfil) ||
        (data.perfil === 'PF' && !['Embalagem', 'Química'].includes(data.setor)) ||
        (data.perfil !== 'PF' && data.setor)) {
      throw new Error('Perfil de acesso inválido ou incompleto.');
    }

    return {
      id: data.id,
      email: authUser.email,
      nome: data.nome,
      perfil: data.perfil,
      setor: data.setor
    };
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function today0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(n) { var d = today0(); d.setDate(d.getDate() + n); return toISO(d); }
  function daysLeft(iso) { return Math.round((parseISO(iso) - today0()) / 86400000); }
  function fmtDate(iso) { if(!iso) return ''; var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Trava de campos numéricos
  document.addEventListener('input', function(e) {
    if (e.target.classList.contains('only-numbers') || e.target.id === 'numnf' || e.target.classList.contains('pedido-input')) {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
    }
  });

  var requisicoes = [];
  var excluidos = [];

  function $(id) { return document.getElementById(id); }

  function updateThemeToggle(button, isDark) {
    button.setAttribute('aria-label', isDark ? 'Ativar modo claro' : 'Ativar modo escuro');
    button.title = isDark ? 'Ativar modo claro' : 'Ativar modo escuro';
    button.innerHTML = '<i class="fa-solid ' + (isDark ? 'fa-sun' : 'fa-moon') + '" aria-hidden="true"></i><span>Modo ' + (isDark ? 'claro' : 'escuro') + '</span>';
  }

  function setTheme(isDark) {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    document.querySelectorAll('.theme-toggle').forEach(function (button) {
      updateThemeToggle(button, isDark);
    });
    try {
      localStorage.setItem('portal-theme', isDark ? 'dark' : 'light');
    } catch (error) {
      console.warn('Não foi possível salvar a preferência de tema neste navegador:', error);
    }
  }

  var isDarkTheme = document.documentElement.classList.contains('dark');
  document.querySelectorAll('.theme-toggle').forEach(function (button) {
    updateThemeToggle(button, isDarkTheme);
    button.addEventListener('click', function () {
      isDarkTheme = !document.documentElement.classList.contains('dark');
      setTheme(isDarkTheme);
    });
  });
  document.documentElement.style.colorScheme = isDarkTheme ? 'dark' : 'light';

  function statusBadge(st) {
    if (st === ST_PEND) return '<span class="inline-flex items-center gap-1.5 bg-slate-200 text-slate-700 text-xs font-semibold px-2.5 py-1 rounded-full"><i class="fa-solid fa-clock"></i>Pendente</span>';
    if (st === ST_DONE) return '<span class="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-800 text-xs font-semibold px-2.5 py-1 rounded-full"><i class="fa-solid fa-circle-check"></i>Concluído</span>';
    return '<span class="inline-flex items-center gap-1.5 bg-amber-100 text-amber-800 text-xs font-semibold px-2.5 py-1 rounded-full"><i class="fa-solid fa-lock"></i>Bloqueado por alçada</span>';
  }

  function urgBadge(u) {
    var map = { 'Alta': 'bg-red-100 text-red-700', 'Média': 'bg-orange-100 text-orange-700', 'Baixa': 'bg-emerald-100 text-emerald-700' };
    var label = u === 'Alta' ? 'Alta/Crítica' : u;
    return '<span class="inline-block text-xs font-semibold px-2 py-0.5 rounded ' + map[u] + '">' + label + '</span>';
  }

  function dueInfo(r) {
    var d = daysLeft(r.vencimento);
    var done = r.status === ST_DONE;
    var text, cls;
    if (done) { text = 'Concluído'; cls = 'text-slate-400'; }
    else if (d < 0) { text = 'Vencida há ' + Math.abs(d) + (Math.abs(d) === 1 ? ' dia' : ' dias'); cls = 'text-red-600 font-bold'; }
    else if (d === 0) { text = 'Vence hoje!'; cls = 'text-red-600 font-bold'; }
    else if (d < 3) { text = 'Vence em ' + d + (d === 1 ? ' dia' : ' dias'); cls = 'text-red-600 font-bold'; }
    else { text = 'Faltam ' + d + ' dias'; cls = 'text-slate-500'; }
    return { days: d, text: text, cls: cls, critical: !done && d < 3 };
  }

  function toast(msg, type) {
    var colors = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-navy-800' };
    var icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
    var el = document.createElement('div');
    el.className = 'toast ' + (colors[type] || colors.info) + ' text-white text-sm rounded-lg shadow-lg px-4 py-3 flex items-center gap-2 max-w-sm';
    el.innerHTML = '<i class="fa-solid ' + (icons[type] || icons.info) + '"></i><span>' + esc(msg) + '</span>';
    $('toasts').appendChild(el);
    setTimeout(function () { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 300); }, 3500);
  }

  function matchPessoa(r, q) {
    if (!q) return true;
    var qq = q.replace(/^#/, '');
    return [r.solicitante, r.pontoFocal, r.nf || '', r.pedido || '', r.id || ''].some(function (v) {
      return String(v).toLowerCase().indexOf(qq) !== -1;
    });
  }

  function getNfStoragePath(value) {
    if (typeof value !== 'string' || !value) return null;
    if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(value) && value.indexOf('..') === -1) return value;

    try {
      var fileUrl = new URL(value, window.location.href);
      if (fileUrl.origin !== new URL(SUPABASE_URL).origin) return null;
      var marker = '/storage/v1/object/';
      var objectIndex = fileUrl.pathname.indexOf(marker);
      if (objectIndex === -1) return null;

      var parts = fileUrl.pathname.slice(objectIndex + marker.length).split('/');
      if (parts.length < 3 || (parts[0] !== 'public' && parts[0] !== 'sign') || parts[1] !== 'notas-fiscais') return null;
      var path = decodeURIComponent(parts.slice(2).join('/'));
      return path.split('/').some(function (part) { return part === '..'; }) ? null : path;
    } catch (error) { return null; }
  }

  async function createNfSignedUrl(value) {
    var filePath = getNfStoragePath(value);
    if (!filePath) return '';

    var { data, error } = await supabaseClient.storage
      .from('notas-fiscais')
      .createSignedUrl(filePath, 3600);

    if (error) {
      console.error('Não foi possível gerar acesso temporário à Nota Fiscal:', error);
      return '';
    }
    return data.signedUrl;
  }

  function renderViewNfBtn(r) {
    var fileLink = r.url_nf || r.fileUrl;
    if (!fileLink) return '<span class="text-xs text-slate-400">Sem anexo</span>';
    var fileUrl;
    try {
      fileUrl = new URL(fileLink, window.location.href);
    } catch (error) {
      return '<span class="text-xs text-slate-400">Anexo indisponível</span>';
    }
    if (fileUrl.origin !== new URL(SUPABASE_URL).origin ||
        !fileUrl.pathname.startsWith('/storage/v1/object/sign/notas-fiscais/')) {
      return '<span class="text-xs text-slate-400">Anexo indisponível</span>';
    }
    return '<a href="' + esc(fileUrl.href) + '" target="_blank" rel="noopener noreferrer" aria-label="Abrir nota fiscal em nova aba" class="inline-flex items-center gap-1.5 text-xs font-semibold text-navy-700 bg-navy-50 hover:bg-navy-100 border border-navy-200 px-2.5 py-1 rounded-md transition">' +
           '<i class="fa-solid fa-file-pdf text-red-600"></i> Ver NF' +
           '</a>';
  }

  function canDelete(r) {
    if (!currentUser) return false;
    if (currentUser.perfil === 'MON') return true;
    if (currentUser.perfil === 'PF') {
      return r.setor === currentUser.setor && r.status === ST_PEND;
    }
    return false;
  }

  // FETCH DATA FROM SUPABASE
  async function carregarDadosSupabase() {
    if (!supabaseClient || !currentUser) return;

    try {
      const { data, error } = await supabaseClient.from('requisicoes').select('*').order('created_at', { ascending: false });
      if (error) {
        console.error('Erro ao buscar do Supabase:', error);
        toast('Erro ao conectar ao banco de dados Supabase.', 'error');
        return;
      }
      if (data) {
        const rows = await Promise.all(data.map(async function (r) {
          return {
            id: r.codigo || r.id,
            solicitante: r.solicitante,
            pontoFocal: r.pontofocal,
            setor: r.setor,
            nf: r.numnf,
            pedido: r.pedido_totvs || '',
            destinacao: r.destinacao,
            vencimento: r.vencimento,
            urgencia: r.urgencia,
            status: r.status,
            arquivo: r.arquivo || 'documento.pdf',
            fileUrl: await createNfSignedUrl(r.url_nf || r.fileUrl),
            criadoEm: r.created_at,
            cancelado: r.cancelado,
            excluidoPor: r.cancelado_por || 'Sistema',
            excluidoEm: r.data_cancelamento ? new Date(r.data_cancelamento).toLocaleString('pt-BR') : '',
            motivoExclusao: r.motivo_exclusao || ''
          };
        }));

        requisicoes = rows.filter(function (r) { return !r.cancelado; });
        excluidos = rows.filter(function (r) { return r.cancelado; });
      }
    } catch (err) {
      console.error('Exceção ao carregar do Supabase:', err);
    }
    renderAll();
  }

  function renderTracking() {
    if (!currentUser || currentUser.perfil !== 'PF') return;
    var q = $('track-search').value.trim().toLowerCase();
    var fsol = $('t-sol').value, furg = $('t-urg').value, fst = $('t-status').value;

    var list = requisicoes.filter(function (r) {
      var matchStatus = (fst === 'Todos') ? true :
                        (fst === 'Ativas') ? (r.status !== ST_DONE) :
                        (r.status === fst);

      return r.setor === currentUser.setor &&
             (fsol === 'Todos' || r.solicitante === fsol) &&
             (furg === 'Todas' || r.urgencia === furg) &&
             matchStatus &&
             matchPessoa(r, q);
    }).sort(function (a, b) { return b.id.localeCompare(a.id); });

    $('track-setor-label').textContent = currentUser.setor;
    $('track-count').textContent = list.length;
    $('track-empty').classList.toggle('hidden', list.length > 0);

    var me = pfLabel(currentUser);
    $('track-body').innerHTML = list.map(function (r) {
      var di = dueInfo(r);
      var mine = r.pontoFocal === me ? ' <span class="text-[10px] font-bold bg-navy-50 text-navy-700 rounded px-1.5 py-0.5 ml-1">você</span>' : '';
      var deleteBtn = canDelete(r) 
        ? '<button type="button" data-del-id="' + r.id + '" class="btn-open-del text-red-600 hover:text-red-800 p-1.5 rounded hover:bg-red-50 transition" title="Excluir Requisição"><i class="fa-solid fa-trash"></i></button>'
        : '<span class="text-slate-300 text-xs">—</span>';

      return '<tr class="hover:bg-slate-50">' +
        '<td class="px-4 py-3 font-mono text-xs font-semibold text-navy-800 whitespace-nowrap">' + esc(r.id) + '</td>' +
        '<td class="px-4 py-3"><i class="fa-solid fa-signature text-slate-400 mr-1"></i>' + esc(r.solicitante) + '</td>' +
        '<td class="px-4 py-3 whitespace-nowrap"><i class="fa-solid fa-paper-plane text-slate-400 mr-1"></i>' + esc(r.pontoFocal) + mine + '</td>' +
        '<td class="px-4 py-3 whitespace-nowrap">' + renderViewNfBtn(r) + '</td>' +
        '<td class="px-4 py-3 whitespace-nowrap">' + (r.pedido ? '<span class="font-semibold text-navy-800">#' + esc(r.pedido) + '</span>' : '<span class="text-xs text-slate-400">Aguardando comprador</span>') + '</td>' +
        '<td class="px-4 py-3 whitespace-nowrap">' + fmtDate(r.vencimento) + '<div class="text-[11px] ' + di.cls + '">' + di.text + '</div></td>' +
        '<td class="px-4 py-3">' + urgBadge(r.urgencia) + '</td>' +
        '<td class="px-4 py-3">' + statusBadge(r.status) + '</td>' +
        '<td class="px-4 py-3 text-right whitespace-nowrap">' + deleteBtn + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderKPIs() {
    $('kpi-total').textContent = requisicoes.length;
    $('kpi-venc').textContent = requisicoes.filter(function (r) { return dueInfo(r).critical; }).length;
    $('kpi-pend').textContent = requisicoes.filter(function (r) { return r.status === ST_PEND; }).length;
    $('kpi-totvs').textContent = requisicoes.filter(function (r) { return r.status === ST_TOTVS; }).length;
    $('kpi-done').textContent = requisicoes.filter(function (r) { return r.status === ST_DONE; }).length;
  }

  function statusSelect(r) {
    var opts = [ST_PEND, ST_TOTVS, ST_DONE].map(function (s) {
      return '<option value="' + esc(s) + '"' + (s === r.status ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
    return '<select data-id="' + r.id + '" class="status-select w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy-600">' + opts + '</select>';
  }

  function refreshEnviadoOptions() {
    var sel = $('f-enviado'), cur = sel.value;
    var nomes = [];
    requisicoes.forEach(function (r) { if (nomes.indexOf(r.pontoFocal) === -1) nomes.push(r.pontoFocal); });
    nomes.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    sel.innerHTML = '<option value="Todos">Todos</option>' + nomes.map(function (n) {
      return '<option value="' + esc(n) + '">' + esc(n) + '</option>';
    }).join('');
    sel.value = nomes.indexOf(cur) !== -1 ? cur : 'Todos';
  }

  var lastBuyerList = [];

  function renderBuyer() {
    if (!currentUser || currentUser.perfil !== 'MON') return;
    renderKPIs();
    refreshEnviadoOptions();
    var fs = $('f-setor').value, fu = $('f-urg').value, fst = $('f-status').value;
    var fe = $('f-enviado').value, fq = $('f-busca').value.trim().toLowerCase();

    var list = requisicoes.filter(function (r) {
      var matchStatus = (fst === 'Todos') ? true :
                        (fst === 'Ativas') ? (r.status !== ST_DONE) :
                        (r.status === fst);

      return (fs === 'Todos' || r.setor === fs) &&
             (fu === 'Todas' || r.urgencia === fu) &&
             matchStatus &&
             (fe === 'Todos' || r.pontoFocal === fe) &&
             matchPessoa(r, fq);
    }).sort(function (a, b) {
      var da = a.status === ST_DONE ? 1 : 0, db = b.status === ST_DONE ? 1 : 0;
      if (da !== db) return da - db;
      var diff = parseISO(a.vencimento) - parseISO(b.vencimento);
      return diff !== 0 ? diff : URG_ORDER[a.urgencia] - URG_ORDER[b.urgencia];
    });

    lastBuyerList = list;
    $('list-count').textContent = list.length + (list.length === 1 ? ' requisição' : ' requisições');
    $('buyer-empty').classList.toggle('hidden', list.length > 0);

    $('buyer-list').innerHTML = list.map(function (r) {
      var di = dueInfo(r);
      var border = di.critical ? 'border-l-red-500 bg-red-50/40' : (r.status === ST_DONE ? 'border-l-emerald-500' : 'border-l-navy-600');
      var alert = di.critical
        ? '<span class="inline-flex items-center gap-1 bg-red-600 text-white text-[11px] font-bold px-2 py-0.5 rounded animate-pulse"><i class="fa-solid fa-triangle-exclamation"></i>' + (di.days < 0 ? 'VENCIDA' : 'VENCIMENTO PRÓXIMO') + '</span>'
        : '';

      return '<article class="bg-white rounded-xl border border-slate-200 border-l-4 ' + border + ' shadow-sm p-4 sm:p-5">' +
        '<div class="flex flex-col lg:flex-row lg:items-start gap-4">' +
          '<div class="flex-1 min-w-0">' +
            '<div class="flex flex-wrap items-center justify-between gap-2 mb-2">' +
              '<div class="flex flex-wrap items-center gap-2">' +
                '<span class="font-mono text-sm font-bold text-navy-900">' + esc(r.id) + '</span>' +
                urgBadge(r.urgencia) + alert +
                (r.pedido ? '<span class="inline-flex items-center gap-1 bg-navy-50 text-navy-800 text-[11px] font-bold px-2 py-0.5 rounded"><i class="fa-solid fa-receipt"></i>Pedido TOTVS #' + esc(r.pedido) + '</span>' : '<span class="text-[11px] text-slate-400">Sem nº de pedido</span>') +
              '</div>' +
              '<button type="button" data-del-id="' + r.id + '" class="btn-open-del text-slate-400 hover:text-red-600 p-1 rounded transition text-sm flex items-center gap-1" title="Excluir Requisição">' +
                '<i class="fa-solid fa-trash"></i> <span class="text-xs">Excluir</span>' +
              '</button>' +
            '</div>' +
            '<p class="font-medium text-slate-800 mb-1">' + esc(r.destinacao) + '</p>' +
            '<p class="text-sm text-slate-600 mb-3"><span class="font-semibold">Solicitante:</span> ' + esc(r.solicitante) + ' <span class="text-slate-300 mx-1">|</span> <span class="font-semibold">Enviado por:</span> ' + esc(r.pontoFocal) + '</p>' +
            '<dl class="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm bg-slate-50 p-3 rounded-lg border border-slate-100">' +
              '<div><dt class="text-[11px] uppercase text-slate-400 font-semibold"><i class="fa-solid fa-hashtag mr-1"></i>Nº da NF</dt><dd class="font-semibold text-slate-800">' + (r.nf ? esc(r.nf) : '<span class="text-slate-300">não informado</span>') + '</dd></div>' +
              '<div><dt class="text-[11px] uppercase text-slate-400 font-semibold"><i class="fa-solid fa-paperclip mr-1"></i>Nota Fiscal</dt><dd class="mt-0.5">' + renderViewNfBtn(r) + '</dd></div>' +
              '<div><dt class="text-[11px] uppercase text-slate-400 font-semibold">Setor</dt><dd>' + esc(r.setor) + '</dd></div>' +
              '<div><dt class="text-[11px] uppercase text-slate-400 font-semibold">Vencimento</dt><dd class="' + di.cls + '">' + fmtDate(r.vencimento) + ' <span class="block text-[11px] font-semibold">' + di.text + '</span></dd></div>' +
            '</dl>' +
          '</div>' +
          '<div class="lg:w-80 shrink-0 space-y-2 bg-slate-50/50 p-3 rounded-lg border border-slate-200">' +
            '<div>' + statusBadge(r.status) + '</div>' +
            '<label class="block text-[11px] uppercase text-slate-400 font-semibold">Status (atualização manual)</label>' +
            statusSelect(r) +
            '<label class="block text-[11px] uppercase text-slate-400 font-semibold pt-1">Número do Pedido (TOTVS)</label>' +
            '<div class="relative">' +
              '<span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">#</span>' +
              '<input type="text" inputmode="numeric" data-id="' + r.id + '" value="' + esc(r.pedido || '') + '" placeholder="Ex.: 45091 (Números)" class="pedido-input only-numbers w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600">' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function setupExcluidosFilterUI() {
    var container = $('del-setor-container');
    if (!currentUser) return;

    if (currentUser.perfil === 'MON') {
      container.innerHTML = '<select id="f-del-setor" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy-600">' +
                            '<option value="Todos">Todos os Setores</option>' +
                            '<option value="Embalagem">Embalagem</option>' +
                            '<option value="Química">Química</option>' +
                            '</select>';
      $('f-del-setor').addEventListener('change', renderExcluidos);
    } else {
      container.innerHTML = '<div class="w-full rounded-lg border border-slate-200 bg-slate-100 text-slate-700 px-3 py-2 text-sm font-semibold flex items-center justify-between">' +
                            '<span><i class="fa-solid fa-lock text-slate-400 mr-2"></i>Setor: ' + esc(currentUser.setor) + '</span>' +
                            '<span class="text-[11px] text-slate-500 font-normal bg-white px-2 py-0.5 rounded border border-slate-200">Restrito ao setor</span>' +
                            '</div>';
    }
  }

  function renderExcluidos() {
    if (!currentUser) return;
    var q = $('f-del-busca').value.trim().toLowerCase();
    
    var list = excluidos.filter(function (r) {
      if (currentUser.perfil === 'PF') {
        if (r.setor !== currentUser.setor) return false;
      } else {
        var fsEl = $('f-del-setor');
        var fs = fsEl ? fsEl.value : 'Todos';
        if (fs !== 'Todos' && r.setor !== fs) return false;
      }

      return matchPessoa(r, q) || (r.motivoExclusao && r.motivoExclusao.toLowerCase().indexOf(q) !== -1);
    });

    $('deleted-empty').classList.toggle('hidden', list.length > 0);

    $('deleted-list').innerHTML = list.map(function (r) {
      return '<article class="bg-white rounded-xl border border-red-200 border-l-4 border-l-red-500 shadow-sm p-4 sm:p-5">' +
        '<div class="flex flex-col md:flex-row md:items-start justify-between gap-4">' +
          '<div class="space-y-1 flex-1">' +
            '<div class="flex items-center gap-2 mb-1">' +
              '<span class="font-mono text-sm font-bold text-red-900">' + esc(r.id) + '</span>' +
              '<span class="bg-red-100 text-red-800 text-xs font-semibold px-2 py-0.5 rounded">CANCELADO</span>' +
              '<span class="text-xs text-slate-400">NF: ' + esc(r.nf) + '</span>' +
            '</div>' +
            '<p class="text-sm font-medium text-slate-800">' + esc(r.destinacao) + '</p>' +
            '<p class="text-xs text-slate-500">Solicitante: <strong>' + esc(r.solicitante) + '</strong> | Setor: <strong>' + esc(r.setor) + '</strong> | Ponto Focal: <strong>' + esc(r.pontoFocal) + '</strong></p>' +
            '<div class="mt-3 p-3 bg-red-50 rounded-lg border border-red-100 text-xs text-red-900">' +
              '<p class="font-semibold mb-0.5"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Motivo do Cancelamento:</p>' +
              '<p class="italic bg-white p-2 rounded border border-red-200">' + esc(r.motivoExclusao) + '</p>' +
            '</div>' +
          '</div>' +
          '<div class="text-right shrink-0 text-xs space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-200">' +
            '<p class="text-slate-500"><i class="fa-solid fa-user-xmark mr-1"></i>Excluído por: <strong class="text-slate-700">' + esc(r.excluidoPor) + '</strong></p>' +
            '<p class="text-slate-500"><i class="fa-regular fa-clock mr-1"></i>Data: <strong class="text-slate-700">' + esc(r.excluidoEm) + '</strong></p>' +
            '<div class="pt-2">' + renderViewNfBtn(r) + '</div>' +
            (currentUser.perfil === 'MON' ? '<button type="button" class="btn-permanent-delete mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1 rounded-md transition" data-permanent-delete-id="' + esc(r.id) + '"><i class="fa-solid fa-trash-can"></i> Excluir permanentemente</button>' : '') +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function renderAll() { 
    renderTracking(); 
    renderBuyer(); 
    setupExcluidosFilterUI();
    renderExcluidos(); 
  }

  var pendingDeleteId = null;

  function openDeleteModal(id) {
    var r = requisicoes.find(function (x) { return x.id === id; });
    if (!r) return;
    if (!canDelete(r)) {
      toast('Você não tem permissão para excluir esta requisição.', 'error');
      return;
    }
    pendingDeleteId = id;
    $('del-req-id').textContent = id + ' - NF ' + (r.nf || 'S/N');
    $('del-reason').value = '';
    $('err-del-reason').classList.add('hidden');
    $('delete-modal').classList.remove('hidden');
    $('del-reason').focus();
  }

  function closeDeleteModal() {
    pendingDeleteId = null;
    $('delete-modal').classList.add('hidden');
  }

  $('delete-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var reason = $('del-reason').value.trim();
    if (!reason) {
      $('err-del-reason').classList.remove('hidden');
      return;
    }

    var r = requisicoes.find(function (x) { return x.id === pendingDeleteId; });
    if (r) {
      const now = new Date();
      const userName = currentUser ? currentUser.nome : 'Sistema';
      
      const { error } = await supabaseClient.from('requisicoes').update({
        cancelado: true,
        motivo_exclusao: reason,
        cancelado_por: userName,
        data_cancelamento: now.toISOString()
      }).eq('codigo', pendingDeleteId);

      if (error) {
        console.error('Erro ao atualizar cancelamento no Supabase:', error);
        toast('Falha ao cancelar: ' + error.message, 'error');
        return;
      }

      toast('Requisição ' + pendingDeleteId + ' cancelada com sucesso.', 'info');
      closeDeleteModal();
      carregarDadosSupabase();
    }
  });

  $('cancel-del-btn').addEventListener('click', closeDeleteModal);

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.btn-open-del');
    if (btn) {
      var id = btn.getAttribute('data-del-id');
      if (id) openDeleteModal(id);
    }

    var permanentDeleteButton = e.target.closest('.btn-permanent-delete');
    if (permanentDeleteButton) {
      permanentlyDeleteRequest(permanentDeleteButton.getAttribute('data-permanent-delete-id'), permanentDeleteButton);
    }
  });

  async function permanentlyDeleteRequest(id, button) {
    if (!currentUser || currentUser.perfil !== 'MON') {
      toast('Apenas compradores podem excluir requisições permanentemente.', 'error');
      return;
    }
    var request = excluidos.find(function (item) { return item.id === id; });
    if (!request) {
      toast('A requisição não foi encontrada no histórico.', 'error');
      return;
    }
    if (!window.confirm('Excluir permanentemente a requisição ' + id + ', incluindo o arquivo da Nota Fiscal? Esta ação não pode ser desfeita.')) return;

    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Excluindo...';
    try {
      const { data, error } = await supabaseClient.functions.invoke('admin-users', {
        body: { action: 'permanently-delete-request', codigo: id }
      });
      if (error) throw error;
      if (!data || !data.success) throw new Error('A função administrativa não confirmou a exclusão.');

      toast('Requisição e arquivo excluídos permanentemente.', 'success');
      await carregarDadosSupabase();
    } catch (error) {
      console.error('Não foi possível excluir permanentemente a requisição:', error);
      toast(await getAdminFunctionError(error), 'error');
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-trash-can"></i> Excluir permanentemente';
    }
  }

  function isMon() { return currentUser && currentUser.perfil === 'MON'; }

  async function setStatus(id, status, statusSelect) {
    if (!isMon()) return;
    var r = requisicoes.find(function (x) { return x.id === id; });
    if (!r || r.status === status) return;

    var pedido = String(r.pedido || '').trim();
    var pedidoInput = Array.prototype.find.call($('buyer-list').querySelectorAll('.pedido-input'), function (input) {
      return input.dataset.id === id;
    });
    if ((status === ST_TOTVS || status === ST_DONE) && !pedido.trim()) {
      pedido = pedidoInput ? pedidoInput.value.trim().replace(/^#/, '') : '';
      if (!pedido) {
        statusSelect.value = r.status;
        toast('Informe o número do pedido TOTVS antes de bloquear por alçada ou concluir.', 'error');
        if (pedidoInput) pedidoInput.focus();
        return;
      }
    }

    var update = { status: status };
    if (pedido && pedido !== String(r.pedido || '')) update.pedido_totvs = pedido;
    const { error } = await supabaseClient.from('requisicoes').update(update).eq('codigo', id);
    if (error) {
      console.error('Erro ao atualizar status no Supabase:', error);
      toast('Falha ao atualizar status: ' + error.message, 'error');
      statusSelect.value = r.status;
      return;
    }
    
    r.status = status;
    r.pedido = pedido;
    renderAll();
    toast(id + ' atualizado: ' + status, status === ST_DONE ? 'success' : 'info');
  }

  async function setPedido(id, valor) {
    if (!isMon()) return;
    var r = requisicoes.find(function (x) { return x.id === id; });
    if (!r) return;
    var v = valor.trim().replace(/^#/, '');
    if (v === (r.pedido || '')) return;
    
    const { error } = await supabaseClient.from('requisicoes').update({ pedido_totvs: v }).eq('codigo', id);
    if (error) {
      console.error('Erro ao atualizar pedido no Supabase:', error);
      toast('Falha ao atualizar pedido TOTVS: ' + error.message, 'error');
      return;
    }

    r.pedido = v;
    renderAll();
    toast(v ? id + ': Pedido TOTVS #' + v + ' registrado.' : id + ': número do pedido removido.', v ? 'success' : 'info');
  }

  $('buyer-list').addEventListener('change', function (e) {
    if (e.target.classList.contains('status-select')) setStatus(e.target.dataset.id, e.target.value, e.target);
    else if (e.target.classList.contains('pedido-input')) setPedido(e.target.dataset.id, e.target.value);
  });

  function csvCell(v) {
    var t = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }
  
  $('export-csv').addEventListener('click', function () {
    if (!isMon()) return;
    if (!lastBuyerList.length) { toast('Não há requisições para exportar.', 'error'); return; }
    var head = ['Código', 'Solicitante', 'Enviado por', 'Setor', 'Nº da NF', 'Pedido TOTVS', 'Destinação', 'Vencimento', 'Urgência', 'Status', 'Arquivo'];
    var rows = lastBuyerList.map(function (r) {
      return [r.id, r.solicitante, r.pontoFocal, r.setor, r.nf, r.pedido, r.destinacao, fmtDate(r.vencimento), r.urgencia, r.status, r.arquivo];
    });
    var csv = '\uFEFF' + [head].concat(rows).map(function (l) { return l.map(csvCell).join(';'); }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'requisicoes_am_quimica_' + toISO(today0()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    toast(lastBuyerList.length + ' requisição(ões) exportada(s).', 'success');
  });

  function clearBuyerFilters() {
    $('f-setor').value = 'Todos'; $('f-urg').value = 'Todas'; $('f-status').value = 'Ativas';
    $('f-enviado').value = 'Todos'; $('f-busca').value = '';
  }

  ['f-setor', 'f-urg', 'f-status', 'f-enviado'].forEach(function (id) { $(id).addEventListener('change', renderBuyer); });
  $('f-busca').addEventListener('input', renderBuyer);
  $('f-clear').addEventListener('click', function () { clearBuyerFilters(); renderBuyer(); });

  $('f-del-busca').addEventListener('input', renderExcluidos);

  $('track-search').addEventListener('input', renderTracking);
  ['t-sol', 't-urg', 't-status'].forEach(function (id) { $(id).addEventListener('change', renderTracking); });
  function clearTrackFilters() {
    $('t-sol').value = 'Todos'; $('t-urg').value = 'Todas'; $('t-status').value = 'Ativas'; $('track-search').value = '';
  }
  $('t-clear').addEventListener('click', function () { clearTrackFilters(); renderTracking(); });

  var selectedFile = null;
  var fileInput = $('nf-file'), dropZone = $('drop-zone');

  function setFile(f) {
    var ok = /\.(pdf|jpe?g|png)$/i.test(f.name);
    if (!ok) { toast('Formato inválido. Use PDF, JPG ou PNG.', 'error'); return; }
    selectedFile = f;
    $('file-label').innerHTML = '<i class="fa-solid fa-file-circle-check text-emerald-600 mr-1"></i><strong>' + esc(f.name) + '</strong>';
    $('err-file').classList.add('hidden');
  }

  fileInput.addEventListener('change', function () { if (fileInput.files[0]) setFile(fileInput.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.remove('dragover'); });
  });
  dropZone.addEventListener('drop', function (e) {
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });

  function showErr(id, show, msg) {
    var el = $(id);
    if (msg) el.textContent = msg;
    el.classList.toggle('hidden', !show);
  }

  function resetForm() {
    $('req-form').reset();
    selectedFile = null;
    $('file-label').innerHTML = 'Clique ou arraste o arquivo aqui <span class="text-slate-400">(PDF, JPG, PNG)</span>';
    ['err-file', 'err-solicitante', 'err-numnf', 'err-vencimento', 'err-destinacao', 'err-assinado'].forEach(function (id) { showErr(id, false); });
    if (currentUser && currentUser.perfil === 'PF') {
      $('pontofocal').value = pfLabel(currentUser);
      $('setor').value = currentUser.setor;
    }
  }

  $('req-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!currentUser || currentUser.perfil !== 'PF') { toast('Seu perfil não tem permissão para criar requisições.', 'error'); return; }
    if (!supabaseClient) { toast('Configure a chave publishable do Supabase no index.html.', 'error'); return; }

    var pf = pfLabel(currentUser);
    var setor = currentUser.setor;
    var sol = $('solicitante').value;
    var nf = $('numnf').value.trim();
    var dest = $('destinacao').value.trim();
    var venc = $('vencimento').value;
    var urg = document.querySelector('input[name="urgencia"]:checked').value;
    var assinado = $('assinado').checked;

    var valid = true;
    if (!selectedFile) { showErr('err-file', true, 'Anexe a Nota Fiscal assinada pelo solicitante.'); valid = false; } else showErr('err-file', false);
    if (!nf) { showErr('err-numnf', true); valid = false; } else showErr('err-numnf', false);
    if (!sol) { showErr('err-solicitante', true); valid = false; } else showErr('err-solicitante', false);
    if (!dest) { showErr('err-destinacao', true); valid = false; } else showErr('err-destinacao', false);
    if (!venc) { showErr('err-vencimento', true); valid = false; } else showErr('err-vencimento', false);
    if (!assinado) { showErr('err-assinado', true); valid = false; } else showErr('err-assinado', false);

    if (!valid) { toast('Preencha os campos obrigatórios.', 'error'); return; }

    const submitBtn = $('submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando e salvando no Supabase...';

    try {
      // 1. UPLOAD DE ARQUIVO DA NF PARA O BUCKET 'notas-fiscais' COM NOME LIMPO
      const extension = (selectedFile.name.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
      const safeBaseName = selectedFile.name
        .replace(/\.[^.]*$/, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'nota_fiscal';
      const cleanFileName = Date.now() + '_' + safeBaseName + '.' + extension;
      const safeSector = setor
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .toLowerCase();
      const filePath = `${safeSector}/${cleanFileName}`;

      const contentType = extension === 'pdf' ? 'application/pdf' :
        (extension === 'jpg' || extension === 'jpeg') ? 'image/jpeg' :
        extension === 'png' ? 'image/png' : '';
      if (!contentType) throw new Error('Formato de arquivo não permitido.');

      const { data: uploadData, error: uploadError } = await supabaseClient.storage
        .from('notas-fiscais')
        .upload(filePath, selectedFile, { contentType: contentType, upsert: false });

      if (uploadError) throw uploadError;
      if (!uploadData) throw new Error('O Storage não confirmou o upload do arquivo.');

      const reqId = 'REQ-' + new Date().getFullYear() + '-' + Date.now();

      const novaReq = {
        codigo: reqId,
        solicitante: sol,
        pontofocal: pf,
        setor: setor,
        numnf: nf,
        destinacao: dest,
        vencimento: venc,
        urgencia: urg,
        status: ST_PEND,
        url_nf: filePath,
        cancelado: false
      };

      const { error: insertError } = await supabaseClient.from('requisicoes').insert([novaReq]);
      if (insertError) {
        const { error: cleanupError } = await supabaseClient.storage
          .from('notas-fiscais')
          .remove([filePath]);
        if (cleanupError) {
          console.error('Não foi possível remover do Storage o arquivo sem requisição:', cleanupError);
        }
        throw insertError;
      }

      toast('Requisição ' + reqId + ' enviada com sucesso!', 'success');
      resetForm();
      carregarDadosSupabase();
    } catch (err) {
      console.error('Erro ao enviar requisição ao Supabase:', err);
      toast('Falha ao enviar: ' + (err && err.message ? err.message : 'erro inesperado.'), 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar Requisição';
    }
  });

  function switchTab(tab) {
    $('tab-btn-main').className = tab === 'main' ? 'px-3 py-1.5 rounded-md font-medium transition bg-white text-navy-900 shadow' : 'px-3 py-1.5 rounded-md font-medium transition text-navy-100 hover:text-white hover:bg-white/10';
    $('tab-btn-deleted').className = tab === 'deleted' ? 'px-3 py-1.5 rounded-md font-medium transition bg-white text-navy-900 shadow' : 'px-3 py-1.5 rounded-md font-medium transition text-navy-100 hover:text-white hover:bg-white/10';

    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });

    if (tab === 'deleted') {
      $('view-excluidos').classList.add('active');
    } else {
      if (currentUser.perfil === 'MON') $('view-comprador').classList.add('active');
      else $('view-setor').classList.add('active');
    }
  }

  $('tab-btn-main').addEventListener('click', function () { switchTab('main'); });
  $('tab-btn-deleted').addEventListener('click', function () { switchTab('deleted'); });

  function showLoginError(msg) {
    $('login-err-text').textContent = msg;
    $('login-err').classList.remove('hidden');
  }

  function resetLogin() {
    $('login-form').reset();
    $('login-err').classList.add('hidden');
    $('login-pass').type = 'password';
    $('toggle-pass-icon').className = 'fa-solid fa-eye';
  }

  $('toggle-pass').addEventListener('click', function () {
    var show = $('login-pass').type === 'password';
    $('login-pass').type = show ? 'text' : 'password';
    $('toggle-pass-icon').className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  });

  async function activateSession(authUser) {
    try {
      var profile = await loadProfile(authUser);
      enterApp(profile);
    } catch (error) {
      console.error('Não foi possível carregar o perfil do usuário:', error);
      if (supabaseClient) {
        try {
          var signOutResult = await supabaseClient.auth.signOut({ scope: 'local' });
          if (signOutResult.error) console.error('Não foi possível encerrar a sessão sem perfil:', signOutResult.error);
        } catch (signOutError) {
          console.error('Falha ao encerrar sessão sem perfil:', signOutError);
        }
      }
      clearAppState();
      showLoginError('Conta autenticada, mas sem perfil de acesso válido. Procure o administrador.');
    }
  }

  $('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var login = $('login-user').value.trim().toLowerCase();
    var pass = $('login-pass').value;

    if (!supabaseClient) { showLoginError('Serviço de autenticação indisponível. Tente novamente mais tarde.'); return; }
    if (!login || !pass) { showLoginError('Informe e-mail e senha.'); return; }
    if (!$('login-user').checkValidity()) { showLoginError('Informe um e-mail válido.'); return; }

    var loginButton = $('login-btn');
    loginButton.disabled = true;
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email: login, password: pass });
      if (error || !data.user) {
        if (error) console.error('Falha de autenticação no Supabase:', error);
        showLoginError('E-mail ou senha incorretos.');
        $('login-pass').value = '';
        $('login-pass').focus();
        return;
      }

      resetLogin();
      await activateSession(data.user);
    } catch (error) {
      console.error('Erro ao autenticar no Supabase:', error);
      showLoginError('Não foi possível autenticar. Verifique sua conexão e tente novamente.');
      $('login-pass').value = '';
    } finally {
      loginButton.disabled = false;
    }
  });

  async function loadAdminUsers() {
    if (!currentUser || currentUser.perfil !== 'ADMIN') return;

    var body = $('admin-users-body');
    body.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400">Carregando usuários...</td></tr>';
    $('admin-users-empty').classList.add('hidden');

    try {
      const { data, error } = await supabaseClient.functions.invoke('admin-users', {
        body: { action: 'list' }
      });
      if (error) throw error;
      if (!data || !Array.isArray(data.users)) throw new Error('Resposta inválida da função administrativa.');

      $('admin-user-count').textContent = data.users.length;
      $('admin-users-empty').classList.toggle('hidden', data.users.length > 0);
      body.innerHTML = data.users.map(function (user) {
        var role = user.perfil === 'ADMIN' ? 'ADMIN · Administrador' :
          user.perfil === 'MON' ? 'MON · Comprador' :
          user.perfil === 'PF' ? 'PF · Ponto focal' : 'Sem perfil';
        var createdAt = user.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '—';
        return '<tr>' +
          '<td class="px-4 py-3 font-medium">' + esc(user.nome || '—') + '</td>' +
          '<td class="px-4 py-3">' + esc(user.email || '—') + '</td>' +
          '<td class="px-4 py-3">' + esc(role) + '</td>' +
          '<td class="px-4 py-3">' + esc(user.setor || '—') + '</td>' +
          '<td class="px-4 py-3 whitespace-nowrap">' + esc(createdAt) + '</td>' +
          '<td class="px-4 py-3 text-right whitespace-nowrap">' +
            (user.id === currentUser.id ? '<span class="text-xs text-slate-400">Sessão atual</span>' :
              '<button type="button" class="btn-admin-delete rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition" data-admin-delete-id="' + esc(user.id) + '" data-admin-delete-label="' + esc((user.nome || user.email || 'usuário')) + '"><i class="fa-solid fa-trash-can mr-1"></i>Excluir conta</button>') +
          '</td>' +
          '</tr>';
      }).join('');
    } catch (error) {
      console.error('Não foi possível carregar os usuários administrativos:', error);
      body.innerHTML = '';
      toast('Falha ao carregar usuários: ' + await getAdminFunctionError(error), 'error');
    }
  }

  $('admin-users-body').addEventListener('click', async function (e) {
    var button = e.target.closest('.btn-admin-delete');
    if (!button) return;
    if (!currentUser || currentUser.perfil !== 'ADMIN') {
      toast('Apenas o administrador pode excluir contas.', 'error');
      return;
    }

    var userId = button.getAttribute('data-admin-delete-id');
    var userLabel = button.getAttribute('data-admin-delete-label');
    if (!userId || !window.confirm('Excluir a conta de ' + userLabel + '? A pessoa perderá o acesso ao sistema.')) return;

    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      const { data, error } = await supabaseClient.functions.invoke('admin-users', {
        body: { action: 'delete-user', user_id: userId }
      });
      if (error) throw error;
      if (!data || !data.success) throw new Error('A função administrativa não confirmou a exclusão.');

      toast('Conta excluída com sucesso.', 'success');
      await loadAdminUsers();
    } catch (error) {
      console.error('Não foi possível excluir a conta:', error);
      toast(await getAdminFunctionError(error), 'error');
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-trash-can mr-1"></i>Excluir conta';
    }
  });

  async function getAdminFunctionError(error) {
    if (error && error.context && typeof error.context.clone === 'function') {
      try {
        var responseBody = await error.context.clone().json();
        if (responseBody && typeof responseBody.error === 'string') return responseBody.error;
      } catch (parseError) {
        console.error('Não foi possível ler o erro da função administrativa:', parseError);
      }
    }
    return error && error.message ? error.message : 'Confira se a Edge Function admin-users foi implantada.';
  }

  function updateAdminSectorField() {
    var isPf = $('admin-new-role').value === 'PF';
    $('admin-sector-field').classList.toggle('hidden', !isPf);
    $('admin-new-sector').required = isPf;
    if (!isPf) $('admin-new-sector').value = '';
  }

  $('admin-new-role').addEventListener('change', updateAdminSectorField);
  $('admin-refresh-btn').addEventListener('click', loadAdminUsers);
  $('admin-create-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!currentUser || currentUser.perfil !== 'ADMIN') {
      toast('Apenas o administrador pode cadastrar usuários.', 'error');
      return;
    }
    if (!e.currentTarget.checkValidity()) {
      e.currentTarget.reportValidity();
      return;
    }

    var submitButton = $('admin-create-btn');
    submitButton.disabled = true;
    try {
      const { data, error } = await supabaseClient.functions.invoke('admin-users', {
        body: {
          action: 'create',
          nome: $('admin-new-name').value.trim(),
          email: $('admin-new-email').value.trim().toLowerCase(),
          password: $('admin-new-password').value,
          perfil: $('admin-new-role').value,
          setor: $('admin-new-role').value === 'PF' ? $('admin-new-sector').value : null
        }
      });
      if (error) throw error;
      if (!data || !data.success) throw new Error('A função administrativa não confirmou o cadastro.');

      $('admin-create-form').reset();
      updateAdminSectorField();
      toast('Usuário criado com sucesso.', 'success');
      await loadAdminUsers();
    } catch (error) {
      console.error('Não foi possível criar o usuário:', error);
      toast(await getAdminFunctionError(error), 'error');
    } finally {
      $('admin-new-password').value = '';
      submitButton.disabled = false;
    }
  });

  function enterApp(u) {
    currentUser = u;
    $('login-screen').classList.add('hidden');
    $('app-header').classList.remove('hidden');

    $('user-avatar').textContent = u.nome.charAt(0);
    $('user-name').textContent = u.nome;
    $('user-role').textContent = u.perfil === 'ADMIN' ? 'ADMIN · Administrador' :
      u.perfil === 'MON' ? 'MON · Comprador' : 'PF · ' + u.setor;

    var isAdmin = u.perfil === 'ADMIN';
    $('nav-tabs').classList.toggle('hidden', isAdmin);
    $('app-main').classList.toggle('hidden', isAdmin);
    $('admin-main').classList.toggle('hidden', !isAdmin);
    $('reset-btn').classList.toggle('hidden', isAdmin);

    if (isAdmin) {
      loadAdminUsers();
    } else {
      if (u.perfil === 'PF') {
        $('pontofocal').value = pfLabel(u);
        $('setor').value = u.setor;
      }
      switchTab('main');
      carregarDadosSupabase();
    }
    toast('Bem-vindo(a), ' + u.nome + '!', 'success');
  }

  function clearAppState() {
    currentUser = null;
    requisicoes = [];
    excluidos = [];
    closeDeleteModal();
    resetForm();
    $('app-header').classList.add('hidden');
    $('app-main').classList.add('hidden');
    $('admin-main').classList.add('hidden');
    $('nav-tabs').classList.remove('hidden');
    $('reset-btn').classList.remove('hidden');
    $('admin-create-form').reset();
    $('admin-users-body').innerHTML = '';
    $('admin-user-count').textContent = '0';
    $('admin-users-empty').classList.add('hidden');
    updateAdminSectorField();
    $('login-screen').classList.remove('hidden');
  }

  async function logoff() {
    if (supabaseClient) {
      try {
        const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
        if (error) throw error;
      } catch (error) {
        console.error('Erro ao encerrar sessão no Supabase:', error);
        toast('Não foi possível encerrar a sessão. Tente novamente.', 'error');
        return;
      }
    }
    clearAppState();
    resetLogin();
  }
  $('logout-btn').addEventListener('click', logoff);

  async function restoreSession() {
    if (!supabaseClient) {
      showLoginError('Serviço de autenticação indisponível. Verifique a configuração do Supabase.');
      return;
    }

    try {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) {
        console.error('Não foi possível restaurar a sessão do Supabase:', error);
        showLoginError('Não foi possível verificar sua sessão. Faça login novamente.');
        return;
      }
      if (data.session) await activateSession(data.session.user);
    } catch (error) {
      console.error('Erro ao restaurar sessão do Supabase:', error);
      showLoginError('Não foi possível verificar sua sessão. Faça login novamente.');
    }
  }

  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') {
        clearAppState();
        resetLogin();
      }
    });
  }
  restoreSession();

  $('reset-btn').addEventListener('click', function () {
    carregarDadosSupabase();
    toast('Dados atualizados do Supabase.', 'success');
  });

  $('today-label').textContent = today0().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
})();
