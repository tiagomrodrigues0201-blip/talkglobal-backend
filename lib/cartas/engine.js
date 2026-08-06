const crypto = require("crypto");
const {
  RARITIES,
  ARCHETYPES,
  ELEMENTS,
  POWERS,
  WEAPONS,
  ABILITIES,
  SYNERGIES,
  getPower,
  getWeapon,
  getAbility,
  getArchetype,
  getElement
} = require("./catalog");

function hashToNumber(value) {
  return crypto.createHash("sha256").update(String(value)).digest().readUInt32BE(0);
}

function pick(list, seed, offset = 0) {
  return list[(hashToNumber(`${seed}:${offset}`) % list.length)];
}

function bounded(seed, min, max, offset = 0) {
  return min + (hashToNumber(`${seed}:${offset}`) % (max - min + 1));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getRarity(id) {
  return RARITIES[id] || RARITIES.comum;
}

function buildStats({ seed, rarityId, archetype, power, weapon }) {
  const rarity = getRarity(rarityId);
  const range = rarity.statRange;
  const hpRange = rarity.hpRange;
  const energyRange = rarity.energyRange;

  const stats = {
    atk: bounded(seed, range.min, range.max, 1),
    def: bounded(seed, range.min, range.max, 2),
    spd: bounded(seed, range.min, range.max, 3),
    eng: bounded(seed, energyRange.min, energyRange.max, 4),
    hp: bounded(seed, hpRange.min, hpRange.max, 5)
  };

  const bias = archetype?.statBias || {};
  stats.atk += Number(bias.atk || 0);
  stats.def += Number(bias.def || 0);
  stats.spd += Number(bias.spd || 0);
  stats.eng += Number(bias.eng || 0);
  stats.hp += Number(bias.hp || 0);

  if (power?.stat && stats[power.stat] !== undefined) {
    stats[power.stat] += Number(power.value || 0);
  }

  if (weapon?.stat && stats[weapon.stat] !== undefined) {
    stats[weapon.stat] += Number(weapon.value || 0);
  }

  stats.atk += rarity.bonus;
  stats.def += rarity.bonus;
  stats.spd += Math.floor(rarity.bonus / 2);
  stats.hp += rarity.bonus * 3;

  if (rarity.id === "mitica") {
    stats.atk = Math.max(stats.atk, RARITIES.lendaria.statRange.max + 12);
    stats.def = Math.max(stats.def, RARITIES.lendaria.statRange.max + 12);
    stats.hp = Math.max(stats.hp, RARITIES.lendaria.hpRange.max + 40);
  }

  return {
    atk: clamp(stats.atk, 1, 180),
    def: clamp(stats.def, 1, 180),
    spd: clamp(stats.spd, 1, 180),
    eng: clamp(stats.eng, 0, 14),
    hp: clamp(stats.hp, 1, 520)
  };
}

function createCardFromSeed({ userId, slot = 0, rarityId = "comum", photoProfile = {} }) {
  const seed = `${userId}:${slot}:${photoProfile.signature || "sem-foto"}`;
  const archetype = pick(ARCHETYPES, seed, 1);
  const element = pick(ELEMENTS, seed, 2);
  const power = pick(POWERS.filter((item) => item.element === element.id), seed, 3) || pick(POWERS, seed, 3);
  const weapon = pick(WEAPONS, seed, 4);
  const ability = pick(ABILITIES, seed, 5);
  const rarity = getRarity(rarityId);
  const stats = buildStats({ seed, rarityId, archetype, power, weapon });
  const visualCue = photoProfile.visualCue || pick(["Aurora", "Cobalto", "Marfim", "Escarlate", "Âmbar"], seed, 6);

  return {
    character_name: `${archetype.name} ${visualCue}`,
    image_url: null,
    description: `Carta ${rarity.label} criada a partir de um perfil visual privado do jogador, combinando ${archetype.name}, elemento ${element.name} e ${weapon.name}.`,
    archetype_id: archetype.id,
    archetype_name: archetype.name,
    element_id: element.id,
    element_name: element.name,
    power_id: power.id,
    power_name: power.name,
    weapon_id: weapon.id,
    weapon_name: weapon.name,
    weapon_family: weapon.family,
    ability_id: ability.id,
    ability_name: ability.name,
    rarity: rarity.id,
    rarity_label: rarity.label,
    atk: stats.atk,
    def: stats.def,
    spd: stats.spd,
    eng: stats.eng,
    hp: stats.hp,
    current_hp: stats.hp,
    level: 1,
    experience: 0,
    origin: slot < 3 ? "initial" : "reward",
    source_type: slot < 3 ? "initial" : "reward",
    is_initial: slot < 3,
    metadata: {
      catalogVersion: 1,
      photoProfile: {
        signature: photoProfile.signature || "sem-foto",
        visualCue,
        analysisMode: photoProfile.analysisMode || "deterministic-local"
      },
      power,
      weapon,
      ability
    }
  };
}

function normalizeCard(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.user_id,
    characterName: row.character_name,
    imageUrl: row.image_url,
    description: row.description,
    archetype: row.archetype_name,
    element: row.element_name,
    power: row.power_name,
    weapon: row.weapon_name,
    weaponFamily: row.weapon_family,
    ability: row.ability_name,
    rarity: row.rarity,
    rarityLabel: row.rarity_label || getRarity(row.rarity).label,
    atk: Number(row.atk || 0),
    def: Number(row.def || 0),
    spd: Number(row.spd || 0),
    eng: Number(row.eng || 0),
    hp: Number(row.hp || 0),
    currentHp: Number(row.current_hp || row.hp || 0),
    level: Number(row.level || 1),
    experience: Number(row.experience || 0),
    origin: row.origin,
    sourceType: row.source_type,
    isInitial: Boolean(row.is_initial),
    createdAt: row.created_at,
    metadata: row.metadata || {}
  };
}

