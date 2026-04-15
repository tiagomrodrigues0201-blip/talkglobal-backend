const fetch = require("node-fetch");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { getPlan } = require("./plans");

const app = express();
const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const CLIENT_SUCCESS_URL = process.env.CLIENT_SUCCESS_URL;
const CLIENT_CANCEL_URL = process.env.CLIENT_CANCEL_URL;

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  ""
).trim();

const DEVICE_ID_HEADER = "x-talkglobal-device-id";
const DEVICE_NAME_HEADER = "x-talkglobal-device-name";
const DEVICE_ACTIVE_DAYS = 30;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  global: {
    fetch
  }
});

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
        const authUserId = objeto?.metadata?.authUserId || null;
        const accessKey = objeto?.metadata?.accessKey || null;
        const customerId = objeto?.customer || null;
        const subscriptionId = objeto?.subscription || null;
        const plan = objeto?.metadata?.plan || null;

        if (authUserId) {
          await atualizarUsuarioPorAuthUserId(authUserId, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            plan: plan || "free"
          });
        } else if (accessKey) {
          await atualizarUsuarioPorAccessKey(accessKey, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            plan: plan || "free"
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
        const authUserId = subscription?.metadata?.authUserId || null;

        let plan = subscription?.metadata?.plan || null;

        if (!plan) {
          const priceId = subscription?.items?.data?.[0]?.price?.id || null;

          if (priceId === process.env.STRIPE_PRICE_BASIC) {
            plan = "basic";
          } else if (priceId === process.env.STRIPE_PRICE_PRO) {
            plan = "pro";
          }
        }

        const campos = {
          stripe_subscription_id: subscriptionId
        };

        if (plan) {
          campos.plan = plan;
        }

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
          status === "paused" ||
          status === "incomplete"
        ) {
          campos.status = "blocked";
        }

        if (authUserId) {
          await atualizarUsuarioPorAuthUserId(authUserId, campos);
        } else {
          await atualizarUsuarioPorStripeCustomerId(customerId, campos);
        }
      }

      if (tipo === "customer.subscription.deleted") {
        const subscription = objeto;
        const customerId = subscription.customer;
        const authUserId = subscription?.metadata?.authUserId || null;

        const campos = {
          status: "blocked",
          stripe_subscription_id: subscription.id || null,
          plan: "free"
        };

        if (authUserId) {
          await atualizarUsuarioPorAuthUserId(authUserId, campos);
        } else {
          await atualizarUsuarioPorStripeCustomerId(customerId, campos);
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

function gerarAccessKey() {
  return `tg_${crypto.randomBytes(16).toString("hex")}`;
}

function adicionarDias(data, dias) {
  const novaData = new Date(data);
  novaData.setDate(novaData.getDate() + dias);
  return novaData;
}

function getDeviceLimitForPlan(plan) {
  const plano = String(plan || "free").toLowerCase();

  if (plano === "pro") return 3;
  if (plano === "basic") return 1;

  return 1;
}

function getDeviceCutoffIso() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DEVICE_ACTIVE_DAYS);
  return cutoff.toISOString();
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
    !process.env.STRIPE_PRICE_BASIC ||
    !process.env.STRIPE_PRICE_PRO ||
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
    id: user.id,
    authUserId: user.auth_user_id || null,
    key: user.access_key || null,
    email: user.email,
    status: user.status,
    plan: user.plan || "free",
    trialEndsAt: user.trial_ends_at,
    stripeCustomerId: user.stripe_customer_id,
    stripeSubscriptionId: user.stripe_subscription_id,
    createdAt: user.created_at,
    updatedAt: user.updated_at
  };
}

