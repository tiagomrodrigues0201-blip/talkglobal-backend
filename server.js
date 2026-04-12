const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const CLIENT_SUCCESS_URL = process.env.CLIENT_SUCCESS_URL;
const CLIENT_CANCEL_URL = process.env.CLIENT_CANCEL_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("SUPABASE_URL ou SUPABASE_KEY não configuradas.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

app.use(cors());

app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!stripe || !STRIPE_WEBHOOK_SECRET) {
        return res.status(500).send("Stripe não configurado no servidor.");
      }

      const signature = req.headers["stripe-signature"];

      const event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        STRIPE_WEBHOOK_SECRET
      );

      const tipo = event.type;
      const objeto = event.data.object;

      if (tipo === "checkout.session.completed") {
        const accessKey = objeto?.metadata?.accessKey;
        const customerId = objeto?.customer || null;
        const subscriptionId = objeto?.subscription || null;

        if (accessKey) {
          await atualizarUsuarioPorAccessKey(accessKey, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId
          });
        }
      }

      if (
        tipo === "customer.subscription.created" ||
        tipo === "customer.subscription.updated"
      ) {
        const subscription = objeto;
        const customerId = subscription.customer;
        const subscriptionId = subscription.id;
        const status = subscription.status;

        const campos = {
          stripe_subscription_id: subscriptionId
        };

        if (status === "trialing") {
          campos.status = "trial";
          campos.trial_ends_at = subscription.trial_end
            ? new Date(subscription.trial_end * 1000).toISOString()
            : null;
        } else if (status === "active") {
          campos.status = "active";
          campos.trial_ends_at = null;
        } else if (
          status === "canceled" ||
          status === "unpaid" ||
          status === "incomplete_expired" ||
          status === "paused"
        ) {
          campos.status = "blocked";
        }

        await atualizarUsuarioPorStripeCustomerId(customerId, campos);
      }

      if (tipo === "customer.subscription.deleted") {
        const subscription = objeto;
        const customerId = subscription.customer;

        await atualizarUsuarioPorStripeCustomerId(customerId, {
          status: "blocked",
          stripe_subscription_id: subscription.id || null
        });
      }

      return res.json({ received: true });
    } catch (error) {
      console.error("Erro no webhook Stripe:", error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }
  }
);

app.use(express.json({ limit: "1mb" }));

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
      erro: "OPENAI_API_KEY não configurada no servidor."
    });
    return false;
  }
  return true;
}

function garantirStripeConfig(res) {
  if (
    !STRIPE_SECRET_KEY ||
    !STRIPE_PRICE_ID ||
    !CLIENT_SUCCESS_URL ||
    !CLIENT_CANCEL_URL ||
    !stripe
  ) {
    res.status(500).json({
      erro: "Configuração Stripe incompleta no servidor."
    });
    return false;
  }
  return true;
}

function mapearUsuarioDoBanco(user) {
  if (!user) return null;

  return {
    key: user.access_key,
    email: user.email,
    status: user.status,
    trialEndsAt: user.trial_ends_at,
    stripeCustomerId: user.stripe_customer_id,
    stripeSubscriptionId: user.stripe_subscription_id,
    createdAt: user.created_at,
    updatedAt: user.updated_at
  };
}

async function buscarUsuarioPorAccessKey(accessKey) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("access_key", accessKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar usuário por access_key: ${error.message}`);
  }

  return data;
}

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

async function atualizarUsuarioPorStripeCustomerId(customerId, campos) {
  if (!customerId) return null;

  const { data, error } = await supabase
    .from("users")
    .update({
      ...campos,
      updated_at: new Date().toISOString()
    })
    .eq("stripe_customer_id", customerId)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(
      `Erro ao atualizar usuário por stripe_customer_id: ${error.message}`
    );
  }

  return data;
}

async function criarUsuario({ email }) {
  const agora = new Date();
  const payload = {
    access_key: gerarAccessKey(),
    email: email || null,
    status: "trial",
    trial_ends_at: adicionarDias(agora, 3).toISOString(),
    stripe_customer_id: null,
    stripe_subscription_id: null,
    updated_at: agora.toISOString()
  };

  const { data, error } = await supabase
    .from("users")
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao criar usuário: ${error.message}`);
  }

  return data;
}

async function verificarAcesso(req, res, next) {
  try {
    const userKey = (req.headers["x-talkglobal-key"] || "").trim();

    if (!userKey) {
      return res.status(401).json({
        erro: "Chave de acesso não enviada."
      });
    }

    const user = await buscarUsuarioPorAccessKey(userKey);

    if (!user) {
      return res.status(403).json({
        erro: "Acesso não autorizado."
      });
    }

    if (user.status === "blocked") {
      return res.status(403).json({
        erro: "Acesso bloqueado."
      });
    }

    if (user.status === "trial") {
      if (!user.trial_ends_at) {
        return res.status(403).json({
          erro: "Trial inválido."
        });
      }

      const agora = new Date();
      const fim = new Date(user.trial_ends_at);

      if (Number.isNaN(fim.getTime())) {
        return res.status(403).json({
          erro: "Data de trial inválida."
        });
      }

      if (agora > fim) {
        await atualizarUsuarioPorAccessKey(userKey, {
          status: "blocked"
        });

        return res.status(403).json({
          erro: "Seu período de teste terminou."
        });
      }
    }

    if (user.status !== "active" && user.status !== "trial") {
      return res.status(403).json({
        erro: "Seu acesso não está liberado."
      });
    }

    req.tgUser = mapearUsuarioDoBanco(user);
    next();
  } catch (error) {
    console.error("Erro em verificarAcesso:", error);
    return res.status(500).json({
      erro: "Erro interno ao validar acesso."
    });
  }
}

