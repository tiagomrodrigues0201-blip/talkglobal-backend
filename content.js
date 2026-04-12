(() => {
  if (window.__TG_LOADED__) return;
  window.__TG_LOADED__ = true;

  const API_BASE_URL = "https://talkglobal-backend.onrender.com";
  const REQUEST_TIMEOUT_MS = 20000;
  const LOGO_URL = chrome.runtime.getURL("icon128.png");

  let TALKGLOBAL_KEY = null;
  let CURRENT_STATUS = null;

  async function obterOuCriarKey() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(["tg_key"], async (result) => {
        try {
          if (result.tg_key) {
            TALKGLOBAL_KEY = result.tg_key;
            return resolve(result.tg_key);
          }

          const emailFake = `user_${Date.now()}@tg.com`;

          const resposta = await fetch(`${API_BASE_URL}/criar-usuario`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ email: emailFake })
          });

          const raw = await resposta.text();

          let data = {};
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {
            throw new Error("Resposta inválida em /criar-usuario.");
          }

          if (!resposta.ok) {
            throw new Error(data.erro || "Erro ao criar usuário.");
          }

          if (!data.accessKey) {
            throw new Error("Backend não retornou accessKey.");
          }

          TALKGLOBAL_KEY = data.accessKey;

          chrome.storage.local.set({ tg_key: TALKGLOBAL_KEY }, () => {
            resolve(TALKGLOBAL_KEY);
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async function garantirKey() {
    if (!TALKGLOBAL_KEY) {
      TALKGLOBAL_KEY = await obterOuCriarKey();
    }
    return TALKGLOBAL_KEY;
  }

  async function requestJSON(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const resposta = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      const raw = await resposta.text();

      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`Resposta inválida do servidor: ${raw.slice(0, 200)}`);
      }

      if (!resposta.ok) {
        throw new Error(data.erro || "Erro no servidor.");
      }

      return data;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("O servidor demorou demais para responder.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function postJSON(path, body, withKey = true) {
    const headers = {
      "Content-Type": "application/json"
    };

    if (withKey) {
      const accessKey = await garantirKey();
      headers["x-talkglobal-key"] = accessKey;
    }

    return requestJSON(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
  }

  async function getStatusUsuario() {
    const accessKey = await garantirKey();

    return requestJSON(`${API_BASE_URL}/meu-status`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-talkglobal-key": accessKey
      }
    });
  }

  async function traduzirMensagem(texto) {
    const dados = await postJSON("/traduzir", { texto }, true);
    return dados.resultado || "";
  }

  async function converterParaIngles(textoUsuario, contexto) {
    const dados = await postJSON(
      "/converter",
      {
        texto: textoUsuario,
        contexto
      },
      true
    );
    return dados.resultado || "";
  }

  async function criarCheckoutSession() {
    const accessKey = await garantirKey();

    const dados = await postJSON(
      "/create-checkout-session",
      { accessKey },
      false
    );

    if (!dados.checkoutUrl) {
      throw new Error("checkoutUrl não veio do backend.");
    }

    return dados.checkoutUrl;
  }

  function criarPainel() {
    if (document.querySelector("#tg-panel")) return;

    const painel = document.createElement("div");
    painel.id = "tg-panel";

    painel.innerHTML = `
      <div id="tg-header">
        <div id="tg-brand">
          <div id="tg-logo-wrap">
            <img id="tg-logo" src="${LOGO_URL}" alt="TalkGlobal logo" />
          </div>

          <div id="tg-title-wrap">
            <div id="tg-title">TalkGlobal</div>
            <div id="tg-subtitle">Reply like a native speaker in seconds</div>
          </div>
        </div>

        <button id="tg-min-btn" title="Minimizar">—</button>
      </div>

      <div id="tg-body">
        <div id="tg-paywall" class="tg-hidden">
          <div id="tg-paywall-badge">ACESSO BLOQUEADO</div>
          <div id="tg-paywall-title">Desbloqueie o TalkGlobal</div>
          <div id="tg-paywall-text">
            Seu trial terminou ou seu acesso não está ativo.
            Libere agora e continue usando tradução e respostas em inglês.
          </div>

          <button id="tg-pay-btn" class="tg-btn tg-btn-green">
            🚀 Liberar acesso
          </button>

          <button id="tg-refresh-status-btn" class="tg-btn tg-btn-dark">
            Atualizar status
          </button>
        </div>

        <div id="tg-app">
          <label class="tg-label">MENSAGENS NOVAS TRADUZIDAS</label>
          <div id="tg-traducao" class="tg-box">—</div>

          <label class="tg-label">ESCREVA SUA RESPOSTA EM PORTUGUÊS</label>
          <textarea id="tg-input" placeholder="Digite aqui em português..."></textarea>

          <label class="tg-label">RESPOSTA PRONTA EM INGLÊS</label>
          <div id="tg-ingles" class="tg-box">—</div>

          <div id="tg-actions">
            <button id="tg-btn-traduzir" class="tg-btn tg-btn-blue">Traduzir</button>
            <button id="tg-btn-converter" class="tg-btn tg-btn-green">Converter</button>
          </div>
        </div>

        <div id="tg-status">Carregando...</div>
      </div>
    `;

    const style = document.createElement("style");
    style.id = "tg-style";
    style.textContent = `
      #tg-panel {
        position: fixed;
        top: 16px;
        right: 16px;
        width: 430px;
        max-height: calc(100vh - 32px);
        overflow: auto;
        background:
          radial-gradient(circle at top left, rgba(59,130,246,0.18), transparent 34%),
          radial-gradient(circle at top right, rgba(34,197,94,0.14), transparent 34%),
          linear-gradient(180deg, #081120 0%, #050b16 100%);
        border-radius: 26px;
        box-shadow: 0 24px 70px rgba(0,0,0,0.5);
        color: white;
        z-index: 999999;
        font-family: Inter, Arial, sans-serif;
        border: 1px solid rgba(255,255,255,0.06);
        backdrop-filter: blur(10px);
      }

      #tg-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        gap: 14px;
      }

      #tg-brand {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
      }

      #tg-logo-wrap {
        width: 52px;
        height: 52px;
        border-radius: 18px;
        background: rgba(255,255,255,0.08);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        flex-shrink: 0;
        border: 1px solid rgba(255,255,255,0.08);
      }

      #tg-logo {
        width: 38px;
        height: 38px;
        object-fit: contain;
        display: block;
      }

      #tg-title-wrap {
        min-width: 0;
      }

      #tg-title {
        font-size: 24px;
        font-weight: 800;
        line-height: 1.05;
      }

      #tg-subtitle {
        font-size: 13px;
        color: #94a3b8;
        margin-top: 4px;
      }

      #tg-min-btn {
        width: 44px;
        height: 44px;
        border-radius: 14px;
        border: none;
        background: rgba(255,255,255,0.1);
        color: white;
        font-size: 22px;
        cursor: pointer;
        flex-shrink: 0;
      }

      #tg-body {
        padding: 20px;
      }

      .tg-label {
        display: block;
        font-size: 11px;
        font-weight: 800;
        color: #86efac;
        margin-top: 14px;
        margin-bottom: 6px;
        letter-spacing: 0.04em;
      }

      .tg-box {
        background: #1e293b;
        border-radius: 18px;
        padding: 16px;
        min-height: 70px;
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.45;
      }

      #tg-input {
        width: 100%;
        height: 120px;
        border-radius: 18px;
        border: none;
        padding: 16px;
        background: #1e293b;
        color: white;
        box-sizing: border-box;
        resize: vertical;
        outline: none;
        font-family: inherit;
        font-size: 14px;
        line-height: 1.45;
      }

      #tg-input::placeholder {
        color: #94a3b8;
      }

      #tg-actions {
        display: flex;
        gap: 12px;
        margin-top: 16px;
      }

      .tg-btn {
        flex: 1;
        padding: 14px;
        border-radius: 16px;
        border: none;
        font-weight: 700;
        cursor: pointer;
        transition: transform 0.15s ease, opacity 0.15s ease;
      }

      .tg-btn:hover {
        transform: translateY(-1px);
      }

      .tg-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }

      .tg-btn-blue {
        background: #2563eb;
        color: white;
      }

      .tg-btn-green {
        background: #16a34a;
        color: white;
      }

      .tg-btn-dark {
        background: #334155;
        color: white;
        margin-top: 10px;
      }

      #tg-status {
        margin-top: 12px;
        font-size: 12px;
        color: #94a3b8;
        white-space: pre-wrap;
      }

      .tg-hidden {
        display: none !important;
      }

      #tg-paywall {
        background: rgba(15, 23, 42, 0.72);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 22px;
        padding: 18px;
      }

      #tg-paywall-badge {
        display: inline-flex;
        font-size: 10px;
        font-weight: 800;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(239, 68, 68, 0.18);
        color: #fecaca;
        margin-bottom: 12px;
      }

      #tg-paywall-title {
        font-size: 22px;
        font-weight: 800;
        margin-bottom: 8px;
      }

      #tg-paywall-text {
        font-size: 14px;
        color: #cbd5e1;
        line-height: 1.5;
        margin-bottom: 16px;
      }
    `;

    if (!document.querySelector("#tg-style")) {
      document.head.appendChild(style);
    }

    document.body.appendChild(painel);

    document.querySelector("#tg-min-btn")?.addEventListener("click", () => {
      const body = document.querySelector("#tg-body");
      const btn = document.querySelector("#tg-min-btn");
      if (!body || !btn) return;

      const fechado = body.style.display === "none";
      body.style.display = fechado ? "block" : "none";
      btn.textContent = fechado ? "—" : "+";
    });

    document.querySelector("#tg-btn-traduzir")?.addEventListener("click", aoClicarTraduzir);
    document.querySelector("#tg-btn-converter")?.addEventListener("click", aoClicarConverter);
    document.querySelector("#tg-pay-btn")?.addEventListener("click", aoClicarLiberarAcesso);
    document.querySelector("#tg-refresh-status-btn")?.addEventListener("click", atualizarStatusEInterface);

    const input = document.querySelector("#tg-input");
    if (input) {
      input.addEventListener("keydown", async (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          await aoClicarConverter();
        }
      });
    }
  }

  function setStatus(texto) {
    const el = document.querySelector("#tg-status");
    if (el) el.textContent = texto || "";
  }

  function setTraducao(texto) {
    const el = document.querySelector("#tg-traducao");
    if (el) el.textContent = texto && texto.trim() ? texto : "—";
  }

  function setIngles(texto) {
    const el = document.querySelector("#tg-ingles");
    if (el) el.textContent = texto && texto.trim() ? texto : "—";
  }

  function getInputEl() {
    return document.querySelector("#tg-input");
  }

  function getInputTexto() {
    const el = getInputEl();
    return el ? el.value.trim() : "";
  }

  function setBotoesDesabilitados(valor) {
    const ids = [
      "#tg-btn-traduzir",
      "#tg-btn-converter",
      "#tg-pay-btn",
      "#tg-refresh-status-btn"
    ];

    for (const id of ids) {
      const el = document.querySelector(id);
      if (el) el.disabled = valor;
    }
  }

  function limparTexto(texto) {
    return (texto || "")
      .replace(/\u200e/g, "")
      .replace(/\n{2,}/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function pegarTextoMensagem(el) {
    if (!el) return "";

    const candidatos = [
      ...el.querySelectorAll("span.selectable-text"),
      ...el.querySelectorAll('[data-testid="msg-text"]'),
      ...el.querySelectorAll("div.copyable-text")
    ];

    const partes = [];

    for (const node of candidatos) {
      const t = limparTexto(node.innerText || node.textContent || "");
      if (t) partes.push(t);
    }

    const texto = limparTexto(partes.join("\n"));
    if (texto) return texto;

    return limparTexto(el.innerText || el.textContent || "");
  }

  function pegarMensagens() {
    let items = Array.from(document.querySelectorAll("div.message-in, div.message-out"));
    if (items.length) return items;

    items = Array.from(document.querySelectorAll('[data-testid="msg-container"]'));
    if (items.length) return items;

    items = Array.from(document.querySelectorAll('[role="row"]'));
    return items;
  }

  function tipoMensagem(el) {
    if (!el) return "unknown";
    if (el.matches("div.message-in")) return "in";
    if (el.matches("div.message-out")) return "out";

    const className = typeof el.className === "string" ? el.className : "";
    if (className.includes("message-in")) return "in";
    if (className.includes("message-out")) return "out";

    return "unknown";
  }

  function pegarUltimoIndiceMensagemSua() {
    const mensagens = pegarMensagens();

    for (let i = mensagens.length - 1; i >= 0; i--) {
      if (tipoMensagem(mensagens[i]) === "out" && pegarTextoMensagem(mensagens[i])) {
        return i;
      }
    }

    return -1;
  }

  function pegarMensagensNovasDepoisDaSuaUltima(maxEntradas = 10) {
    const mensagens = pegarMensagens();
    const ultimoIndiceSua = pegarUltimoIndiceMensagemSua();
    const entradasNovas = [];

    for (let i = ultimoIndiceSua + 1; i < mensagens.length; i++) {
      const el = mensagens[i];
      const tipo = tipoMensagem(el);
      const texto = pegarTextoMensagem(el);

      if (!texto) continue;
      if (tipo === "in") entradasNovas.push(texto);
    }

    const entradasLimitadas = entradasNovas.slice(-maxEntradas);

    return {
      texto: entradasLimitadas.join("\n\n"),
      quantidade: entradasLimitadas.length
    };
  }

  function pegarContexto(maxMensagens = 12) {
    const mensagens = pegarMensagens().slice(-maxMensagens);
    const linhas = [];

    for (const el of mensagens) {
      const texto = pegarTextoMensagem(el);
      if (!texto) continue;

      const tipo = tipoMensagem(el);
      if (tipo === "in" || tipo === "out") {
        linhas.push(texto);
      }
    }

    return linhas.join("\n\n");
  }

  function acharComposerWhatsApp() {
    const seletores = [
      'div[contenteditable="true"][data-tab="10"]',
      'div[contenteditable="true"][data-tab="9"]',
      "footer div[contenteditable='true']",
      'div[role="textbox"][contenteditable="true"]'
    ];

    for (const seletor of seletores) {
      const el = document.querySelector(seletor);
      if (el) return el;
    }

    return null;
  }

  function colarTextoNoWhatsApp(texto) {
    const composer = acharComposerWhatsApp();

    if (!composer) {
      throw new Error("Não achei a caixa de mensagem do WhatsApp.");
    }

    composer.focus();

    const okComando = document.execCommand("insertText", false, texto);

    if (!okComando) {
      composer.textContent = texto;
      composer.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }

    composer.focus();
  }

  function atualizarInterfacePorStatus(status) {
    CURRENT_STATUS = status;

    const paywall = document.querySelector("#tg-paywall");
    const app = document.querySelector("#tg-app");

    const liberado = status === "trial" || status === "active";

    if (paywall) {
      paywall.classList.toggle("tg-hidden", liberado);
    }

    if (app) {
      app.classList.toggle("tg-hidden", !liberado);
    }

    if (status === "active") {
      setStatus("Acesso ativo. Tudo liberado.");
    } else if (status === "trial") {
      setStatus("Trial ativo. Você pode usar normalmente.");
    } else if (status === "blocked") {
      setStatus("Acesso bloqueado. Faça o pagamento para liberar.");
    } else {
      setStatus("Não foi possível validar seu acesso.");
    }
  }

  async function atualizarStatusEInterface() {
    try {
      setBotoesDesabilitados(true);
      setStatus("Verificando status...");

      const dados = await getStatusUsuario();
      const status = dados?.usuario?.status || null;

      atualizarInterfacePorStatus(status);
    } catch (error) {
      const msg = String(error.message || "");

      if (
        msg.includes("Seu período de teste terminou") ||
        msg.includes("Acesso bloqueado") ||
        msg.includes("Seu acesso não está liberado")
      ) {
        atualizarInterfacePorStatus("blocked");
        return;
      }

      console.error("Erro ao verificar status:", error);
      setStatus("Erro ao verificar status: " + error.message);
    } finally {
      setBotoesDesabilitados(false);
    }
  }

  async function aoClicarLiberarAcesso() {
    try {
      setBotoesDesabilitados(true);
      setStatus("Abrindo checkout...");

      const checkoutUrl = await criarCheckoutSession();
      window.open(checkoutUrl, "_blank");

      setStatus("Checkout aberto. Após pagar, clique em Atualizar status.");
    } catch (error) {
      console.error("Erro ao abrir checkout:", error);
      setStatus("Erro ao abrir pagamento: " + error.message);
      alert("Erro ao abrir pagamento: " + error.message);
    } finally {
      setBotoesDesabilitados(false);
    }
  }

  async function aoClicarTraduzir() {
    try {
      if (!(CURRENT_STATUS === "trial" || CURRENT_STATUS === "active")) {
        atualizarInterfacePorStatus("blocked");
        return;
      }

      setBotoesDesabilitados(true);
      setTraducao("—");
      setStatus("Lendo mensagens novas...");

      const bloco = pegarMensagensNovasDepoisDaSuaUltima(10);

      if (!bloco.texto) {
        setStatus("Não achei mensagens novas depois da sua última mensagem.");
        return;
      }

      setStatus(`Traduzindo ${bloco.quantidade} mensagem(ns) nova(s)...`);
      const traducao = await traduzirMensagem(bloco.texto);

      if (!traducao) {
        setStatus("A tradução veio vazia.");
        return;
      }

      setTraducao(traducao);
      setStatus("Tradução pronta.");
    } catch (error) {
      console.error(error);

      if (
        String(error.message || "").includes("Seu período de teste terminou") ||
        String(error.message || "").includes("Acesso bloqueado")
      ) {
        atualizarInterfacePorStatus("blocked");
        return;
      }

      setStatus("Erro no Traduzir: " + error.message);
    } finally {
      setBotoesDesabilitados(false);
    }
  }

  async function aoClicarConverter() {
    try {
      if (!(CURRENT_STATUS === "trial" || CURRENT_STATUS === "active")) {
        atualizarInterfacePorStatus("blocked");
        return;
      }

      setBotoesDesabilitados(true);
      setIngles("—");
      setStatus("Convertendo para inglês...");

      const inputEl = getInputEl();
      const textoUsuario = getInputTexto();

      if (!textoUsuario) {
        setStatus("Digite sua resposta em português.");
        return;
      }

      const contexto = pegarContexto(12);
      const ingles = await converterParaIngles(textoUsuario, contexto);

      if (!ingles) {
        setStatus("O inglês veio vazio.");
        return;
      }

      setIngles(ingles);
      colarTextoNoWhatsApp(ingles);

      if (inputEl) {
        inputEl.value = "";
        inputEl.focus();
      }

      setStatus("Inglês pronto e já colado no WhatsApp.");
    } catch (error) {
      console.error(error);

      if (
        String(error.message || "").includes("Seu período de teste terminou") ||
        String(error.message || "").includes("Acesso bloqueado")
      ) {
        atualizarInterfacePorStatus("blocked");
        return;
      }

      setStatus("Erro no Converter: " + error.message);
    } finally {
      setBotoesDesabilitados(false);
    }
  }

  async function iniciar() {
    try {
      criarPainel();
      await garantirKey();
      await atualizarStatusEInterface();
    } catch (error) {
      console.error("Erro ao iniciar:", error);
      criarPainel();
      setStatus("Erro ao iniciar: " + error.message);
    }
  }

  const timer = setInterval(() => {
    if (document.body) {
      clearInterval(timer);
      iniciar();
    }
  }, 400);
})();