function mapearDevice(device) {
  if (!device) return null;

  return {
    id: device.id,
    authUserId: device.auth_user_id,
    deviceId: device.device_id,
    deviceName: device.device_name,
    lastSeenAt: device.last_seen_at,
    createdAt: device.created_at,
    updatedAt: device.updated_at
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

async function buscarUsuarioPorAuthUserId(authUserId) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar usuário por auth_user_id: ${error.message}`);
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

async function atualizarUsuarioPorAuthUserId(authUserId, campos) {
  const { data, error } = await supabase
    .from("users")
    .update({
      ...campos,
      updated_at: new Date().toISOString()
    })
    .eq("auth_user_id", authUserId)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao atualizar usuário por auth_user_id: ${error.message}`);
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

async function criarUsuarioLegacy({ email }) {
  const agora = new Date();

  const payload = {
    access_key: gerarAccessKey(),
    auth_user_id: null,
    email: email || null,
    status: "trial",
    plan: "free",
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
    throw new Error(`Erro ao criar usuário legacy: ${error.message}`);
  }

  return data;
}

async function criarOuVincularUsuarioAuth(authUser) {
  if (!authUser?.id || !authUser?.email) {
    throw new Error("Usuário autenticado inválido.");
  }

  const emailLimpo = String(authUser.email).trim().toLowerCase();

  let usuario = await buscarUsuarioPorAuthUserId(authUser.id);
  if (usuario) {
    if (usuario.email !== emailLimpo) {
      usuario = await atualizarUsuarioPorAuthUserId(authUser.id, {
        email: emailLimpo
      });
    }
    return usuario;
  }

  const usuarioPorEmail = await buscarUsuarioPorEmail(emailLimpo);
  if (usuarioPorEmail) {
    const atualizado = await supabase
      .from("users")
      .update({
        auth_user_id: authUser.id,
        email: emailLimpo,
        updated_at: new Date().toISOString()
      })
      .eq("id", usuarioPorEmail.id)
      .select()
      .single();

    if (atualizado.error) {
      throw new Error(`Erro ao vincular usuário auth: ${atualizado.error.message}`);
    }

    return atualizado.data;
  }

  const agora = new Date();

  const payload = {
    auth_user_id: authUser.id,
    access_key: gerarAccessKey(),
    email: emailLimpo,
    status: "trial",
    plan: "free",
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
    throw new Error(`Erro ao criar usuário auth: ${error.message}`);
  }

  return data;
}

function validarStatusDoUsuario(user) {
  if (!user) {
    return {
      ok: false,
      statusCode: 403,
      erro: "Acesso não autorizado."
    };
  }

  if (user.status === "blocked") {
    return {
      ok: false,
      statusCode: 403,
      erro: "Acesso bloqueado."
    };
  }

  if (user.status === "trial") {
    if (!user.trial_ends_at) {
      return {
        ok: false,
        statusCode: 403,
        erro: "Trial inválido."
      };
    }

    const agora = new Date();
    const fim = new Date(user.trial_ends_at);

    if (Number.isNaN(fim.getTime())) {
      return {
        ok: false,
        statusCode: 403,
        erro: "Data de trial inválida."
      };
    }

    if (agora > fim) {
      return {
        ok: false,
        statusCode: 403,
        erro: "Seu período de teste terminou.",
        expiredTrial: true
      };
    }
  }

  if (user.status !== "active" && user.status !== "trial") {
    return {
      ok: false,
      statusCode: 403,
      erro: "Seu acesso não está liberado."
    };
  }

  return { ok: true };
}

async function verificarAcessoLegacy(req, res, next) {
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

    const validacao = validarStatusDoUsuario(user);

    if (!validacao.ok) {
      if (validacao.expiredTrial) {
        await atualizarUsuarioPorAccessKey(userKey, {
          status: "blocked"
        });
      }

      return res.status(validacao.statusCode).json({
        erro: validacao.erro
      });
    }

    req.tgUser = mapearUsuarioDoBanco(user);
    next();
  } catch (error) {
    console.error("Erro em verificarAcessoLegacy:", error);
    return res.status(500).json({
      erro: "Erro interno ao validar acesso."
    });
  }
}

async function removerDispositivosAntigos(authUserId) {
  const cutoffIso = getDeviceCutoffIso();

  const { error } = await supabase
    .from("user_devices")
    .delete()
    .eq("auth_user_id", authUserId)
    .lt("last_seen_at", cutoffIso);

  if (error) {
    throw new Error(`Erro ao remover dispositivos antigos: ${error.message}`);
  }
}

