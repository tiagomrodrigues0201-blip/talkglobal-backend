const RARITIES = {
  comum: {
    id: "comum",
    label: "Comum",
    weight: 1,
    statRange: { min: 34, max: 58 },
    hpRange: { min: 120, max: 170 },
    energyRange: { min: 2, max: 4 },
    bonus: 0
  },
  rara: {
    id: "rara",
    label: "Rara",
    weight: 2,
    statRange: { min: 58, max: 78 },
    hpRange: { min: 170, max: 230 },
    energyRange: { min: 3, max: 6 },
    bonus: 8
  },
  lendaria: {
    id: "lendaria",
    label: "Lendária",
    weight: 3,
    statRange: { min: 78, max: 96 },
    hpRange: { min: 230, max: 310 },
    energyRange: { min: 5, max: 8 },
    bonus: 18
  },
  mitica: {
    id: "mitica",
    label: "Mítica",
    weight: 4,
    statRange: { min: 98, max: 124 },
    hpRange: { min: 340, max: 460 },
    energyRange: { min: 7, max: 11 },
    bonus: 34
  }
};

const ARCHETYPES = [
  { id: "guardiao", name: "Guardião", statBias: { def: 9, hp: 18 }, tags: ["proteção", "resistência"] },
  { id: "duelista", name: "Duelista", statBias: { atk: 8, spd: 5 }, tags: ["lâmina", "precisão"] },
  { id: "oraculo", name: "Oráculo", statBias: { eng: 2, spd: 4 }, tags: ["visão", "controle"] },
  { id: "artifice", name: "Artífice", statBias: { atk: 4, def: 4, eng: 1 }, tags: ["engenho", "arma"] },
  { id: "sentinela", name: "Sentinela", statBias: { def: 6, spd: 5 }, tags: ["vigília", "escudo"] },
  { id: "tempestario", name: "Tempestário", statBias: { atk: 7, eng: 1 }, tags: ["clima", "impacto"] },
  { id: "curandeiro", name: "Curandeiro", statBias: { def: 4, hp: 24, eng: 1 }, tags: ["cura", "suporte"] },
  { id: "sombra", name: "Sombra", statBias: { spd: 10, atk: 3 }, tags: ["furtividade", "crítico"] }
];

const ELEMENTS = [
  { id: "solar", name: "Solar", tags: ["luz", "coragem"] },
  { id: "lunar", name: "Lunar", tags: ["reflexo", "calma"] },
  { id: "ignis", name: "Ignis", tags: ["fogo", "pressão"] },
  { id: "aqua", name: "Aqua", tags: ["água", "fluxo"] },
  { id: "terra", name: "Terra", tags: ["rocha", "defesa"] },
  { id: "aether", name: "Aether", tags: ["energia", "mistério"] },
  { id: "metal", name: "Metal", tags: ["forja", "armadura"] },
  { id: "vento", name: "Vento", tags: ["velocidade", "evasão"] },
  { id: "flora", name: "Flora", tags: ["vida", "regeneração"] },
  { id: "umbra", name: "Umbra", tags: ["sombra", "ruptura"] }
];

const POWER_DOMAINS = [
  ["Aurora", "luz concentrada", "solar", "atk"],
  ["Maré", "pressão fluida", "aqua", "def"],
  ["Brasa", "calor de impacto", "ignis", "atk"],
  ["Granito", "peso defensivo", "terra", "def"],
  ["Eclipse", "distorção de sombra", "umbra", "spd"],
  ["Zênite", "foco absoluto", "solar", "eng"],
  ["Névoa", "ocultação tática", "lunar", "spd"],
  ["Trovão", "descarga súbita", "vento", "atk"],
  ["Raiz", "recuperação vital", "flora", "hp"],
  ["Forja", "reforço metálico", "metal", "def"]
];

const POWER_FORMS = [
  ["Corte", 9, "golpe direcionado"],
  ["Muralha", 8, "barreira reativa"],
  ["Pulso", 7, "onda curta"],
  ["Selo", 6, "marca persistente"],
  ["Rajada", 8, "sequência rápida"],
  ["Vínculo", 5, "suporte de equipe"],
  ["Ruptura", 10, "quebra de defesa"],
  ["Véu", 6, "proteção evasiva"],
  ["Núcleo", 9, "carga acumulada"],
  ["Orbe", 7, "projétil guiado"]
];

const WEAPON_FAMILIES = [
  ["Espada", "lâmina", "atk", "duas cartas com lâmina ganham ataque"],
  ["Escudo", "escudo", "def", "duas cartas com escudo ganham defesa"],
  ["Lança", "alcance", "atk", "alcance pressiona cartas defensivas"],
  ["Arco", "precisão", "spd", "precisão acelera a primeira ação"],
  ["Cajado", "canalizador", "eng", "canalizadores reduzem custo de habilidade"],
  ["Martelo", "impacto", "atk", "impacto pune defesa baixa"],
  ["Adaga", "furtividade", "spd", "furtividade melhora troca ativa"],
  ["Manopla", "corpo-a-corpo", "def", "corpo-a-corpo sustenta duelos longos"],
  ["Tomo", "técnica", "eng", "técnica fortalece habilidades"],
  ["Relíquia", "aether", "hp", "relíquias aumentam resistência do baralho"]
];

