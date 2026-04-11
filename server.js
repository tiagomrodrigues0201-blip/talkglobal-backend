const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const ACCESS_USERS = {
  tg_test_trial: {
    status: "trial",
    trialEndsAt: "2030-01-01T23:59:59.000Z",
    email: "teste_trial@talkglobal.com"
  },

  tg_test_active: {
    status: "active",
    trialEndsAt: null,
    email: "teste_active@talkglobal.com"
  },

  tg_test_blocked: {
    status: "blocked",
    trialEndsAt: null,
    email: "teste_blocked@talkglobal.com"
  }
};

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function verificarAcesso(req, res, next) {
  const userKey = req.headers["x-talkglobal-key"];

  if (!userKey) {
    return res.status(401).json({
      erro: "Chave de acesso não enviada."
    });
  }

  const user = ACCESS_USERS[userKey];

  if (!user) {
    return res.status(403).json({
      erro: "TESTE_RENDER_123"
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
    status: user.status
  };

  next();
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
