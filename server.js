const fetch = require("node-fetch");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { supabase } = require("./lib/supabase");

const {
  PORT,
  OPENAI_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  DEVICE_ID_HEADER,
  DEVICE_NAME_HEADER,
  DEVICE_ACTIVE_DAYS,
  TRIAL_DAYS
} = require("./lib/env");

const {
  HOTMART_PRODUCT_ID,
  getHotmartCheckoutUrl,
  getPlanoPorHotmart,
  validarTokenHotmart
} = require("./lib/hotmart");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// =============================
// HELPERS
// =============================

function gerarAccessKey() {
  return `tg_${crypto.randomBytes(16).toString("hex")}`;
}

function adicionarDias(data, dias) {
  const novaData = new Date(data);
  novaData.setDate(novaData.getDate() + dias);
  return novaData;
}

function garantirOpenAIKey(res) {
  if (!OPENAI_API_KEY) {
    res.status(500).json({
      erro: "OPENAI_API_KEY não configurada."
    });
    return false;
  }
  return true;
}

// =============================
// DB HELPERS
// =============================

async function buscarUsuarioPorEmail(email) {
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  return data;
}

async function atualizarUsuarioPorAccessKey(accessKey, campos) {
  const { data } = await supabase
    .from("users")
    .update({
      ...campos,
      updated_at: new Date().toISOString()
    })
    .eq("access_key", accessKey)
    .select()
    .maybeSingle();

  return data;
}

// =============================
// HOTMART HELPERS
// =============================

function extrairEmailHotmart(body = {}) {
  return String(
    body?.data?.buyer?.email ||
    body?.buyer?.email ||
    body?.email ||
    ""
  ).trim().toLowerCase();
}

function extrairEventoHotmart(body = {}) {
  return String(
    body?.event ||
    body?.event_name ||
    body?.type ||
    ""
  ).toUpperCase();
}

function extrairProdutoHotmart(body = {}) {
  return String(
    body?.data?.product?.id ||
    body?.product_id ||
    ""
  ).trim();
}

function eventoLiberaAcesso(evento) {
  return [
    "PURCHASE_APPROVED",
    "PURCHASE_COMPLETE",
    "SUBSCRIPTION_RENEWED"
  ].includes(evento);
}

function eventoBloqueiaAcesso(evento) {
  return [
    "PURCHASE_REFUNDED",
    "PURCHASE_CHARGEBACK",
    "SUBSCRIPTION_CANCELED"
  ].includes(evento);
}

async function ativarUsuario(email, plan) {
  let user = await buscarUsuarioPorEmail(email);

  if (user) {
    return atualizarUsuarioPorAccessKey(user.access_key, {
      status: "active",
      plan,
      trial_ends_at: null
    });
  }

  const novo = {
    access_key: gerarAccessKey(),
    email,
    status: "active",
    plan,
    trial_ends_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data } = await supabase
    .from("users")
    .insert(novo)
    .select()
    .single();

  return data;
}

async function bloquearUsuario(email) {
  const user = await buscarUsuarioPorEmail(email);
  if (!user) return null;

  return atualizarUsuarioPorAccessKey(user.access_key, {
    status: "blocked",
    plan: null
  });
}

// =============================
// ROTAS
// =============================

app.get("/", (req, res) => {
  res.json({ ok: true });
});

app.get("/debug/env", (req, res) => {
  res.json({
    supabase: Boolean(SUPABASE_URL),
    hotmartProduct: Boolean(process.env.HOTMART_PRODUCT_ID),
    hotmartToken: Boolean(process.env.HOTMART_WEBHOOK_TOKEN),
    openai: Boolean(OPENAI_API_KEY)
  });
});

// =============================
// HOTMART WEBHOOK
// =============================

app.post("/hotmart/webhook", async (req, res) => {
  try {
    // 🔐 valida token
    if (!validarTokenHotmart(req)) {
      return res.status(401).json({ erro: "Token inválido" });
    }

    const evento = extrairEventoHotmart(req.body);
    const email = extrairEmailHotmart(req.body);
    const produtoId = extrairProdutoHotmart(req.body);
    const plan = getPlanoPorHotmart(req.body) || "basic";

    if (HOTMART_PRODUCT_ID && produtoId !== HOTMART_PRODUCT_ID) {
      return res.json({ ignorado: true });
    }

    if (!email) {
      return res.status(400).json({ erro: "Sem email" });
    }

    // ✅ ATIVA
    if (eventoLiberaAcesso(evento)) {
      const user = await ativarUsuario(email, plan);
      return res.json({ ok: true, acao: "ativado", user });
    }

    // ❌ BLOQUEIA
    if (eventoBloqueiaAcesso(evento)) {
      const user = await bloquearUsuario(email);
      return res.json({ ok: true, acao: "bloqueado", user });
    }

    return res.json({ ok: true, ignorado: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "erro webhook" });
  }
});

// =============================
// CHECKOUT
// =============================

app.post("/create-checkout-session", (req, res) => {
  const { plan } = req.body;

  if (!plan) {
    return res.status(400).json({ erro: "plan obrigatório" });
  }

  const url = getHotmartCheckoutUrl(plan);

  res.json({ checkoutUrl: url });
});

// =============================
// OPENAI
// =============================

app.post("/traduzir", async (req, res) => {
  if (!garantirOpenAIKey(res)) return;

  const { texto } = req.body;

  const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: texto }]
    })
  });

  const data = await resposta.json();

  res.json({
    resultado: data.choices?.[0]?.message?.content
  });
});

// =============================

app.listen(PORT, () => {
  console.log("rodando:", PORT);
});
