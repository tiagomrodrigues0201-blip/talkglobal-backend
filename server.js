const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("SUPABASE_URL ou SUPABASE_KEY não configuradas.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function gerarAccessKey() {
  return `tg_${crypto.randomBytes(16).toString("hex")}`;
}

function somarDias(data, dias) {
  const novaData = new Date(data);
  novaData.setDate(novaData.getDate() + dias);
  return novaData;
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
    throw new Error(`Erro ao buscar usuário: ${error.message}`);
  }

  return data;
}

async function criarUsuario({ email }) {
  const accessKey = gerarAccessKey();
  const agora = new Date();
  const trialEndsAt = somarDias(agora, 3);

  const payload = {
    access_key: accessKey,
    email: email || null,
    status: "trial",
    trial_ends_at: trialEndsAt.toISOString(),
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

async function atualizarUsuarioPorAccessKey(accessKey, campos) {
  const payload = {
    ...campos,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("users")
    .update(payload)
    .eq("access_key", accessKey)
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao atualizar usuário: ${error.message}`);
  }

  return data;
}

async function verificarAcesso(req, res, next) {
  try {
    const userKey = req.headers["x-talkglobal-key"];

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

function garantirOpenAIKey(res) {
  if (!OPENAI_API_KEY) {
    res.status(500).json({
      erro: "OPENAI_API_KEY não configurada no servidor."
    });
    return false;
  }
  return true;
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
  res.send("TalkGlobal backend online.");
});

app.post("/criar-usuario", async (req, res) => {
  try {
    const { email } = req.body || {};

    const usuario = await criarUsuario({
      email: typeof email === "string" ? email.trim() : null
    });

    return res.status(201).json({
      ok: true,
      accessKey: usuario.access_key,
      usuario: mapearUsuarioDoBanco(usuario)
    });
  } catch (error) {
    console.error("Erro em /criar-usuario:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao criar usuário."
    });
  }
});

app.get("/meu-status", verificarAcesso, async (req, res) => {
  try {
    const usuario = await buscarUsuarioPorAccessKey(req.tgUser.key);

    return res.json({
      ok: true,
      usuario: mapearUsuarioDoBanco(usuario)
    });
  } catch (error) {
    console.error("Erro em /meu-status:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao consultar status."
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

/*
  ROTAS OPCIONAIS DE TESTE
  Pode manter por enquanto para testar manualmente.
*/

app.post("/admin/set-status", async (req, res) => {
  try {
    const { accessKey, status } = req.body || {};

    if (!accessKey || !status) {
      return res.status(400).json({
        erro: "accessKey e status são obrigatórios."
      });
    }

    if (!["trial", "active", "blocked"].includes(status)) {
      return res.status(400).json({
        erro: "Status inválido."
      });
    }

    const usuario = await atualizarUsuarioPorAccessKey(accessKey, { status });

    return res.json({
      ok: true,
      usuario: mapearUsuarioDoBanco(usuario)
    });
  } catch (error) {
    console.error("Erro em /admin/set-status:", error);
    return res.status(500).json({
      erro: error.message || "Erro ao atualizar status."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});