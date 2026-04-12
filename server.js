const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const CLIENT_SUCCESS_URL = process.env.CLIENT_SUCCESS_URL;
const CLIENT_CANCEL_URL = process.env.CLIENT_CANCEL_URL;

const stripe = new Stripe(STRIPE_SECRET_KEY);

// =====================================
// USUÁRIOS FIXOS DE TESTE
// =====================================
const ACCESS_USERS = {
  tg_test_trial: {
    status: "trial",
    trialEndsAt: "2030-01-01T23:59:59.000Z",
    email: "teste_trial@talkglobal.com",
    stripeCustomerId: null,
    stripeSubscriptionId: null
  },

  tg_test_active: {
    status: "active",
    trialEndsAt: null,
    email: "teste_active@talkglobal.com",
    stripeCustomerId: null,
    stripeSubscriptionId: null
  },

  tg_test_blocked: {
    status: "blocked",
    trialEndsAt: null,
    email: "teste_blocked@talkglobal.com",
    stripeCustomerId: null,
    stripeSubscriptionId: null
  }
};

// =====================================
// BANCO SIMPLES EM MEMÓRIA
// =====================================
const USERS_DB = {};

app.use(cors());

// =====================================
// WEBHOOK STRIPE
// IMPORTANTE: vem antes do express.json()
// =====================================
app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      if (!STRIPE_WEBHOOK_SECRET) {
        return res.status(500).send("STRIPE_WEBHOOK_SECRET não configurado.");
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

        const user = USERS_DB[accessKey] || ACCESS_USERS[accessKey];

        if (user) {
          user.stripeCustomerId = customerId;
          user.stripeSubscriptionId = subscriptionId;
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

        const user = encontrarUsuarioPorStripeCustomerId(customerId);

        if (user) {
          user.stripeSubscriptionId = subscriptionId;

          if (status === "trialing") {
            user.status = "trial";
            user.trialEndsAt = subscription.trial_end
              ? new Date(subscription.trial_end * 1000).toISOString()
              : user.trialEndsAt;
          } else if (status === "active") {
            user.status = "active";
            user.trialEndsAt = null;
          } else if (
            status === "canceled" ||
            status === "unpaid" ||
            status === "incomplete_expired" ||
            status === "paused"
          ) {
            user.status = "blocked";
          }
        }
      }

      if (tipo === "customer.subscription.deleted") {
        const subscription = objeto;
        const customerId = subscription.customer;

        const user = encontrarUsuarioPorStripeCustomerId(customerId);

        if (user) {
          user.status = "blocked";
          user.stripeSubscriptionId = subscription.id || null;
        }
      }

      return res.json({ received: true });
    } catch (error) {
      console.error("Erro no webhook Stripe:", error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }
  }
);

app.use(express.json({ limit: "1mb" }));

// =====================================
// FUNÇÕES AUXILIARES
// =====================================
function gerarAccessKey() {
  return "tg_" + Math.random().toString(36).slice(2, 14);
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
    !CLIENT_CANCEL_URL
  ) {
    res.status(500).json({
      erro: "Configuração Stripe incompleta no servidor."
    });
    return false;
  }
  return true;
}

function encontrarUsuarioPorStripeCustomerId(customerId) {
  if (!customerId) return null;

  for (const user of Object.values(USERS_DB)) {
    if (user.stripeCustomerId === customerId) {
      return user;
    }
  }

  for (const user of Object.values(ACCESS_USERS)) {
    if (user.stripeCustomerId === customerId) {
      return user;
    }
  }

  return null;
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

// =====================================
// MIDDLEWARE DE ACESSO
// =====================================
function verificarAcesso(req, res, next) {
  const userKey = (req.headers["x-talkglobal-key"] || "").trim();

  if (!userKey) {
    return res.status(401).json({
      erro: "Chave de acesso não enviada."
    });
  }

  const user = ACCESS_USERS[userKey] || USERS_DB[userKey];

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
    if (!user.trialEndsAt) {
      return res.status(403).json({
        erro: "Trial inválido."
      });
    }

    const agora = new Date();
    const fim = new Date(user.trialEndsAt);

    if (Number.isNaN(fim.getTime())) {
      return res.status(403).json({
        erro: "Data de trial inválida."
      });
    }

    if (agora > fim) {
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

  req.tgUser = {
    key: userKey,
    email: user.email,
    status: user.status,
    trialEndsAt: user.trialEndsAt || null,
    stripeCustomerId: user.stripeCustomerId || null,
    stripeSubscriptionId: user.stripeSubscriptionId || null
  };

  next();
}

// =====================================
// ROTAS BÁSICAS
// =====================================
app.get("/", (req, res) => {
  res.send("TalkGlobal backend online.");
});

// =====================================
// CRIAR USUÁRIO AUTOMATICAMENTE
// =====================================
app.post("/criar-usuario", (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        erro: "Email obrigatório."
      });
    }

    const emailLimpo = email.trim().toLowerCase();

    for (const [accessKey, user] of Object.entries(USERS_DB)) {
      if (user.email === emailLimpo) {
        return res.json({
          accessKey,
          email: user.email,
          status: user.status,
          trialEndsAt: user.trialEndsAt,
          stripeCustomerId: user.stripeCustomerId || null,
          stripeSubscriptionId: user.stripeSubscriptionId || null
        });
      }
    }

    const accessKey = gerarAccessKey();
    const trialEndsAt = adicionarDias(new Date(), 3).toISOString();

    USERS_DB[accessKey] = {
      email: emailLimpo,
      status: "trial",
      trialEndsAt,
      stripeCustomerId: null,
      stripeSubscriptionId: null
    };

    return res.json({
      accessKey,
      email: emailLimpo,
      status: "trial",
      trialEndsAt,
      stripeCustomerId: null,
      stripeSubscriptionId: null
    });
  } catch (error) {
    console.error("Erro em /criar-usuario:", error);
    return res.status(500).json({
      erro: "Erro ao criar usuário."
    });
  }
});

// =====================================
// STATUS DO USUÁRIO
// =====================================
app.get("/meu-status", verificarAcesso, (req, res) => {
  return res.json({
    ok: true,
    usuario: {
      ...req.tgUser,
      status: "blocked"
    }
  });
});

// =====================================
// CRIAR CHECKOUT SESSION STRIPE
// =====================================
app.post("/create-checkout-session", async (req, res) => {
  try {
    if (!garantirStripeConfig(res)) return;

    const { accessKey } = req.body;

    if (!accessKey || typeof accessKey !== "string") {
      return res.status(400).json({
        erro: "accessKey obrigatória."
      });
    }

    const user = ACCESS_USERS[accessKey] || USERS_DB[accessKey];

    if (!user) {
      return res.status(404).json({
        erro: "Usuário não encontrado."
      });
    }

    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          accessKey
        }
      });

      customerId = customer.id;
      user.stripeCustomerId = customerId;
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

// =====================================
// TRADUZIR
// =====================================
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

// =====================================
// CONVERTER
// =====================================
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