async function chamarOpenAI(systemPrompt, userPrompt) {
  const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  const dados = await resposta.json();

  if (!resposta.ok) {
    const mensagem =
      dados?.error?.message ||
      dados?.erro ||
      "Erro ao comunicar com a OpenAI.";
    throw new Error(mensagem);
  }

  const texto = dados?.choices?.[0]?.message?.content?.trim();

  if (!texto) {
    throw new Error("A resposta da OpenAI veio vazia.");
  }

  return texto;
}

app.post("/criar-usuario", async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        erro: "Email obrigatório."
      });
    }

    const emailLimpo = email.trim().toLowerCase();

    const usuarioExistente = await buscarUsuarioPorEmail(emailLimpo);

    if (usuarioExistente) {
      return res.json({
        accessKey: usuarioExistente.access_key,
        email: usuarioExistente.email,
        status: usuarioExistente.status,
        trialEndsAt: usuarioExistente.trial_ends_at,
        stripeCustomerId: usuarioExistente.stripe_customer_id,
        stripeSubscriptionId: usuarioExistente.stripe_subscription_id
      });
    }

    const usuario = await criarUsuario({ email: emailLimpo });

    return res.json({
      accessKey: usuario.access_key,
      email: usuario.email,
      status: usuario.status,
      trialEndsAt: usuario.trial_ends_at,
      stripeCustomerId: usuario.stripe_customer_id,
      stripeSubscriptionId: usuario.stripe_subscription_id
    });
  } catch (error) {
    console.error("Erro em /criar-usuario:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao criar usuário."
    });
  }
});

app.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase.from("users").select("*").limit(1);

    if (error) {
      return res.status(500).json({
        ok: false,
        tipo: "supabase_error",
        erro: error.message
      });
    }

    return res.json({
      ok: true,
      mensagem: "Conectou no Supabase",
      total: data.length
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      tipo: "catch",
      erro: error.message
    });
  }
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    if (!garantirStripeConfig(res)) return;

    const { accessKey } = req.body || {};

    if (!accessKey || typeof accessKey !== "string") {
      return res.status(400).json({
        erro: "accessKey obrigatória."
      });
    }

    const user = await buscarUsuarioPorAccessKey(accessKey);

    if (!user) {
      return res.status(404).json({
        erro: "Usuário não encontrado."
      });
    }

    let customerId = user.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          accessKey
        }
      });

      customerId = customer.id;

      await atualizarUsuarioPorAccessKey(accessKey, {
        stripe_customer_id: customerId
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: STRIPE_PRICE_ID,
          quantity: 1
        }
      ],
      success_url: `${CLIENT_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: CLIENT_CANCEL_URL,
      subscription_data: {
        trial_period_days: 3,
        metadata: {
          accessKey
        }
      },
      metadata: {
        accessKey
      }
    });

    return res.json({
      checkoutUrl: session.url
    });
  } catch (error) {
    console.error("Erro em /create-checkout-session:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao criar checkout session."
    });
  }
});

app.post("/traduzir", verificarAcesso, async (req, res) => {
  try {
    if (!garantirOpenAIKey(res)) return;

    const { texto } = req.body;

    if (!texto || typeof texto !== "string" || !texto.trim()) {
      return res.status(400).json({
        erro: "Texto inválido para tradução."
      });
    }

    const systemPrompt = `
Você é um tradutor profissional.
Traduza a mensagem para português do Brasil de forma natural, clara e fiel.
Se vierem várias mensagens seguidas, mantenha a ordem.
Não explique.
Não adicione observações.
Entregue só a tradução final.
`.trim();

    const resultado = await chamarOpenAI(systemPrompt, texto.trim());

    return res.json({ resultado });
  } catch (error) {
    console.error("Erro em /traduzir:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao traduzir."
    });
  }
});

app.post("/converter", verificarAcesso, async (req, res) => {
  try {
    if (!garantirOpenAIKey(res)) return;

    const { texto, contexto } = req.body;

    if (!texto || typeof texto !== "string" || !texto.trim()) {
      return res.status(400).json({
        erro: "Texto inválido para conversão."
      });
    }

    const systemPrompt = `
Você é um assistente que transforma respostas escritas em português
em inglês natural, curto, claro e profissional para conversa no WhatsApp.

Regras:
- Entregue apenas a versão final em inglês.
- Não explique.
- Não use aspas.
- Soe natural, como alguém fluente conversando.
- Considere o contexto da conversa, se ele existir.
`.trim();

    const userPrompt = `
CONTEXTO DA CONVERSA:
${contexto || "(sem contexto)"}

RESPOSTA EM PORTUGUÊS:
${texto.trim()}
`.trim();

    const resultado = await chamarOpenAI(systemPrompt, userPrompt);

    return res.json({ resultado });
  } catch (error) {
    console.error("Erro em /converter:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao converter."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});