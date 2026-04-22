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

function gerarAccessKey() {
  return `tg_${crypto.randomBytes(16).toString("hex")}`;
}

function adicionarDias(data, dias) {
  const novaData = new Date(data);
  novaData.setDate(novaData.getDate() + dias);
  return novaData;
}

function getDeviceLimitForPlan(plan) {
  const plano = String(plan || "").toLowerCase();
  if (plano === "pro") return 3;
  if (plano === "basic") return 1;
  if (plano === "trial") return 1;
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

function mapearUsuarioDoBanco(user) {
  if (!user) return null;

  return {
    id: user.id,
    authUserId: user.auth_user_id || null,
    key: user.access_key || null,
    email: user.email,
    status: user.status,
    plan: user.plan || null,
    trialEndsAt: user.trial_ends_at,
    stripeCustomerId: user.stripe_customer_id || null,
    stripeSubscriptionId: user.stripe_subscription_id || null,
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

async function criarUsuarioLegacy({ email }) {
  const agora = new Date();

  const payload = {
    access_key: gerarAccessKey(),
    auth_user_id: null,
    email: email || null,
    status: "trial",
    plan: "trial",
    trial_ends_at: adicionarDias(agora, TRIAL_DAYS).toISOString(),
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
    plan: "trial",
    trial_ends_at: adicionarDias(agora, TRIAL_DAYS).toISOString(),
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
      erro: "Seu período de teste terminou. Escolha um plano para continuar."
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
        erro: "Seu período de teste terminou. Escolha um plano para continuar.",
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
          status: "blocked",
          plan: null
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
  const limite = getDeviceLimitForPlan(user.plan);
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
      limite
    };
  }

  const dispositivosAtivos = await listarDispositivosAtivos(user.auth_user_id);

  if (dispositivosAtivos.length >= limite) {
    const removerQtd = (dispositivosAtivos.length - limite) + 1;

    const antigos = dispositivosAtivos
      .slice()
      .sort((a, b) => new Date(a.last_seen_at) - new Date(b.last_seen_at))
      .slice(0, removerQtd);

    const idsParaRemover = antigos.map((d) => d.id);

    const { error: deleteError } = await supabase
      .from("user_devices")
      .delete()
      .in("id", idsParaRemover);

    if (deleteError) {
      throw new Error(`Erro ao remover dispositivo antigo: ${deleteError.message}`);
    }
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
          status: "blocked",
          plan: null
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

function extrairEmailHotmart(body = {}) {
  const email = String(
    body?.data?.buyer?.email ||
    body?.data?.purchase?.buyer?.email ||
    body?.buyer?.email ||
    body?.buyer_email ||
    body?.email ||
    ""
  ).trim().toLowerCase();

  return email || null;
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
  return String(
    body?.data?.product?.id ||
    body?.data?.purchase?.product?.id ||
    body?.product?.id ||
    body?.product_id ||
    ""
  ).trim();
}

function eventoLiberaAcessoHotmart(evento) {
  const e = String(evento || "").toUpperCase();

  return [
    "PURCHASE_APPROVED",
    "PURCHASE_COMPLETE",
    "PURCHASE_CANCELED_REVERSED",
    "SUBSCRIPTION_PURCHASE_APPROVED",
    "SUBSCRIPTION_REACTIVATED",
    "SUBSCRIPTION_RENEWED",
    "BILLET_PRINTED"
  ].includes(e);
}

function eventoBloqueiaAcessoHotmart(evento) {
  const e = String(evento || "").toUpperCase();

  return [
    "PURCHASE_REFUNDED",
    "PURCHASE_CHARGEBACK",
    "PURCHASE_CANCELED",
    "SUBSCRIPTION_CANCELLATION",
    "SUBSCRIPTION_CANCELED",
    "SUBSCRIPTION_EXPIRED",
    "SUBSCRIPTION_DELAYED"
  ].includes(e);
}

async function ativarUsuarioPorEmailHotmart(email, plan) {
  const emailLimpo = String(email || "").trim().toLowerCase();

  if (!emailLimpo) {
    throw new Error("Email do comprador não encontrado.");
  }

  const usuario = await buscarUsuarioPorEmail(emailLimpo);

  if (usuario) {
    return atualizarUsuarioPorAccessKey(usuario.access_key, {
      email: emailLimpo,
      status: "active",
      plan: plan || "basic",
      trial_ends_at: null
    });
  }

  const agora = new Date().toISOString();

  const payload = {
    access_key: gerarAccessKey(),
    auth_user_id: null,
    email: emailLimpo,
    status: "active",
    plan: plan || "basic",
    trial_ends_at: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
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

async function bloquearUsuarioPorEmailHotmart(email) {
  const emailLimpo = String(email || "").trim().toLowerCase();
  if (!emailLimpo) return null;

  const usuario = await buscarUsuarioPorEmail(emailLimpo);
  if (!usuario) return null;

  return atualizarUsuarioPorAccessKey(usuario.access_key, {
    status: "blocked",
    plan: null,
    trial_ends_at: null
  });
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
    hotmartBasicConfigured: Boolean(process.env.HOTMART_BASIC_CHECKOUT_URL),
    hotmartProConfigured: Boolean(process.env.HOTMART_PRO_CHECKOUT_URL),
    hotmartConfigured:
      Boolean(process.env.HOTMART_BASIC_CHECKOUT_URL) &&
      Boolean(process.env.HOTMART_PRO_CHECKOUT_URL),
    hotmartProductConfigured: Boolean(process.env.HOTMART_PRODUCT_ID),
    openaiConfigured: Boolean(OPENAI_API_KEY)
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

app.post("/hotmart/webhook", async (req, res) => {
  try {
    const tokenOk = validarTokenHotmart(req);

    if (!tokenOk) {
      return res.status(401).json({
        erro: "Token do webhook Hotmart inválido."
      });
    }

    const evento = extrairEventoHotmart(req.body);
    const email = extrairEmailHotmart(req.body);
    const plan = getPlanoPorHotmart(req.body) || "basic";
    const produtoId = extrairProdutoHotmart(req.body);

    if (
      HOTMART_PRODUCT_ID &&
      produtoId &&
      String(produtoId) !== String(HOTMART_PRODUCT_ID)
    ) {
      return res.json({
        ok: true,
        ignorado: true,
        motivo: "Produto diferente."
      });
    }

    if (!email) {
      return res.status(400).json({
        erro: "Email do comprador não encontrado no webhook."
      });
    }

    if (eventoLiberaAcessoHotmart(evento)) {
      const usuario = await ativarUsuarioPorEmailHotmart(email, plan);

      return res.json({
        ok: true,
        acao: "ativado",
        evento,
        usuario: mapearUsuarioDoBanco(usuario)
      });
    }

    if (eventoBloqueiaAcessoHotmart(evento)) {
      const usuario = await bloquearUsuarioPorEmailHotmart(email);

      return res.json({
        ok: true,
        acao: "bloqueado",
        evento,
        usuario: mapearUsuarioDoBanco(usuario)
      });
    }

    return res.json({
      ok: true,
      ignorado: true,
      evento
    });
  } catch (error) {
    console.error("Erro em /hotmart/webhook:", error);
    return res.status(500).json({
      erro: error.message || "Erro no webhook da Hotmart."
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
        plan: usuarioExistente.plan || null,
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
      plan: usuario.plan || null,
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
    const { plan } = req.body || {};

    if (!plan || typeof plan !== "string") {
      return res.status(400).json({
        erro: "Plano obrigatório."
      });
    }

    const checkoutUrl = getHotmartCheckoutUrl(plan);

    return res.json({
      checkoutUrl
    });
  } catch (error) {
    console.error("Erro em /create-checkout-session-auth:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao abrir checkout Hotmart."
    });
  }
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { plan } = req.body || {};

    if (!plan || typeof plan !== "string") {
      return res.status(400).json({
        erro: "Plano obrigatório."
      });
    }

    const checkoutUrl = getHotmartCheckoutUrl(plan);

    return res.json({
      checkoutUrl
    });
  } catch (error) {
    console.error("Erro em /create-checkout-session:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao abrir checkout Hotmart."
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