async function buscarDispositivo(authUserId, deviceId) {
  const { data, error } = await supabase
    .from("user_devices")
    .select("*")
    .eq("auth_user_id", authUserId)
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar dispositivo: ${error.message}`);
  }

  return data;
}

async function listarDispositivosAtivos(authUserId) {
  const cutoffIso = getDeviceCutoffIso();

  const { data, error } = await supabase
    .from("user_devices")
    .select("*")
    .eq("auth_user_id", authUserId)
    .gte("last_seen_at", cutoffIso)
    .order("last_seen_at", { ascending: false });

  if (error) {
    throw new Error(`Erro ao listar dispositivos ativos: ${error.message}`);
  }

  return data || [];
}

async function upsertDispositivo(authUserId, deviceId, deviceName) {
  const agora = new Date().toISOString();

  const { data, error } = await supabase
    .from("user_devices")
    .upsert(
      {
        auth_user_id: authUserId,
        device_id: deviceId,
        device_name: deviceName || null,
        last_seen_at: agora,
        updated_at: agora
      },
      {
        onConflict: "auth_user_id,device_id"
      }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao registrar dispositivo: ${error.message}`);
  }

  return data;
}

async function validarLimiteDispositivos(user, deviceId, deviceName) {
  if (!user?.auth_user_id) {
    throw new Error("Usuário sem auth_user_id.");
  }

  if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
    return {
      ok: false,
      statusCode: 400,
      erro: "Dispositivo não identificado."
    };
  }

  await removerDispositivosAntigos(user.auth_user_id);

  const deviceIdLimpo = deviceId.trim();
  const deviceExistente = await buscarDispositivo(user.auth_user_id, deviceIdLimpo);

  if (deviceExistente) {
    const atualizado = await upsertDispositivo(
      user.auth_user_id,
      deviceIdLimpo,
      deviceName || deviceExistente.device_name || null
    );

    return {
      ok: true,
      dispositivo: atualizado,
      limite: getDeviceLimitForPlan(user.plan)
    };
  }

  const dispositivosAtivos = await listarDispositivosAtivos(user.auth_user_id);
  const limite = getDeviceLimitForPlan(user.plan);

  if (dispositivosAtivos.length >= limite) {
    return {
      ok: false,
      statusCode: 403,
      erro:
        `Limite de dispositivos atingido para o plano ${user.plan || "free"}. ` +
        `Seu plano permite ${limite} dispositivo(s) ativo(s).`
    };
  }

  const criado = await upsertDispositivo(
    user.auth_user_id,
    deviceIdLimpo,
    deviceName || null
  );

  return {
    ok: true,
    dispositivo: criado,
    limite
  };
}

