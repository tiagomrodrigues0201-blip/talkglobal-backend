const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/traduzir", async (req, res) => {
  try {
    const { texto } = req.body;

    if (!texto || !texto.trim()) {
      return res.status(400).json({ erro: "Texto vazio." });
    }

    const resposta = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Traduza a mensagem para português brasileiro de forma clara e natural. Responda apenas com a tradução."
        },
        {
          role: "user",
          content: texto
        }
      ],
      temperature: 0.2
    });

    res.json({ resultado: resposta.choices[0].message.content.trim() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao traduzir." });
  }
});

app.post("/converter", async (req, res) => {
  try {
    const { texto, contexto } = req.body;

    if (!texto || !texto.trim()) {
      return res.status(400).json({ erro: "Texto vazio." });
    }

    const resposta = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Você transforma respostas em português em inglês natural, curto, profissional e humano. Use o contexto. Responda apenas com a mensagem final em inglês."
        },
        {
          role: "user",
          content: `Contexto da conversa:\n${contexto || ""}\n\nResposta em português:\n${texto}`
        }
      ],
      temperature: 0.4
    });

    res.json({ resultado: resposta.choices[0].message.content.trim() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao converter." });
  }
});

app.listen(port, () => {
  console.log(`Servidor PRODUÇÃO rodando em http://localhost:${port}`);
});