function countBy(cards, getter) {
  return cards.reduce((acc, card) => {
    const key = getter(card);
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function getActiveSynergies(cards) {
  const normalized = cards.map((card) => ({
    ...card,
    weaponFamily: card.weaponFamily || card.weapon_family,
    elementId: card.elementId || card.element_id || card.metadata?.element?.id || String(card.element || "").toLowerCase()
  }));
  const byWeapon = countBy(normalized, (card) => card.weaponFamily);
  const byElement = countBy(normalized, (card) => card.elementId);
  const distinctElements = Object.keys(byElement).length;

  return SYNERGIES.filter((synergy) => {
    const match = synergy.match || {};
    if (match.weaponFamily) return Number(byWeapon[match.weaponFamily] || 0) >= match.count;
    if (match.element) return Number(byElement[match.element] || 0) >= match.count;
    if (match.distinctElements) return distinctElements >= match.distinctElements;
    return false;
  });
}

function sumSynergyBonus(synergies) {
  return synergies.reduce((acc, synergy) => {
    Object.entries(synergy.bonus || {}).forEach(([key, value]) => {
      acc[key] = Number(acc[key] || 0) + Number(value || 0);
    });
    return acc;
  }, {});
}

function applyBonuses(card, bonus = {}) {
  return {
    ...card,
    atk: Number(card.atk || 0) + Number(bonus.atk || 0),
    def: Number(card.def || 0) + Number(bonus.def || 0),
    spd: Number(card.spd || 0) + Number(bonus.spd || 0),
    eng: Number(card.eng || 0) + Number(bonus.eng || 0),
    hp: Number(card.hp || 0) + Number(bonus.hp || 0),
    currentHp: Number(card.currentHp || card.current_hp || card.hp || 0) + Number(bonus.hp || 0)
  };
}

function calculateAttackDamage(attacker, defender, options = {}) {
  const attackerRarity = getRarity(attacker.rarity);
  const defenderRarity = getRarity(defender.rarity);
  let attack = Number(attacker.atk || 0) + Number(options.attackBonus || 0);
  let defense = Number(defender.def || 0) + Number(options.defenseBonus || 0);

  if (options.pierce) {
    defense = Math.max(0, defense - Number(options.pierce || 0));
  }

  if (attackerRarity.id === "mitica" && defenderRarity.weight < attackerRarity.weight) {
    attack = Math.max(attack, defense + 1);
  }

  const damage = Math.max(0, attack - defense);
  return {
    attack,
    defense,
    damage,
    blocked: damage <= 0
  };
}

function tutorialEnemyDeck() {
  return [0, 1, 2].map((slot) => createCardFromSeed({
    userId: "tutorial-bot",
    slot,
    rarityId: "comum",
    photoProfile: { signature: "tutorial", visualCue: ["Treino", "Calma", "Eco"][slot] }
  }));
}

function createInitialCardsSet({ userId, photoProfile }) {
  return [0, 1, 2].map((slot) => createCardFromSeed({
    userId,
    slot,
    rarityId: "comum",
    photoProfile
  }));
}

function createInitialCardsIfNeeded({ existingCards = [], userId, photoProfile }) {
  const initialCards = existingCards.filter((card) => Boolean(card.isInitial || card.is_initial));
  if (initialCards.length >= 3) {
    return {
      created: false,
      reason: "initial_cards_already_created",
      cards: existingCards
    };
  }

  return {
    created: true,
    reason: "initial_cards_created",
    cards: createInitialCardsSet({ userId, photoProfile })
  };
}

function validateDeckSelection({ cards = [], userId, cardIds = [] }) {
  if (!Array.isArray(cardIds) || cardIds.length !== 3) {
    return { ok: false, error: "invalid_deck_size" };
  }

  const seen = new Set();
  for (const cardId of cardIds) {
    if (seen.has(cardId)) return { ok: false, error: "duplicate_card" };
    seen.add(cardId);
  }

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  for (const cardId of cardIds) {
    const card = cardsById.get(cardId);
    const owner = card?.ownerId || card?.user_id || card?.owner_id;
    if (!card || (userId && owner && owner !== userId)) {
      return { ok: false, error: "card_not_owned" };
    }
  }

  return { ok: true };
}

function buildProgressionPatch({ winner, current = {} }) {
  const battles = Number(current.battles || 0) + 1;
  if (winner !== "player") {
    return {
      tutorial_completed: Boolean(current.tutorial_completed),
      level_unlocked: Number(current.level_unlocked || 1),
      victories: Number(current.victories || 0),
      battles,
      resources: Number(current.resources || 0),
      rewards: {}
    };
  }

  return {
    tutorial_completed: true,
    level_unlocked: Math.max(2, Number(current.level_unlocked || 1)),
    victories: Number(current.victories || 0) + 1,
    battles,
    resources: Number(current.resources || 0) + 10,
    rewards: { experience: 20, resources: 10, unlockedLevel: 2 }
  };
}

function startTutorialBattle(playerDeck) {
  const playerSynergies = getActiveSynergies(playerDeck);
  const playerBonus = sumSynergyBonus(playerSynergies);
  const enemyDeck = tutorialEnemyDeck().map(normalizeCard);
  const enemySynergies = getActiveSynergies(enemyDeck);
  const enemyBonus = sumSynergyBonus(enemySynergies);

  return {
    mode: "tutorial",
    level: 1,
    turn: 1,
    phase: "player",
    activePlayerIndex: 0,
    activeEnemyIndex: 0,
    player: {
      deck: playerDeck.map((card) => applyBonuses(card, playerBonus)),
      synergies: playerSynergies,
      bonus: playerBonus
    },
    enemy: {
      deck: enemyDeck.map((card) => applyBonuses(card, enemyBonus)),
      synergies: enemySynergies,
      bonus: enemyBonus
    },
    log: [{
      turn: 0,
      actor: "system",
      action: "start",
      message: "Tutorial iniciado. Ataque, defenda, use habilidade e troque cartas para aprender o fluxo."
    }]
  };
}

function getWinner(state) {
  const playerAlive = state.player.deck.some((card) => Number(card.currentHp || 0) > 0);
  const enemyAlive = state.enemy.deck.some((card) => Number(card.currentHp || 0) > 0);
  if (playerAlive && enemyAlive) return null;
  return playerAlive ? "player" : "enemy";
}

function activeCard(deck, index) {
  return deck.find((card, cardIndex) => cardIndex === index && Number(card.currentHp || 0) > 0)
    || deck.find((card) => Number(card.currentHp || 0) > 0)
    || null;
}

function resolvePlayerAction(state, action) {
  const next = JSON.parse(JSON.stringify(state));
  if (next.phase !== "player") {
    return { ok: false, error: "not_player_turn", state: next };
  }

  const type = String(action?.type || "attack");
  if (!["attack", "defend", "ability", "switch"].includes(type)) {
    return { ok: false, error: "invalid_action", state: next };
  }

  const player = activeCard(next.player.deck, next.activePlayerIndex);
  const enemy = activeCard(next.enemy.deck, next.activeEnemyIndex);
  if (!player || !enemy) return { ok: false, error: "battle_finished", state: next };

  if (type === "switch") {
    const index = Number(action.cardIndex);
    if (!Number.isInteger(index) || !next.player.deck[index] || Number(next.player.deck[index].currentHp || 0) <= 0) {
      return { ok: false, error: "invalid_switch_target", state: next };
    }
    next.activePlayerIndex = index;
    next.log.push({ turn: next.turn, actor: "player", action: "switch", message: `Você trocou para ${next.player.deck[index].characterName}.` });
    return { ok: true, state: resolveEnemyAction(next) };
  }

  if (type === "defend") {
    player.defending = true;
    player.currentHp = Math.min(player.hp, Number(player.currentHp || 0) + 4);
    next.log.push({ turn: next.turn, actor: "player", action: "defend", message: `${player.characterName} defendeu e estabilizou vida.` });
    return { ok: true, state: resolveEnemyAction(next) };
  }

  if (type === "ability") {
    const ability = getAbility(player.metadata?.ability?.id) || getAbility("golpe_focado");
    if (Number(player.eng || 0) < Number(ability.cost || 0)) {
      next.log.push({ turn: next.turn, actor: "player", action: "ability_failed", message: "Energia insuficiente para habilidade." });
      return { ok: false, error: "not_enough_energy", state: next };
    }

    player.eng = Number(player.eng || 0) - Number(ability.cost || 0);
    if (ability.type === "heal") {
      player.currentHp = Math.min(player.hp, Number(player.currentHp || 0) + ability.value);
      next.log.push({ turn: next.turn, actor: "player", action: "ability", message: `${player.characterName} usou ${ability.name} e recuperou vida.` });
    } else if (ability.type === "energy") {
      player.eng = Number(player.eng || 0) + ability.value;
      next.log.push({ turn: next.turn, actor: "player", action: "ability", message: `${player.characterName} usou ${ability.name} e recuperou energia.` });
    } else {
      const result = calculateAttackDamage(player, enemy, {
        attackBonus: ability.type === "damage" ? ability.value : 0,
        pierce: ability.type === "pierce" ? ability.value : 0
      });
      enemy.currentHp = Math.max(0, Number(enemy.currentHp || 0) - result.damage);
      next.log.push({ turn: next.turn, actor: "player", action: "ability", damage: result.damage, message: `${player.characterName} usou ${ability.name}: ${result.damage} de dano.` });
    }
    return { ok: true, state: getWinner(next) ? next : resolveEnemyAction(next) };
  }

  const result = calculateAttackDamage(player, enemy);
  enemy.currentHp = Math.max(0, Number(enemy.currentHp || 0) - result.damage);
  next.log.push({ turn: next.turn, actor: "player", action: "attack", damage: result.damage, message: result.blocked ? "Ataque bloqueado." : `${player.characterName} causou ${result.damage} de dano.` });
  return { ok: true, state: getWinner(next) ? next : resolveEnemyAction(next) };
}

function resolveEnemyAction(state) {
  const next = JSON.parse(JSON.stringify(state));
  next.phase = "enemy";
  const player = activeCard(next.player.deck, next.activePlayerIndex);
  const enemy = activeCard(next.enemy.deck, next.activeEnemyIndex);
  if (!player || !enemy) return next;

  if (Number(enemy.currentHp || 0) < Number(enemy.hp || 0) * 0.34) {
    enemy.defending = true;
    next.log.push({ turn: next.turn, actor: "enemy", action: "defend", message: "A máquina defendeu para demonstrar bloqueio." });
  } else {
    const result = calculateAttackDamage(enemy, player, { defenseBonus: player.defending ? 10 : 0 });
    player.currentHp = Math.max(0, Number(player.currentHp || 0) - result.damage);
    next.log.push({ turn: next.turn, actor: "enemy", action: "attack", damage: result.damage, message: result.blocked ? "O ataque da máquina foi bloqueado." : `A máquina causou ${result.damage} de dano.` });
  }

  player.defending = false;
  enemy.defending = false;
  next.turn += 1;
  next.phase = "player";
  return next;
}

module.exports = {
  createCardFromSeed,
  createInitialCardsSet,
  createInitialCardsIfNeeded,
  validateDeckSelection,
  normalizeCard,
  getActiveSynergies,
  sumSynergyBonus,
  applyBonuses,
  calculateAttackDamage,
  tutorialEnemyDeck,
  startTutorialBattle,
  resolvePlayerAction,
  resolveEnemyAction,
  getWinner,
  buildProgressionPatch
};