async function verificarAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

    if (!token) {
      return res.status(401).json({
        erro: "Token não enviado."
      });
    }

    const {
      data: { user },
      error
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        erro: "Token inválido."
      });
    }

    let dbUser = await criarOuVincularUsuarioAuth(user);
    const validacao = validarStatusDoUsuario(dbUser);

    if (!validacao.ok) {
      if (validacao.expiredTrial) {
        dbUser = await atualizarUsuarioPorAuthUserId(user.id, {
          status: "blocked"
        });
      }

      return res.status(validacao.statusCode).json({
        erro: validacao.erro
      });
    }

    const deviceId = (req.headers[DEVICE_ID_HEADER] || "").trim();
    const deviceName = (req.headers[DEVICE_NAME_HEADER] || "").trim();

    const validacaoDevice = await validarLimiteDispositivos(
      dbUser,
      deviceId,
      deviceName
    );

    if (!validacaoDevice.ok) {
      return res.status(validacaoDevice.statusCode).json({
        erro: validacaoDevice.erro
      });
    }

    req.authUser = user;
    req.dbUser = mapearUsuarioDoBanco(dbUser);
    req.device = mapearDevice(validacaoDevice.dispositivo);
    req.deviceLimit = validacaoDevice.limite;
    next();
  } catch (error) {
    console.error("Erro em verificarAuth:", error);
    return res.status(500).json({
      erro: "Erro interno ao validar autenticação."
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

app.get("/", (req, res) => {
  res.json({
    ok: true,
    mensagem: "TalkGlobal backend online."
  });
});

app.get("/debug/env", (req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL,
    supabaseUrlLength: SUPABASE_URL.length,
    supabaseServiceRoleConfigured: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    stripeConfigured: Boolean(STRIPE_SECRET_KEY),
    webhookConfigured: Boolean(STRIPE_WEBHOOK_SECRET)
  });
});

app.get("/debug/supabase", async (req, res) => {
  try {
    const { data, error } = await supabase.from("users").select("*").limit(3);

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
      total: Array.isArray(data) ? data.length : 0,
      rows: data || []
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      tipo: "catch",
      erro: error.message
    });
  }
});

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
        plan: usuarioExistente.plan || "free",
        trialEndsAt: usuarioExistente.trial_ends_at,
        stripeCustomerId: usuarioExistente.stripe_customer_id,
        stripeSubscriptionId: usuarioExistente.stripe_subscription_id
      });
    }

    const usuario = await criarUsuarioLegacy({ email: emailLimpo });

    return res.json({
      accessKey: usuario.access_key,
      email: usuario.email,
      status: usuario.status,
      plan: usuario.plan || "free",
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

app.post("/auth/sync", verificarAuth, async (req, res) => {
  try {
    const usuario = await buscarUsuarioPorAuthUserId(req.authUser.id);

    return res.json({
      ok: true,
      usuario: mapearUsuarioDoBanco(usuario),
      dispositivo: req.device,
      limiteDispositivos: req.deviceLimit
    });
  } catch (error) {
    console.error("Erro em /auth/sync:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao sincronizar usuário."
    });
  }
});

app.get("/auth/devices", verificarAuth, async (req, res) => {
  try {
    const dispositivos = await listarDispositivosAtivos(req.authUser.id);

    return res.json({
      ok: true,
      limite: req.deviceLimit,
      dispositivos: dispositivos.map(mapearDevice)
    });
  } catch (error) {
    console.error("Erro em /auth/devices:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao listar dispositivos."
    });
  }
});

app.delete("/auth/devices/:deviceId", verificarAuth, async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId || "").trim();

    if (!deviceId) {
      return res.status(400).json({
        erro: "deviceId obrigatório."
      });
    }

    const { error } = await supabase
      .from("user_devices")
      .delete()
      .eq("auth_user_id", req.authUser.id)
      .eq("device_id", deviceId);

    if (error) {
      return res.status(500).json({
        erro: error.message || "Erro ao remover dispositivo."
      });
    }

    return res.json({
      ok: true
    });
  } catch (error) {
    console.error("Erro em /auth/devices/:deviceId:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao remover dispositivo."
    });
  }
});

app.get("/meu-status", async (req, res) => {
  const authHeader = req.headers.authorization || "";

  if (authHeader.startsWith("Bearer ")) {
    return verificarAuth(req, res, async () => {
      try {
        const usuario = await buscarUsuarioPorAuthUserId(req.authUser.id);

        return res.json({
          ok: true,
          usuario: mapearUsuarioDoBanco(usuario),
          dispositivo: req.device,
          limiteDispositivos: req.deviceLimit
        });
      } catch (error) {
        console.error("Erro em /meu-status (auth):", error);
        return res.status(500).json({
          erro: error.message || "Erro ao consultar status."
        });
      }
    });
  }

  return verificarAcessoLegacy(req, res, async () => {
    try {
      const usuario = await buscarUsuarioPorAccessKey(req.tgUser.key);

      return res.json({
        ok: true,
        usuario: mapearUsuarioDoBanco(usuario)
      });
    } catch (error) {
      console.error("Erro em /meu-status (legacy):", error);
      return res.status(500).json({
        erro: error.message || "Erro ao consultar status."
      });
    }
  });
});

