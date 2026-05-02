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
  DEVICE_ACTIVE_DAYS
} = require("./lib/env");

const {
  HOTMART_PRODUCT_ID,
  getHotmartCheckoutUrl,
  getPlanoPorHotmart,
  validarTokenHotmart
} = require("./lib/hotmart");

const app = express();

const FREE_TRANSLATE_LIMIT = 20;
const FREE_CONVERT_LIMIT = 20;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const SUPPORTED_LANGUAGES = {
  "pt-BR": "Portuguese (Brazil)",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  nl: "Dutch",
  ru: "Russian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  hi: "Hindi",
  tr: "Turkish",
  pl: "Polish",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  he: "Hebrew",
  id: "Indonesian",
  vi: "Vietnamese",
  th: "Thai",
  uk: "Ukrainian"
};

function gerarAccessKey() {
  return `tg_${crypto.randomBytes(16).toString("hex")}`;
}

function normalizarEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function obterIdiomaDestino(valor, fallback = "pt-BR") {
  const codigo = String(valor || fallback).trim();
  return SUPPORTED_LANGUAGES[codigo]
    ? { code: codigo, name: SUPPORTED_LANGUAGES[codigo] }
    : { code: fallback, name: SUPPORTED_LANGUAGES[fallback] };
}

function getDeviceLimitForPlan(plan) {
  const plano = String(plan || "").toLowerCase();

  if (plano === "pro") return 3;
  if (plano === "basic") return 1;
  if (plano === "free") return 1;

  return 1;
}

function getDeviceCutoffIso() {
  const dias = Number(DEVICE_ACTIVE_DAYS || 30);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - dias);
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
    translateUsageCount: Number(user.translate_usage_count || 0),
    translateUsageLimit:
      user.translate_usage_limit === null
        ? null
        : Number(user.translate_usage_limit || 0),
    convertUsageCount: Number(user.convert_usage_count || 0),
    convertUsageLimit:
      user.convert_usage_limit === null
        ? null
        : Number(user.convert_usage_limit || 0),
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