const WEAPON_MATERIALS = [
  ["de Vidro Solar", 5],
  ["de Ferro Vivo", 6],
  ["de Osso Lunar", 5],
  ["de Âmbar Frio", 4],
  ["de Prata Negra", 7],
  ["de Cobre Antigo", 4],
  ["de Basalto", 6],
  ["de Seda Afiada", 5],
  ["de Coral", 4],
  ["de Aço Azul", 7]
];

function buildPowers() {
  const powers = [];
  for (const [domainIndex, domain] of POWER_DOMAINS.entries()) {
    for (const [formIndex, form] of POWER_FORMS.entries()) {
      const power = {
        id: `poder_${String(powers.length + 1).padStart(3, "0")}`,
        name: `${form[0]} da ${domain[0]}`,
        element: domain[2],
        stat: domain[3],
        value: form[1] + Math.floor(domainIndex / 2),
        energyCost: 1 + ((domainIndex + formIndex) % 4),
        effect: form[2],
        description: `${form[2]} baseado em ${domain[1]}.`
      };
      powers.push(power);
    }
  }
  return powers;
}

function buildWeapons() {
  const weapons = [];
  for (const [familyIndex, family] of WEAPON_FAMILIES.entries()) {
    for (const [materialIndex, material] of WEAPON_MATERIALS.entries()) {
      weapons.push({
        id: `arma_${String(weapons.length + 1).padStart(3, "0")}`,
        name: `${family[0]} ${material[0]}`,
        family: family[1],
        stat: family[2],
        value: material[1] + Math.floor(familyIndex / 2),
        synergyHint: family[3],
        description: `${family[0]} criada para ${family[3]}.`
      });
    }
  }
  return weapons;
}

const POWERS = buildPowers();
const WEAPONS = buildWeapons();

const ABILITIES = [
  { id: "golpe_focado", name: "Golpe Focado", cost: 2, type: "damage", value: 10, description: "Causa dano extra em um ataque direto." },
  { id: "postura_firme", name: "Postura Firme", cost: 2, type: "shield", value: 12, description: "Aumenta defesa até o próximo turno." },
  { id: "impulso_rapido", name: "Impulso Rápido", cost: 1, type: "speed", value: 8, description: "Aumenta velocidade e favorece troca ativa." },
  { id: "fagulha_vital", name: "Fagulha Vital", cost: 3, type: "heal", value: 16, description: "Recupera pontos de vida da carta ativa." },
  { id: "quebra_guarda", name: "Quebra-Guarda", cost: 3, type: "pierce", value: 14, description: "Ignora parte da defesa inimiga." },
  { id: "recarga_eterica", name: "Recarga Etérica", cost: 0, type: "energy", value: 2, description: "Recupera energia para ações especiais." }
];

const SYNERGIES = [
  { id: "laminas_duplas", name: "Lâminas em Par", match: { weaponFamily: "lâmina", count: 2 }, bonus: { atk: 8 }, description: "Duas cartas com espada/lâmina aumentam ATK do baralho." },
  { id: "muralha_escudos", name: "Muralha de Escudos", match: { weaponFamily: "escudo", count: 2 }, bonus: { def: 10 }, description: "Duas cartas com escudo aumentam DEF do baralho." },
  { id: "canalizadores", name: "Círculo Canalizador", match: { weaponFamily: "canalizador", count: 2 }, bonus: { eng: 1 }, description: "Dois cajados aumentam energia inicial." },
  { id: "passos_sombra", name: "Passos de Sombra", match: { weaponFamily: "furtividade", count: 2 }, bonus: { spd: 9 }, description: "Duas armas furtivas aceleram trocas e iniciativa." },
  { id: "forja_viva", name: "Forja Viva", match: { element: "metal", count: 2 }, bonus: { def: 6, hp: 12 }, description: "Duas cartas de Metal ganham defesa e vida." },
  { id: "tempestade", name: "Frente de Tempestade", match: { element: "vento", count: 2 }, bonus: { spd: 7, atk: 4 }, description: "Duas cartas de Vento ganham velocidade e ataque." },
  { id: "jardim_vital", name: "Jardim Vital", match: { element: "flora", count: 2 }, bonus: { hp: 22 }, description: "Duas cartas de Flora aumentam vida máxima." },
  { id: "trindade_equilibrada", name: "Trindade Equilibrada", match: { distinctElements: 3 }, bonus: { atk: 3, def: 3, spd: 3 }, description: "Três elementos diferentes concedem bônus leve geral." }
];

function getById(list, id) {
  return list.find((item) => item.id === id) || null;
}

module.exports = {
  RARITIES,
  ARCHETYPES,
  ELEMENTS,
  POWERS,
  WEAPONS,
  ABILITIES,
  SYNERGIES,
  getPower: (id) => getById(POWERS, id),
  getWeapon: (id) => getById(WEAPONS, id),
  getAbility: (id) => getById(ABILITIES, id),
  getArchetype: (id) => getById(ARCHETYPES, id),
  getElement: (id) => getById(ELEMENTS, id)
};