app.post("/create-checkout-session-auth", verificarAuth, async (req, res) => {
  try {
    if (!garantirStripeConfig(res)) return;

    const { plan } = req.body || {};

    if (!plan || typeof plan !== "string") {
      return res.status(400).json({
        erro: "Plano obrigatório."
      });
    }

    const selectedPlan = getPlan(plan);
    const dbUser = await buscarUsuarioPorAuthUserId(req.authUser.id);

    if (!dbUser) {
      return res.status(404).json({
        erro: "Usuário não encontrado."
      });
    }

    let customerId = dbUser.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.authUser.email,
        metadata: {
          authUserId: req.authUser.id
        }
      });

      customerId = customer.id;

      await atualizarUsuarioPorAuthUserId(req.authUser.id, {
        stripe_customer_id: customerId
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: selectedPlan.priceId,
          quantity: 1
        }
      ],
      success_url: `${CLIENT_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: CLIENT_CANCEL_URL,
      subscription_data: {
        metadata: {
          authUserId: req.authUser.id,
          plan: selectedPlan.key
        }
      },
      metadata: {
        authUserId: req.authUser.id,
        plan: selectedPlan.key
      }
    });

    return res.json({
      checkoutUrl: session.url
    });
  } catch (error) {
    console.error("Erro em /create-checkout-session-auth:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao criar checkout session."
    });
  }
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    if (!garantirStripeConfig(res)) return;

    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
      return verificarAuth(req, res, async () => {
        try {
          const { plan } = req.body || {};

          if (!plan || typeof plan !== "string") {
            return res.status(400).json({
              erro: "Plano obrigatório."
            });
          }

          const selectedPlan = getPlan(plan);
          const dbUser = await buscarUsuarioPorAuthUserId(req.authUser.id);

          if (!dbUser) {
            return res.status(404).json({
              erro: "Usuário não encontrado."
            });
          }

          let customerId = dbUser.stripe_customer_id;

          if (!customerId) {
            const customer = await stripe.customers.create({
              email: req.authUser.email,
              metadata: {
                authUserId: req.authUser.id
              }
            });

            customerId = customer.id;

            await atualizarUsuarioPorAuthUserId(req.authUser.id, {
              stripe_customer_id: customerId
            });
          }

          const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            customer: customerId,
            line_items: [
              {
                price: selectedPlan.priceId,
                quantity: 1
              }
            ],
            success_url: `${CLIENT_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: CLIENT_CANCEL_URL,
            subscription_data: {
              metadata: {
                authUserId: req.authUser.id,
                plan: selectedPlan.key
              }
            },
            metadata: {
              authUserId: req.authUser.id,
              plan: selectedPlan.key
            }
          });

          return res.json({
            checkoutUrl: session.url
          });
        } catch (error) {
          console.error("Erro em /create-checkout-session (auth):", error);
          return res.status(500).json({
            erro: error.message || "Erro ao criar checkout session."
          });
        }
      });
    }

    const { accessKey, plan } = req.body || {};

    if (!accessKey || typeof accessKey !== "string") {
      return res.status(400).json({
        erro: "accessKey obrigatória."
      });
    }

    if (!plan || typeof plan !== "string") {
      return res.status(400).json({
        erro: "Plano obrigatório."
      });
    }

    const selectedPlan = getPlan(plan);
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
          price: selectedPlan.priceId,
          quantity: 1
        }
      ],
      success_url: `${CLIENT_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: CLIENT_CANCEL_URL,
      subscription_data: {
        metadata: {
          accessKey,
          plan: selectedPlan.key
        }
      },
      metadata: {
        accessKey,
        plan: selectedPlan.key
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

app.post("/traduzir", async (req, res) => {
  const authHeader = req.headers.authorization || "";

  const executar = async () => {
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
  };

  if (authHeader.startsWith("Bearer ")) {
    return verificarAuth(req, res, executar);
  }

  return verificarAcessoLegacy(req, res, executar);
});

app.post("/converter", async (req, res) => {
  const authHeader = req.headers.authorization || "";

  const executar = async () => {
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
  };

  if (authHeader.startsWith("Bearer ")) {
    return verificarAuth(req, res, executar);
  }

  return verificarAcessoLegacy(req, res, executar);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