async function atualizarUsuarioPorId(userId, campos) {
  const { data, error } = await supabase
    .from("users")
    .update({
      ...campos,
      updated_at: new Date().toISOString()
    })
    .eq("id", userId)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao atualizar usuário por id: ${error.message}`);
  }

  return data;
}

async function criarUsuarioFree({ email, authUserId = null }) {
  const agora = new Date().toISOString();

  const payload = {
    access_key: gerarAccessKey(),
    auth_user_id: authUserId,
    email: email || null,
    status: "free",
    plan: "free",
    translate_usage_count: 0,
    translate_usage_limit: FREE_TRANSLATE_LIMIT,
    convert_usage_count: 0,
    convert_usage_limit: FREE_CONVERT_LIMIT,
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
    throw new Error(`Erro ao criar usuário free: ${error.message}`);
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
    const campos = {};

    if (usuario.email !== emailLimpo) {
      campos.email = emailLimpo;
    }

    if (!usuario.status) {
      campos.status = "free";
    }

    if (!usuario.plan) {
      campos.plan = "free";
    }

    if (usuario.translate_usage_limit === null && usuario.plan !== "basic" && usuario.plan !== "pro") {
      campos.translate_usage_limit = FREE_TRANSLATE_LIMIT;
    }

    if (usuario.convert_usage_limit === null && usuario.plan !== "basic" && usuario.plan !== "pro") {
      campos.convert_usage_limit = FREE_CONVERT_LIMIT;
    }

    if (usuario.translate_usage_count === null || usuario.translate_usage_count === undefined) {
      campos.translate_usage_count = 0;
    }

    if (usuario.convert_usage_count === null || usuario.convert_usage_count === undefined) {
      campos.convert_usage_count = 0;
    }

    if (Object.keys(campos).length > 0) {
      usuario = await atualizarUsuarioPorAuthUserId(authUser.id, campos);
    }

    return usuario;
  }

  const usuarioPorEmail = await buscarUsuarioPorEmail(emailLimpo);

  if (usuarioPorEmail) {
    const campos = {
      auth_user_id: authUser.id,
      email: emailLimpo
    };

    if (!usuarioPorEmail.status) {
      campos.status = "free";
    }

    if (!usuarioPorEmail.plan) {
      campos.plan = "free";
    }

    if (usuarioPorEmail.translate_usage_limit === null && usuarioPorEmail.plan !== "basic" && usuarioPorEmail.plan !== "pro") {
      campos.translate_usage_limit = FREE_TRANSLATE_LIMIT;
    }

    if (usuarioPorEmail.convert_usage_limit === null && usuarioPorEmail.plan !== "basic" && usuarioPorEmail.plan !== "pro") {
      campos.convert_usage_limit = FREE_CONVERT_LIMIT;
    }

    if (usuarioPorEmail.translate_usage_count === null || usuarioPorEmail.translate_usage_count === undefined) {
      campos.translate_usage_count = 0;
    }

    if (usuarioPorEmail.convert_usage_count === null || usuarioPorEmail.convert_usage_count === undefined) {
      campos.convert_usage_count = 0;
    }

    const atualizado = await supabase
      .from("users")
      .update({
        ...campos,
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

  return criarUsuarioFree({
    email: emailLimpo,
    authUserId: authUser.id
  });
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
      erro: "Seu acesso está bloqueado."
    };
  }

  if (user.status !== "active" && user.status !== "free") {
    return {
      ok: false,
      statusCode: 403,
      erro: "Seu acesso não está liberado."
    };
  }

  return { ok: true };
}

function validarLimiteDeUso(user, tipo) {
  if (!user) {
    return {
      ok: false,
      statusCode: 403,
      erro: "Acesso não autorizado."
    };
  }

  const plano = String(user.plan || "").toLowerCase();

  if (plano === "basic" || plano === "pro") {
    return { ok: true };
  }

  if (tipo === "traduzir") {
    const usageCount = Number(user.translate_usage_count || 0);
    const usageLimit =
      user.translate_usage_limit === null
        ? FREE_TRANSLATE_LIMIT
        : Number(user.translate_usage_limit || 0);

    if (usageCount >= usageLimit) {
      return {
        ok: false,
        statusCode: 403,
        erro: "Você atingiu o limite gratuito de 20 traduções. Assine um plano para continuar.",
        upgradeRequired: true,
        usageCount,
        usageLimit
      };
    }

    return {
      ok: true,
      usageCount,
      usageLimit
    };
  }

  if (tipo === "converter") {
    const usageCount = Number(user.convert_usage_count || 0);
    const usageLimit =
      user.convert_usage_limit === null
        ? FREE_CONVERT_LIMIT
        : Number(user.convert_usage_limit || 0);

    if (usageCount >= usageLimit) {
      return {
        ok: false,
        statusCode: 403,
        erro: "Você atingiu o limite gratuito de 20 conversões. Assine um plano para continuar.",
        upgradeRequired: true,
        usageCount,
        usageLimit
      };
    }

    return {
      ok: true,
      usageCount,
      usageLimit
    };
  }

  return { ok: true };
}

async function consumirUsoSeNecessario(user, tipo) {
  if (!user) return user;

  const plano = String(user.plan || "").toLowerCase();

  if (plano === "basic" || plano === "pro") {
    return user;
  }

  if (tipo === "traduzir") {
    return atualizarUsuarioPorId(user.id, {
      translate_usage_count: Number(user.translate_usage_count || 0) + 1
    });
  }

  if (tipo === "converter") {
    return atualizarUsuarioPorId(user.id, {
      convert_usage_count: Number(user.convert_usage_count || 0) + 1
    });
  }

  return user;
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

    const dbUser = await criarOuVincularUsuarioAuth(user);
    const validacao = validarStatusDoUsuario(dbUser);

    if (!validacao.ok) {
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

function obterUsuarioAtualDaRequest(req) {
  return req.dbUser || req.tgUser || null;
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
  return String(
    body?.data?.buyer?.email ||
    body?.data?.purchase?.buyer?.email ||
    body?.data?.user?.email ||
    body?.data?.subscriber?.email ||
    body?.data?.subscription?.subscriber?.email ||
    body?.data?.contact?.email ||
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

function eventoVoltaParaFree(evento) {
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
    const campos = {
      email,
      status: "active",
      plan: plan || "basic",
      translate_usage_limit: null,
      convert_usage_limit: null,
      trial_ends_at: null
    };

    if (user.auth_user_id) {
      return atualizarUsuarioPorAuthUserId(user.auth_user_id, campos);
    }

    return atualizarUsuarioPorAccessKey(user.access_key, campos);
  }

  const agora = new Date().toISOString();

  const payload = {
    access_key: gerarAccessKey(),
    auth_user_id: null,
    email,
    status: "active",
    plan: plan || "basic",
    translate_usage_count: 0,
    translate_usage_limit: null,
    convert_usage_count: 0,
    convert_usage_limit: null,
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

async function voltarUsuarioParaFree(email) {
  const user = await buscarUsuarioPorEmail(email);

  if (!user) {
    return null;
  }

  const campos = {
    status: "free",
    plan: "free",
    translate_usage_limit: FREE_TRANSLATE_LIMIT,
    convert_usage_limit: FREE_CONVERT_LIMIT,
    trial_ends_at: null
  };

  if (user.auth_user_id) {
    return atualizarUsuarioPorAuthUserId(user.auth_user_id, campos);
  }

  return atualizarUsuarioPorAccessKey(user.access_key, campos);
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    mensagem: "TalkGlobal backend online."
  });
});

app.get("/debug/env", (req, res) => {
  res.json({
    supabase: Boolean(SUPABASE_URL),
    supabaseServiceRoleConfigured: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    hotmartProduct: Boolean(process.env.HOTMART_PRODUCT_ID),
    hotmartToken: Boolean(process.env.HOTMART_WEBHOOK_TOKEN),
    hotmartBasicUrl: Boolean(process.env.HOTMART_BASIC_CHECKOUT_URL),
    hotmartProUrl: Boolean(process.env.HOTMART_PRO_CHECKOUT_URL),
    freeTranslateLimit: FREE_TRANSLATE_LIMIT,
    freeConvertLimit: FREE_CONVERT_LIMIT,
    openai: Boolean(OPENAI_API_KEY)
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
        user: mapearUsuarioDoBanco(user)
      });
    }

    if (eventoVoltaParaFree(evento)) {
      const user = await voltarUsuarioParaFree(email);
      return res.json({
        ok: true,
        acao: "voltou_para_free",
        evento,
        user: mapearUsuarioDoBanco(user)
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

app.post("/criar-usuario", async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        erro: "Email obrigatório."
      });
    }

    const emailLimpo = email.trim().toLowerCase();
    let usuario = await buscarUsuarioPorEmail(emailLimpo);

    if (!usuario) {
      usuario = await criarUsuarioFree({ email: emailLimpo });
    } else {
      const campos = {};

      if (!usuario.status) {
        campos.status = "free";
      }

      if (!usuario.plan) {
        campos.plan = "free";
      }

      if (usuario.translate_usage_limit === null && usuario.plan !== "basic" && usuario.plan !== "pro") {
        campos.translate_usage_limit = FREE_TRANSLATE_LIMIT;
      }

      if (usuario.convert_usage_limit === null && usuario.plan !== "basic" && usuario.plan !== "pro") {
        campos.convert_usage_limit = FREE_CONVERT_LIMIT;
      }

      if (usuario.translate_usage_count === null || usuario.translate_usage_count === undefined) {
        campos.translate_usage_count = 0;
      }

      if (usuario.convert_usage_count === null || usuario.convert_usage_count === undefined) {
        campos.convert_usage_count = 0;
      }

      if (Object.keys(campos).length > 0) {
        if (usuario.auth_user_id) {
          usuario = await atualizarUsuarioPorAuthUserId(usuario.auth_user_id, campos);
        } else {
          usuario = await atualizarUsuarioPorAccessKey(usuario.access_key, campos);
        }
      }
    }

    return res.json({
      ok: true,
      usuario: mapearUsuarioDoBanco(usuario)
    });
  } catch (error) {
    console.error("Erro em /criar-usuario:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao criar usuário."
    });
  }
});

app.post("/auth/request-otp", async (req, res) => {
  try {
    const email = normalizarEmail(req.body?.email);

    if (!validarEmail(email)) {
      return res.status(400).json({
        erro: "Email inválido."
      });
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true
      }
    });

    if (error) {
      return res.status(400).json({
        erro: error.message || "Erro ao enviar código por e-mail."
      });
    }

    return res.json({
      ok: true
    });
  } catch (error) {
    console.error("Erro em /auth/request-otp:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao enviar código por e-mail."
    });
  }
});

app.post("/auth/verify-otp", async (req, res) => {
  try {
    const email = normalizarEmail(req.body?.email);
    const token = String(req.body?.token || "").trim();

    if (!validarEmail(email)) {
      return res.status(400).json({
        erro: "Email inválido."
      });
    }

    if (!/^\d{6,8}$/.test(token)) {
      return res.status(400).json({
        erro: "Código inválido."
      });
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email"
    });

    if (error || !data?.session || !data?.user) {
      return res.status(401).json({
        erro: error?.message || "Código inválido."
      });
    }

    const dbUser = await criarOuVincularUsuarioAuth(data.user);
    const validacao = validarStatusDoUsuario(dbUser);

    if (!validacao.ok) {
      return res.status(validacao.statusCode).json({
        erro: validacao.erro
      });
    }

    const deviceId = String(req.headers[DEVICE_ID_HEADER] || "").trim();
    const deviceName = String(req.headers[DEVICE_NAME_HEADER] || "").trim();

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

    return res.json({
      ok: true,
      session: data.session,
      usuario: mapearUsuarioDoBanco(dbUser),
      dispositivo: mapearDevice(validacaoDevice.dispositivo),
      limiteDispositivos: validacaoDevice.limite
    });
  } catch (error) {
    console.error("Erro em /auth/verify-otp:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao confirmar código."
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

      const usuarioAtual = obterUsuarioAtualDaRequest(req);
      const usuarioBanco = usuarioAtual?.authUserId
        ? await buscarUsuarioPorAuthUserId(usuarioAtual.authUserId)
        : await buscarUsuarioPorAccessKey(usuarioAtual?.key || "");

      const validacaoUso = validarLimiteDeUso(usuarioBanco, "traduzir");

      if (!validacaoUso.ok) {
        return res.status(validacaoUso.statusCode).json({
          erro: validacaoUso.erro,
          upgradeRequired: true,
          translateUsageCount: Number(usuarioBanco?.translate_usage_count || 0),
          translateUsageLimit:
            usuarioBanco?.translate_usage_limit === null
              ? null
              : Number(usuarioBanco?.translate_usage_limit || 0),
          convertUsageCount: Number(usuarioBanco?.convert_usage_count || 0),
          convertUsageLimit:
            usuarioBanco?.convert_usage_limit === null
              ? null
              : Number(usuarioBanco?.convert_usage_limit || 0)
        });
      }

      const { texto, targetLanguage } = req.body || {};
      const idiomaDestino = obterIdiomaDestino(targetLanguage, "pt-BR");

      if (!texto || typeof texto !== "string" || !texto.trim()) {
        return res.status(400).json({
          erro: "Texto inválido para tradução."
        });
      }

      const systemPrompt = `
Você é um tradutor profissional.
Traduza a mensagem para ${idiomaDestino.name} de forma natural, clara e fiel.
Se vierem várias mensagens seguidas, mantenha a ordem.
Não explique.
Não adicione observações.
Entregue só a tradução final.
`.trim();

      const resultado = await chamarOpenAI(systemPrompt, texto.trim());
      const usuarioAtualizado = await consumirUsoSeNecessario(usuarioBanco, "traduzir");

      return res.json({
        resultado,
        usuario: mapearUsuarioDoBanco(usuarioAtualizado)
      });
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

      const usuarioAtual = obterUsuarioAtualDaRequest(req);
      const usuarioBanco = usuarioAtual?.authUserId
        ? await buscarUsuarioPorAuthUserId(usuarioAtual.authUserId)
        : await buscarUsuarioPorAccessKey(usuarioAtual?.key || "");

      const validacaoUso = validarLimiteDeUso(usuarioBanco, "converter");

      if (!validacaoUso.ok) {
        return res.status(validacaoUso.statusCode).json({
          erro: validacaoUso.erro,
          upgradeRequired: true,
          translateUsageCount: Number(usuarioBanco?.translate_usage_count || 0),
          translateUsageLimit:
            usuarioBanco?.translate_usage_limit === null
              ? null
              : Number(usuarioBanco?.translate_usage_limit || 0),
          convertUsageCount: Number(usuarioBanco?.convert_usage_count || 0),
          convertUsageLimit:
            usuarioBanco?.convert_usage_limit === null
              ? null
              : Number(usuarioBanco?.convert_usage_limit || 0)
        });
      }

      const { texto, contexto, targetLanguage } = req.body || {};
      const idiomaDestino = obterIdiomaDestino(targetLanguage, "en");

      if (!texto || typeof texto !== "string" || !texto.trim()) {
        return res.status(400).json({
          erro: "Texto inválido para conversão."
        });
      }

      const systemPrompt = `
Você é um assistente que transforma respostas em ${idiomaDestino.name}
natural, curto, claro e profissional para conversa no WhatsApp.
Regras:
- Entregue apenas a versão final em ${idiomaDestino.name}.
- Não explique.
- Não use aspas.
- Soe natural, como alguém fluente conversando.
- Considere o contexto da conversa, se ele existir.
`.trim();

      const userPrompt = `
CONTEXTO DA CONVERSA:
${contexto || "(sem contexto)"}

RESPOSTA DO USUÁRIO:
${texto.trim()}
`.trim();

      const resultado = await chamarOpenAI(systemPrompt, userPrompt);
      const usuarioAtualizado = await consumirUsoSeNecessario(usuarioBanco, "converter");

      return res.json({
        resultado,
        usuario: mapearUsuarioDoBanco(usuarioAtualizado)
      });
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
