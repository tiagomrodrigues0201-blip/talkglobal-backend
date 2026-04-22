const fetch = require("node-fetch");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { supabase } = require("./lib/supabase");
const {
  PORT,
  OPENAI_API_KEY,
  SUPABASE_URL
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
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar usuário por email: ${error.message}`);
  }

  return data;
}

async function atualizarUsuarioPorAccessKey(accessKey, campos) {
  const { data, error } = await supabase
    .from("users")
    .update({
      ...campos,
      updated_at: new Date().toISOString()
    })
    .eq("access_key", accessKey)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao atualizar usuário por access_key: ${error.message}`);
  }

  return data;
}

async function criarUsuarioHotmart(email, plan) {
  const agora = new Date().toISOString();

  const payload = {
    access_key: gerarAccessKey(),
    auth_user_id: null,
    email,
    status: "active",
    plan,
    trial_ends_at: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    created_at: agora,
    updated_at: agora
  };

  const { data, error } = await supabase
    .from("users")
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao criar usuário Hotmart: ${error.message}`);
  }

  return data;
}

// =============================
// HOTMART HELPERS
// =============================

function extrairEmailHotmart(body = {}) {
  return String(
    body?.data?.buyer?.email ||
    body?.data?.purchase?.buyer?.email ||
    body?.data?.user?.email ||
    body?.data?.subscriber?.email ||
    body?.data?.subscription?.subscriber?.email ||
    body?.data?.user?.contact?.email ||
    body?.data?.user?.checkout_email ||
    body?.data?.user?.email_address ||
    body?.data?.user?.mail ||
    body?.data?.user?.primary_email ||
    body?.data?.user?.email_contact ||
    body?.data?.contact?.email ||
    body?.data?.subscriber?.contact?.email ||
    body?.data?.user?.buyer?.email ||
    body?.data?.client?.email ||
    body?.buyer?.email ||
    body?.buyer_email ||
    body?.user?.email ||
    body?.subscriber?.email ||
    body?.email ||
    ""
  ).trim().toLowerCase();
}

function extrairEventoHotmart(body = {}) {
  return String(
    body?.event ||
    body?.event_name ||
    body?.type ||
    body?.data?.event ||
    ""
  ).trim().toUpperCase();
}

function extrairProdutoHotmart(body = {}) {
  const valor = (
    body?.data?.product?.id ??
    body?.data?.purchase?.product?.id ??
    body?.data?.subscription?.product?.id ??
    body?.product?.id ??
    body?.product_id ??
    ""
  );

  return String(valor).trim();
}

function eventoLiberaAcesso(evento) {
  return [
    "PURCHASE_APPROVED",
    "PURCHASE_COMPLETE",
    "PURCHASE_CANCELED_REVERSED",
    "SUBSCRIPTION_PURCHASE_APPROVED",
    "SUBSCRIPTION_REACTIVATED",
    "SUBSCRIPTION_RENEWED",
    "BILLET_PRINTED"
  ].includes(evento);
}

function eventoBloqueiaAcesso(evento) {
  return [
    "PURCHASE_REFUNDED",
    "PURCHASE_CHARGEBACK",
    "PURCHASE_CANCELED",
    "SUBSCRIPTION_CANCELLATION",
    "SUBSCRIPTION_CANCELED",
    "SUBSCRIPTION_EXPIRED",
    "SUBSCRIPTION_DELAYED"
  ].includes(evento);
}

function eventoIgnoravel(evento) {
  return [
    "CLUB_FIRST_ACCESS",
    "SWITCH_PLAN",
    "UPDATE_SUBSCRIPTION_CHARGE_DATE",
    "MODULE_COMPLETED",
    "BOLETO_PRINTED",
    "PURCHASE_DELAYED",
    "PURCHASE_EXPIRED",
    "PURCHASE_PROTEST",
    "PURCHASE_BILLET_PRINTED",
    "PURCHASE_OUT_OF_SHOPPING_CART",
    "ABANDONED_CART",
    "CART_ABANDONMENT",
    "ORDER_BUMP_ACCEPTED",
    "ORDER_BUMP_REJECTED"
  ].includes(evento);
}

async function ativarUsuario(email, plan) {
  let user = await buscarUsuarioPorEmail(email);

  if (user) {
    return atualizarUsuarioPorAccessKey(user.access_key, {
      email,
      status: "active",
      plan: plan || "basic",
      trial_ends_at: null
    });
  }

  return criarUsuarioHotmart(email, plan || "basic");
}

async function bloquearUsuario(email) {
  const user = await buscarUsuarioPorEmail(email);

  if (!user) {
    return null;
  }

  return atualizarUsuarioPorAccessKey(user.access_key, {
    status: "blocked",
    plan: null,
    trial_ends_at: null
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
    hotmartBasicUrl: Boolean(process.env.HOTMART_BASIC_CHECKOUT_URL),
    hotmartProUrl: Boolean(process.env.HOTMART_PRO_CHECKOUT_URL),
    openai: Boolean(OPENAI_API_KEY)
  });
});

// =============================
// HOTMART WEBHOOK
// =============================

app.post("/hotmart/webhook", async (req, res) => {
  try {
    if (!validarTokenHotmart(req)) {
      return res.status(401).json({ erro: "Token inválido" });
    }

    const evento = extrairEventoHotmart(req.body);
    const email = extrairEmailHotmart(req.body);
    const produtoId = extrairProdutoHotmart(req.body);
    const plan = getPlanoPorHotmart(req.body) || "basic";

    console.log("Webhook Hotmart recebido:", {
      evento,
      email,
      produtoId,
      plan
    });

    if (
      HOTMART_PRODUCT_ID &&
      produtoId &&
      String(produtoId) !== String(HOTMART_PRODUCT_ID)
    ) {
      return res.json({
        ok: true,
        ignorado: true,
        motivo: "produto_diferente"
      });
    }

    if (eventoIgnoravel(evento)) {
      return res.json({
        ok: true,
        ignorado: true,
        motivo: "evento_ignorado",
        evento
      });
    }

    if (!email) {
      return res.json({
        ok: true,
        ignorado: true,
        motivo: "sem_email",
        evento
      });
    }

    if (eventoLiberaAcesso(evento)) {
      const user = await ativarUsuario(email, plan);
      return res.json({
        ok: true,
        acao: "ativado",
        evento,
        user
      });
    }

    if (eventoBloqueiaAcesso(evento)) {
      const user = await bloquearUsuario(email);
      return res.json({
        ok: true,
        acao: "bloqueado",
        evento,
        user
      });
    }

    return res.json({
      ok: true,
      ignorado: true,
      motivo: "evento_nao_mapeado",
      evento
    });
  } catch (err) {
    console.error("Erro no webhook Hotmart:", err);
    return res.status(500).json({ erro: "erro webhook" });
  }
});

// =============================
// CHECKOUT
// =============================

app.post("/create-checkout-session", (req, res) => {
  try {
    const { plan } = req.body || {};

    if (!plan) {
      return res.status(400).json({ erro: "plan obrigatório" });
    }

    const url = getHotmartCheckoutUrl(plan);

    return res.json({ checkoutUrl: url });
  } catch (error) {
    return res.status(500).json({
      erro: error.message || "Erro ao gerar checkout"
    });
  }
});

// =============================
// OPENAI
// =============================

app.post("/traduzir", async (req, res) => {
  try {
    if (!garantirOpenAIKey(res)) return;

    const { texto } = req.body || {};

    if (!texto || typeof texto !== "string" || !texto.trim()) {
      return res.status(400).json({
        erro: "Texto inválido para tradução."
      });
    }

    const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Traduza para português do Brasil de forma natural. Responda apenas com a tradução final."
          },
          {
            role: "user",
            content: texto
          }
        ]
      })
    });

    const data = await resposta.json();

    if (!resposta.ok) {
      return res.status(500).json({
        erro: data?.error?.message || "Erro ao comunicar com OpenAI"
      });
    }

    return res.json({
      resultado: data?.choices?.[0]?.message?.content || ""
    });
  } catch (error) {
    return res.status(500).json({
      erro: error.message || "Erro ao traduzir"
    });
  }
});

// =============================

app.listen(PORT, () => {
  console.log("rodando:", PORT);
});
