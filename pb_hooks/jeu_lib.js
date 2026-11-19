// Monsieur Flop : logique du jeu, partagée par toutes les routes de main.pb.js.
// Toutes les règles de calcul des points sont ici, et sont décrites dans la page « Règles » de l'application.

const TYPES = ["choix", "oui_non", "classement", "estimation", "vote"];
const PHASES = ["campagne", "parrainages", "premier_tour", "second_tour"];
const STATUTS_CANDIDAT = ["declare", "officiel", "non_retenu", "retire"];

// ---------- Outils ----------

function lireJSON(rec, champ, defaut) {
  const brut = rec.get(champ);
  if (brut === null || brut === undefined) return defaut;
  let texte = "";
  try {
    texte = toString(brut);
  } catch (err) {
    texte = "" + brut;
  }
  if (!texte || texte === "null") return defaut;
  try {
    return JSON.parse(texte);
  } catch (err) {
    return defaut;
  }
}

function dateMs(texte) {
  if (!texte) return 0;
  const ms = Date.parse(String(texte).replace(" ", "T"));
  return isNaN(ms) ? 0 : ms;
}

function versISO(texte) {
  const ms = dateMs(texte);
  return ms ? new Date(ms).toISOString() : "";
}

function arrondir(valeur, decimales) {
  const f = Math.pow(10, decimales || 0);
  return Math.round(valeur * f) / f;
}

function erreur(message) {
  return new BadRequestError(message);
}

// ---------- Lecture des enregistrements ----------

function pariDepuisRecord(rec) {
  return {
    id: rec.id,
    titre: rec.getString("titre"),
    description: rec.getString("description"),
    type: rec.getString("type"),
    phase: rec.getString("phase"),
    ouverture: versISO(rec.getString("ouverture")),
    cloture: versISO(rec.getString("cloture")),
    coef: rec.getFloat("coef") || 1,
    options: lireJSON(rec, "options", []) || [],
    config: lireJSON(rec, "config", {}) || {},
    statut: rec.getString("statut"),
    resultat: lireJSON(rec, "resultat", null),
    resolu_le: versISO(rec.getString("resolu_le")),
  };
}

function pronoDepuisRecord(rec) {
  return {
    id: rec.id,
    joueur: rec.getString("joueur"),
    pari: rec.getString("pari"),
    reponse: lireJSON(rec, "reponse", null),
    points: rec.getFloat("points") || 0,
    modifs: rec.getInt("modifs") || 0,
    maj: versISO(rec.getString("parie_le")),
  };
}

function joueurDepuisRecord(rec) {
  return {
    id: rec.id,
    pseudo: rec.getString("pseudo"),
    guilde: rec.getString("guilde"),
    role: rec.getString("role") || "joueur",
  };
}

// ---------- État d'un pari ----------

function etatPari(pari, maintenant) {
  if (pari.statut === "resolu") return "resolu";
  if (pari.statut === "brouillon") return "brouillon";
  if (maintenant < dateMs(pari.ouverture)) return "a_venir";
  if (maintenant < dateMs(pari.cloture)) return "ouvert";
  return "clos";
}

// Les pronos des autres sont visibles à la clôture.
// Exception : « Mon vote » n'est dévoilé qu'une fois le résultat saisi.
function estDevoile(pari, etat) {
  if (pari.type === "vote") return etat === "resolu";
  return etat === "clos" || etat === "resolu";
}

// ---------- Calcul des points ----------

// 10 ÷ probabilité : 50 % → 20 points, 10 % → 100 points, 1 % → 1000 points.
function pointsProba(pct) {
  const p = Math.min(99, Math.max(1, Number(pct) || 50));
  return Math.round(1000 / p);
}

function trouverOption(options, id) {
  for (let i = 0; i < options.length; i++) {
    if (options[i].id === id) return options[i];
  }
  return null;
}

function pointsBruts(pari, reponse, resultat) {
  if (!reponse || !resultat) return 0;
  const options = pari.options || [];
  let brut = 0;
  if (pari.type === "choix") {
    if (reponse.option && reponse.option === resultat.option) {
      const o = trouverOption(options, reponse.option);
      brut = o ? pointsProba(o.pct) : 0;
    }
  } else if (pari.type === "oui_non") {
    const oui = resultat.oui || [];
    const reps = reponse.reponses || {};
    Object.keys(reps).forEach((id) => {
      const o = trouverOption(options, id);
      if (!o) return;
      const estOui = oui.indexOf(id) >= 0;
      if (reps[id] === "oui" && estOui) brut += pointsProba(o.pct);
      if (reps[id] === "non" && !estOui) brut += pointsProba(100 - Number(o.pct));
    });
  } else if (pari.type === "classement") {
    const ordre = resultat.ordre || [];
    (reponse.ordre || []).forEach((id, i) => {
      const o = trouverOption(options, id);
      if (!o) return;
      const pos = ordre.indexOf(id);
      if (pos === i) brut += pointsProba(o.pct);
      else if (pos >= 0) brut += Math.round(pointsProba(o.pct) / 2);
    });
  } else if (pari.type === "estimation") {
    const pente = Number(pari.config.pente) || 10;
    const ecart = Math.abs(Number(reponse.valeur) - Number(resultat.valeur));
    if (isFinite(ecart)) brut = Math.max(0, Math.round(100 - pente * ecart));
  }
  return brut;
}

function calculerPoints(pari, reponse, resultat) {
  return Math.round(pointsBruts(pari, reponse, resultat) * (Number(pari.coef) || 1));
}

// ---------- Validation des réponses des joueurs ----------

function normaliserReponse(pari, r) {
  r = r || {};
  const ids = (pari.options || []).map((o) => o.id);
  if (pari.type === "choix") {
    if (ids.indexOf(r.option) < 0) throw erreur("Choisis une réponse dans la liste.");
    return { option: r.option };
  }
  if (pari.type === "oui_non") {
    const sortie = {};
    let n = 0;
    const reps = r.reponses || {};
    Object.keys(reps).forEach((id) => {
      if (ids.indexOf(id) < 0) return;
      if (reps[id] === "oui" || reps[id] === "non") {
        sortie[id] = reps[id];
        n++;
      }
    });
    if (!n) throw erreur("Réponds oui ou non pour au moins un nom.");
    return { reponses: sortie };
  }
  if (pari.type === "classement") {
    const places = Number(pari.config.places) || 3;
    const ordre = (r.ordre || []).slice(0, places);
    if (ordre.length !== places) throw erreur("Remplis les " + places + " places.");
    const vus = {};
    ordre.forEach((id) => {
      if (ids.indexOf(id) < 0) throw erreur("Un des noms choisis n'est pas dans la liste.");
      if (vus[id]) throw erreur("Le même nom ne peut pas occuper deux places.");
      vus[id] = true;
    });
    return { ordre: ordre };
  }
  if (pari.type === "estimation") {
    const cfg = pari.config || {};
    const v = Number(String(r.valeur).replace(",", "."));
    if (r.valeur === "" || r.valeur === null || r.valeur === undefined || !isFinite(v)) throw erreur("Indique un nombre.");
    if (cfg.min !== undefined && cfg.min !== null && v < Number(cfg.min)) throw erreur("Le nombre doit être au moins " + cfg.min + ".");
    if (cfg.max !== undefined && cfg.max !== null && v > Number(cfg.max)) throw erreur("Le nombre doit être au plus " + cfg.max + ".");
    return { valeur: arrondir(v, Number(cfg.decimales) || 0) };
  }
  if (pari.type === "vote") {
    const sortie = {};
    if (r.vais && ids.indexOf(r.vais) >= 0) sortie.vais = r.vais;
    if (r.voudrais && ids.indexOf(r.voudrais) >= 0) sortie.voudrais = r.voudrais;
    if (!sortie.vais && !sortie.voudrais) throw erreur("Choisis au moins une des deux réponses.");
    return sortie;
  }
  throw erreur("Type de pari inconnu.");
}

// ---------- Validation des résultats saisis par l'admin ----------

function normaliserResultat(pari, r) {
  r = r || {};
  const ids = (pari.options || []).map((o) => o.id);
  if (pari.type === "choix") {
    if (ids.indexOf(r.option) < 0) throw erreur("Choisis la bonne réponse dans la liste.");
    return { option: r.option };
  }
  if (pari.type === "oui_non") {
    return { oui: (r.oui || []).filter((id) => ids.indexOf(id) >= 0) };
  }
  if (pari.type === "classement") {
    const places = Number(pari.config.places) || 3;
    const ordre = (r.ordre || []).slice(0, places);
    if (ordre.length !== places) throw erreur("Remplis les " + places + " places du résultat.");
    const vus = {};
    ordre.forEach((id) => {
      if (ids.indexOf(id) < 0) throw erreur("Un des noms n'est pas dans la liste.");
      if (vus[id]) throw erreur("Le même nom ne peut pas occuper deux places.");
      vus[id] = true;
    });
    return { ordre: ordre };
  }
  if (pari.type === "estimation") {
    const v = Number(String(r.valeur).replace(",", "."));
    if (r.valeur === "" || r.valeur === null || r.valeur === undefined || !isFinite(v)) throw erreur("Indique la valeur réelle.");
    return { valeur: v };
  }
  if (pari.type === "vote") {
    const pourcentages = {};
    const src = r.pourcentages || {};
    Object.keys(src).forEach((id) => {
      const v = Number(String(src[id]).replace(",", "."));
      if (ids.indexOf(id) >= 0 && src[id] !== "" && src[id] !== null && isFinite(v)) pourcentages[id] = v;
    });
    return { pourcentages: pourcentages };
  }
  throw erreur("Type de pari inconnu.");
}

// ---------- Validation d'un pari créé ou modifié par l'admin ----------

function normaliserPari(b) {
  b = b || {};
  const titre = String(b.titre || "").trim();
  if (!titre) throw erreur("Le titre est obligatoire.");
  if (TYPES.indexOf(b.type) < 0) throw erreur("Type de pari inconnu.");
  if (PHASES.indexOf(b.phase) < 0) throw erreur("Phase inconnue.");
  const ouverture = dateMs(b.ouverture);
  const cloture = dateMs(b.cloture);
  if (!ouverture || !cloture) throw erreur("Les dates d'ouverture et de clôture sont obligatoires.");
  if (cloture <= ouverture) throw erreur("La clôture doit être après l'ouverture.");
  let coef = Number(String(b.coef === undefined ? 1 : b.coef).replace(",", "."));
  if (!isFinite(coef) || coef <= 0 || coef > 10) throw erreur("Le coefficient doit être entre 0,1 et 10.");
  const statut = b.statut === "publie" ? "publie" : "brouillon";

  const options = [];
  const vus = {};
  if (b.type !== "estimation") {
    (b.options || []).forEach((o) => {
      const label = String(o.label || "").trim();
      if (!label) throw erreur("Chaque réponse possible doit avoir un nom.");
      let id = String(o.id || "").trim();
      if (!id) id = "x_" + $security.randomStringWithAlphabet(8, "abcdefghijkmnpqrstuvwxyz23456789");
      if (vus[id]) throw erreur("La réponse « " + label + " » apparaît deux fois.");
      vus[id] = true;
      let pct = null;
      if (o.pct !== null && o.pct !== undefined && o.pct !== "") {
        pct = Number(String(o.pct).replace(",", "."));
        if (!isFinite(pct) || pct < 1 || pct > 99) throw erreur("La probabilité de « " + label + " » doit être entre 1 et 99 %.");
      }
      options.push({ id: id, label: label, pct: pct });
    });
  }

  const config = {};
  const cfg = b.config || {};
  if (b.type === "estimation") {
    config.unite = String(cfg.unite || "").trim().slice(0, 20);
    config.pente = Number(String(cfg.pente || 10).replace(",", "."));
    if (!isFinite(config.pente) || config.pente <= 0) throw erreur("Les points perdus par unité d'écart doivent être positifs.");
    config.decimales = Math.max(0, Math.min(2, parseInt(cfg.decimales || 0, 10) || 0));
    if (cfg.min !== "" && cfg.min !== null && cfg.min !== undefined) config.min = Number(cfg.min);
    if (cfg.max !== "" && cfg.max !== null && cfg.max !== undefined) config.max = Number(cfg.max);
  }
  if (b.type === "classement") {
    config.places = Math.max(1, Math.min(5, parseInt(cfg.places || 3, 10) || 3));
    config.sens = cfg.sens === "bas" ? "bas" : "haut";
  }

  if (statut === "publie") {
    if (b.type === "choix" && options.length < 2) throw erreur("Un pari à choix doit proposer au moins deux réponses.");
    if (b.type === "oui_non" && options.length < 1) throw erreur("Ajoute au moins un nom.");
    if (b.type === "classement" && options.length < config.places) throw erreur("Il faut au moins " + config.places + " noms pour ce classement.");
    if (b.type === "vote" && options.length < 1) throw erreur("Ajoute au moins une réponse possible.");
    if (b.type === "choix" || b.type === "oui_non" || b.type === "classement") {
      options.forEach((o) => {
        if (o.pct === null) throw erreur("Indique la probabilité de « " + o.label + " » avant de publier.");
      });
    }
  }

  return {
    titre: titre.slice(0, 150),
    description: String(b.description || "").trim().slice(0, 2000),
    type: b.type,
    phase: b.phase,
    ouverture: new Date(ouverture).toISOString(),
    cloture: new Date(cloture).toISOString(),
    coef: Math.round(coef * 100) / 100,
    options: options,
    config: config,
    statut: statut,
  };
}

// ---------- Modification d'un pari sur lequel des joueurs ont déjà parié ----------

// Les identifiants de réponses utilisés par un prono.
function idsDeReponse(pari, r) {
  if (!r) return [];
  if (pari.type === "choix") return r.option ? [r.option] : [];
  if (pari.type === "oui_non") return Object.keys(r.reponses || {});
  if (pari.type === "classement") return (r.ordre || []).slice();
  if (pari.type === "vote") return [r.vais, r.voudrais].filter(Boolean);
  return [];
}

function memePct(a, b) {
  const x = a === null || a === undefined ? null : Number(a);
  const y = b === null || b === undefined ? null : Number(b);
  return x === y;
}

// actuel : le pari enregistré ; nouveau : la version normalisée envoyée par l'admin ; pronos : ceux de ce pari.
function verifierModifPari(actuel, nouveau, pronos, maintenant) {
  if (!pronos.length) return;
  const avant = {};
  (actuel.options || []).forEach((o) => { avant[o.id] = o; });
  const apres = {};
  (nouveau.options || []).forEach((o) => { apres[o.id] = o; });

  // Une réponse choisie par un joueur ne peut pas disparaître : son pari rapporterait 0 point sans prévenir.
  pronos.forEach((pr) => {
    idsDeReponse(actuel, pr.reponse).forEach((id) => {
      if (!apres[id]) {
        const label = avant[id] ? avant[id].label : id;
        throw erreur("« " + label + " » a été choisi par au moins un joueur : cette réponse ne peut plus être retirée.");
      }
    });
  });

  if (maintenant < dateMs(actuel.cloture)) return;

  // Après la clôture, les pronos sont dévoilés et les règles annoncent que les probabilités retenues
  // sont celles affichées à la clôture : plus rien de ce qui compte pour les points ne peut bouger.
  if (dateMs(nouveau.cloture) > maintenant) throw erreur("Ce pari est clos et les pronos ont été dévoilés : il ne peut pas être rouvert.");
  if (Math.abs(Number(nouveau.coef) - Number(actuel.coef)) > 1e-9) throw erreur("Ce pari est clos : son coefficient ne peut plus changer.");
  const cfgA = actuel.config || {};
  const cfgN = nouveau.config || {};
  ["pente", "places", "sens"].forEach((k) => {
    if (cfgA[k] === undefined && cfgN[k] === undefined) return;
    if (String(cfgA[k]) !== String(cfgN[k])) throw erreur("Ce pari est clos : son barème ne peut plus changer.");
  });
  (nouveau.options || []).forEach((o) => {
    const a = avant[o.id];
    if (!a) throw erreur("Ce pari est clos : on ne peut plus y ajouter de réponse (« " + o.label + " »).");
    if (!memePct(a.pct, o.pct)) throw erreur("Ce pari est clos : la probabilité de « " + o.label + " » ne peut plus changer.");
  });
  (actuel.options || []).forEach((o) => {
    if (!apres[o.id]) throw erreur("Ce pari est clos : la réponse « " + o.label + " » ne peut plus être retirée.");
  });
}

// ---------- Statistiques dévoilées à la clôture ----------

function statistiques(pari, pronos) {
  const stats = { participants: pronos.length };
  if (pari.type === "choix") {
    stats.compte = {};
    pronos.forEach((p) => {
      const id = p.reponse && p.reponse.option;
      if (id) stats.compte[id] = (stats.compte[id] || 0) + 1;
    });
  } else if (pari.type === "oui_non") {
    stats.oui = {};
    stats.non = {};
    pronos.forEach((p) => {
      const reps = (p.reponse && p.reponse.reponses) || {};
      Object.keys(reps).forEach((id) => {
        if (reps[id] === "oui") stats.oui[id] = (stats.oui[id] || 0) + 1;
        if (reps[id] === "non") stats.non[id] = (stats.non[id] || 0) + 1;
      });
    });
  } else if (pari.type === "classement") {
    stats.compte = {};
    stats.parPlace = {};
    pronos.forEach((p) => {
      ((p.reponse && p.reponse.ordre) || []).forEach((id, i) => {
        stats.compte[id] = (stats.compte[id] || 0) + 1;
        if (!stats.parPlace[id]) stats.parPlace[id] = [];
        stats.parPlace[id][i] = (stats.parPlace[id][i] || 0) + 1;
      });
    });
  } else if (pari.type === "estimation") {
    const valeurs = pronos
      .map((p) => Number(p.reponse && p.reponse.valeur))
      .filter((v) => isFinite(v))
      .sort((a, b) => a - b);
    stats.valeurs = valeurs;
    if (valeurs.length) {
      const somme = valeurs.reduce((a, b) => a + b, 0);
      stats.moyenne = arrondir(somme / valeurs.length, 2);
      const m = Math.floor(valeurs.length / 2);
      stats.mediane = valeurs.length % 2 ? valeurs[m] : arrondir((valeurs[m - 1] + valeurs[m]) / 2, 2);
    }
  } else if (pari.type === "vote") {
    stats.vais = {};
    stats.voudrais = {};
    pronos.forEach((p) => {
      const r = p.reponse || {};
      if (r.vais) stats.vais[r.vais] = (stats.vais[r.vais] || 0) + 1;
      if (r.voudrais) stats.voudrais[r.voudrais] = (stats.voudrais[r.voudrais] || 0) + 1;
    });
  }
  return stats;
}

// ---------- Duels ----------

function issueDuel(duel, pariEtat, pointsDe) {
  if (pariEtat !== "resolu") return { statut: "en_cours" };
  const a = pointsDe(duel.lanceur);
  const b = pointsDe(duel.adversaire);
  if (a === b) return { statut: "nul", pointsLanceur: a, pointsAdversaire: b };
  return { statut: "termine", gagnant: a > b ? duel.lanceur : duel.adversaire, pointsLanceur: a, pointsAdversaire: b };
}

// ---------- Classement, évolution et trophées ----------

function classementComplet(joueurs, guildes, paris, pronos, duels) {
  const maintenant = Date.now();
  const parisParId = {};
  paris.forEach((p) => { parisParId[p.id] = p; });
  const resolus = paris
    .filter((p) => p.statut === "resolu")
    .sort((a, b) => dateMs(a.resolu_le) - dateMs(b.resolu_le) || dateMs(a.cloture) - dateMs(b.cloture));

  const totaux = {};
  const parPhase = {};
  const nbParis = {};
  const pointsParPari = {};
  joueurs.forEach((j) => {
    totaux[j.id] = 0;
    parPhase[j.id] = { campagne: 0, parrainages: 0, premier_tour: 0, second_tour: 0 };
    nbParis[j.id] = 0;
  });
  pronos.forEach((pr) => {
    const pari = parisParId[pr.pari];
    if (!pari || totaux[pr.joueur] === undefined) return;
    nbParis[pr.joueur]++;
    if (pari.statut !== "resolu") return;
    totaux[pr.joueur] += pr.points;
    parPhase[pr.joueur][pari.phase] = (parPhase[pr.joueur][pari.phase] || 0) + pr.points;
    if (!pointsParPari[pr.pari]) pointsParPari[pr.pari] = {};
    pointsParPari[pr.pari][pr.joueur] = pr.points;
  });

  const listeJoueurs = joueurs
    .map((j) => ({ id: j.id, pseudo: j.pseudo, guilde: j.guilde, points: totaux[j.id], parPhase: parPhase[j.id], nbParis: nbParis[j.id] }))
    .sort((a, b) => b.points - a.points || a.pseudo.localeCompare(b.pseudo));
  listeJoueurs.forEach((j, i) => {
    j.rang = i > 0 && listeJoueurs[i - 1].points === j.points ? listeJoueurs[i - 1].rang : i + 1;
  });

  const listeGuildes = guildes
    .map((g) => {
      const membres = joueurs.filter((j) => j.guilde === g.id);
      const total = membres.reduce((s, j) => s + totaux[j.id], 0);
      return {
        id: g.id, nom: g.nom, couleur: g.couleur, membres: membres.length,
        total: total, moyenne: membres.length ? Math.round(total / membres.length) : 0,
      };
    })
    .sort((a, b) => b.moyenne - a.moyenne || b.membres - a.membres);
  listeGuildes.forEach((g, i) => {
    g.rang = i > 0 && listeGuildes[i - 1].moyenne === g.moyenne ? listeGuildes[i - 1].rang : i + 1;
  });

  // Évolution : points cumulés après chaque pari résolu.
  const cumul = {};
  joueurs.forEach((j) => { cumul[j.id] = 0; });
  const series = {};
  joueurs.forEach((j) => { series[j.id] = []; });
  resolus.forEach((p) => {
    const pts = pointsParPari[p.id] || {};
    joueurs.forEach((j) => {
      cumul[j.id] += pts[j.id] || 0;
      series[j.id].push(cumul[j.id]);
    });
  });
  const evolution = {
    etapes: resolus.map((p) => ({ id: p.id, titre: p.titre, date: p.resolu_le || p.cloture })),
    series: series,
  };

  // Duels : bilan par joueur.
  const bilanDuels = {};
  joueurs.forEach((j) => { bilanDuels[j.id] = { gagnes: 0, perdus: 0, nuls: 0, enCours: 0 }; });
  duels.forEach((d) => {
    const pari = parisParId[d.pari];
    if (!pari) return;
    const pts = pointsParPari[d.pari] || {};
    const issue = issueDuel(d, pari.statut === "resolu" ? "resolu" : "autre", (id) => pts[id] || 0);
    [d.lanceur, d.adversaire].forEach((id) => {
      if (!bilanDuels[id]) return;
      if (issue.statut === "en_cours") bilanDuels[id].enCours++;
      else if (issue.statut === "nul") bilanDuels[id].nuls++;
      else if (issue.gagnant === id) bilanDuels[id].gagnes++;
      else bilanDuels[id].perdus++;
    });
  });

  const trophees = calculerTrophees(joueurs, listeJoueurs, paris, parisParId, pronos, bilanDuels, maintenant);
  const termine = paris.length > 0 && paris.every((p) => p.statut === "resolu" || p.statut === "brouillon") &&
    paris.some((p) => p.phase === "second_tour" && p.statut === "resolu");

  return { joueurs: listeJoueurs, guildes: listeGuildes, evolution: evolution, duels: bilanDuels, trophees: trophees, termine: termine };
}

function meilleurs(valeurs, joueursParId, sens, minimum) {
  // valeurs : { idJoueur: nombre }. sens "max" ou "min". On ignore les valeurs nulles ou sous le minimum.
  let meilleur = null;
  Object.keys(valeurs).forEach((id) => {
    const v = valeurs[id];
    if (v === null || v === undefined || !isFinite(v)) return;
    if (minimum !== undefined && v < minimum) return;
    if (meilleur === null || (sens === "max" ? v > meilleur : v < meilleur)) meilleur = v;
  });
  if (meilleur === null) return { gagnants: [], valeur: null };
  const gagnants = Object.keys(valeurs)
    .filter((id) => valeurs[id] === meilleur && joueursParId[id])
    .map((id) => ({ id: id, pseudo: joueursParId[id].pseudo }));
  return { gagnants: gagnants, valeur: meilleur };
}

function calculerTrophees(joueurs, listeJoueurs, paris, parisParId, pronos, bilanDuels, maintenant) {
  const joueursParId = {};
  joueurs.forEach((j) => { joueursParId[j.id] = j; });
  const actifs = {};
  pronos.forEach((p) => { actifs[p.joueur] = true; });

  const champion = {};
  const boulet = {};
  listeJoueurs.forEach((j) => {
    if (!actifs[j.id]) return;
    champion[j.id] = j.points;
    boulet[j.id] = j.points;
  });
  const auMoinsUnResolu = paris.some((p) => p.statut === "resolu");

  const visionnaire = {};
  const sniper = {};
  const girouette = {};
  const kamikaze = {};
  const retardataire = {};
  const mouton = {};
  const decu = {};

  // Majorité par pari à choix clos.
  const majorite = {};
  paris.forEach((p) => {
    if (p.type !== "choix") return;
    const etat = etatPari(p, maintenant);
    if (etat !== "clos" && etat !== "resolu") return;
    const compte = {};
    pronos.forEach((pr) => {
      if (pr.pari === p.id && pr.reponse && pr.reponse.option) compte[pr.reponse.option] = (compte[pr.reponse.option] || 0) + 1;
    });
    let max = 0;
    Object.keys(compte).forEach((id) => { if (compte[id] > max) max = compte[id]; });
    majorite[p.id] = Object.keys(compte).filter((id) => compte[id] === max && max > 1);
  });

  pronos.forEach((pr) => {
    const p = parisParId[pr.pari];
    if (!p || !pr.reponse) return;
    const j = pr.joueur;
    const etat = etatPari(p, maintenant);
    // Tant qu'un pari est ouvert, les trophées n'en tiennent pas compte : un compteur qui bouge
    // (Kamikaze, Girouette) trahirait ce qu'un joueur vient de parier avant la clôture.
    if (etat !== "clos" && etat !== "resolu") return;
    girouette[j] = (girouette[j] || 0) + pr.modifs;

    const cloture = dateMs(p.cloture);
    const maj = dateMs(pr.maj);
    if (maj && cloture - maj <= 3600 * 1000 && cloture - maj >= 0) retardataire[j] = (retardataire[j] || 0) + 1;

    // Kamikaze : réponses sur des probabilités inférieures à 10 %.
    const options = p.options || [];
    const pctDe = (id) => { const o = trouverOption(options, id); return o && o.pct !== null ? Number(o.pct) : null; };
    if (p.type === "choix") {
      const pct = pctDe(pr.reponse.option);
      if (pct !== null && pct < 10) kamikaze[j] = (kamikaze[j] || 0) + 1;
    } else if (p.type === "classement") {
      (pr.reponse.ordre || []).forEach((id) => { const pct = pctDe(id); if (pct !== null && pct < 10) kamikaze[j] = (kamikaze[j] || 0) + 1; });
    } else if (p.type === "oui_non") {
      const reps = pr.reponse.reponses || {};
      Object.keys(reps).forEach((id) => {
        const pct = pctDe(id);
        if (pct === null) return;
        if ((reps[id] === "oui" && pct < 10) || (reps[id] === "non" && pct > 90)) kamikaze[j] = (kamikaze[j] || 0) + 1;
      });
    }

    if (p.type === "choix" && majorite[p.id] && majorite[p.id].indexOf(pr.reponse.option) >= 0) mouton[j] = (mouton[j] || 0) + 1;

    if (p.statut !== "resolu" || !p.resultat) return;

    // Visionnaire : la bonne réponse avec la plus faible probabilité.
    let plusRare = null;
    const garder = (pct) => { if (pct !== null && (plusRare === null || pct < plusRare)) plusRare = pct; };
    if (p.type === "choix" && pr.reponse.option === p.resultat.option) garder(pctDe(pr.reponse.option));
    if (p.type === "classement") {
      (pr.reponse.ordre || []).forEach((id, i) => { if ((p.resultat.ordre || [])[i] === id) garder(pctDe(id)); });
    }
    if (p.type === "oui_non") {
      const reps = pr.reponse.reponses || {};
      const oui = p.resultat.oui || [];
      Object.keys(reps).forEach((id) => {
        const pct = pctDe(id);
        if (pct === null) return;
        if (reps[id] === "oui" && oui.indexOf(id) >= 0) garder(pct);
        if (reps[id] === "non" && oui.indexOf(id) < 0) garder(100 - pct);
      });
    }
    if (plusRare !== null && (visionnaire[j] === undefined || plusRare < visionnaire[j])) visionnaire[j] = plusRare;

    if (p.type === "estimation") sniper[j] = (sniper[j] || 0) + pr.points;

    // Grand Déçu : le candidat souhaité au 1er tour qui a fait le plus petit score.
    if (p.type === "vote" && p.phase === "premier_tour" && pr.reponse.voudrais) {
      const pcts = p.resultat.pourcentages || {};
      const v = pcts[pr.reponse.voudrais];
      if (v !== undefined && isFinite(Number(v))) decu[j] = Number(v);
    }
  });

  const t = [];
  const ajouter = (cle, nom, description, res, detail) => {
    t.push({ cle: cle, nom: nom, description: description, gagnants: res.gagnants, valeur: res.valeur, detail: res.valeur === null ? "" : detail(res.valeur) });
  };
  const pluriel = (n, mot) => n + " " + mot + (n > 1 ? "s" : "");

  ajouter("champion", "Le Champion", "Le plus de points au classement général.",
    auMoinsUnResolu ? meilleurs(champion, joueursParId, "max") : { gagnants: [], valeur: null }, (v) => pluriel(v, "point"));
  ajouter("boulet", "Le Boulet d’or", "Le moins de points au classement général.",
    auMoinsUnResolu ? meilleurs(boulet, joueursParId, "min") : { gagnants: [], valeur: null }, (v) => pluriel(v, "point"));
  ajouter("decu", "Le Grand Déçu", "Son candidat de cœur du 1er tour a fait le plus petit score.",
    meilleurs(decu, joueursParId, "min"), (v) => String(v).replace(".", ",") + " % pour son candidat de cœur");
  ajouter("visionnaire", "Le Visionnaire", "A trouvé la bonne réponse la moins probable.",
    meilleurs(visionnaire, joueursParId, "min"), (v) => "bonne réponse donnée à " + v + " %");
  ajouter("sniper", "Le Sniper", "Le plus de points sur les paris d’estimation.",
    meilleurs(sniper, joueursParId, "max", 1), (v) => pluriel(v, "point"));
  ajouter("duelliste", "Le Duelliste", "Le plus de duels gagnés.",
    meilleurs(Object.keys(bilanDuels).reduce((o, id) => { o[id] = bilanDuels[id].gagnes; return o; }, {}), joueursParId, "max", 1),
    (v) => pluriel(v, "duel") + " " + (v > 1 ? "gagnés" : "gagné"));
  ajouter("kamikaze", "Le Kamikaze", "Le plus de réponses sur des probabilités de moins de 10 %.",
    meilleurs(kamikaze, joueursParId, "max", 1), (v) => pluriel(v, "réponse"));
  ajouter("girouette", "La Girouette", "Le plus de paris modifiés avant la clôture.",
    meilleurs(girouette, joueursParId, "max", 1), (v) => pluriel(v, "modification"));
  ajouter("mouton", "Le Mouton", "Le plus souvent du même avis que la majorité du groupe.",
    meilleurs(mouton, joueursParId, "max", 1), (v) => v + " fois");
  ajouter("retardataire", "Le Retardataire", "Le plus de paris posés dans la dernière heure avant la clôture.",
    meilleurs(retardataire, joueursParId, "max", 1), (v) => pluriel(v, "pari"));
  return t;
}

// ---------- Accès aux données ----------

function trouver(collection, filtre, params) {
  try {
    return $app.findFirstRecordByFilter(collection, filtre, params || {});
  } catch (err) {
    return null;
  }
}

function tous(collection, filtre, tri, params) {
  return $app.findRecordsByFilter(collection, filtre || "id != ''", tri || "", 0, 0, params || {});
}

function exigerAdmin(e) {
  if (!e.auth || e.auth.getString("role") !== "admin") throw new ForbiddenError("Réservé à l’administration du jeu.");
}

// JSON avec les clés triées, pour comparer deux réponses sans tenir compte de l'ordre des clés.
function stable(valeur) {
  if (Array.isArray(valeur)) return "[" + valeur.map(stable).join(",") + "]";
  if (valeur && typeof valeur === "object") {
    return "{" + Object.keys(valeur).sort().map((k) => JSON.stringify(k) + ":" + stable(valeur[k])).join(",") + "}";
  }
  return JSON.stringify(valeur === undefined ? null : valeur);
}

function recalculerPoints(app, pariRec) {
  const p = pariDepuisRecord(pariRec);
  const recs = app.findRecordsByFilter("pronos", "pari = {:p}", "", 0, 0, { p: p.id });
  recs.forEach((r) => {
    const pts = p.statut === "resolu" && p.resultat ? calculerPoints(p, lireJSON(r, "reponse", null), p.resultat) : 0;
    if (r.getFloat("points") !== pts) {
      r.set("points", pts);
      app.save(r);
    }
  });
  return recs.length;
}

function guildeDepuisRecord(g) {
  return { id: g.id, nom: g.getString("nom"), couleur: g.getString("couleur") };
}

function candidatDepuisRecord(c) {
  return { id: c.id, nom: c.getString("nom"), parti: c.getString("parti"), statut: c.getString("statut") };
}

function duelDepuisRecord(d) {
  return { id: d.id, lanceur: d.getString("lanceur"), adversaire: d.getString("adversaire"), pari: d.getString("pari"), cree: versISO(d.getString("created")) };
}

module.exports = {
  TYPES, PHASES, STATUTS_CANDIDAT,
  lireJSON, dateMs, versISO, erreur,
  pariDepuisRecord, pronoDepuisRecord, joueurDepuisRecord,
  etatPari, estDevoile, pointsProba, calculerPoints,
  normaliserReponse, normaliserResultat, normaliserPari, verifierModifPari,
  statistiques, issueDuel, classementComplet,
  trouver, tous, exigerAdmin, stable, recalculerPoints,
  guildeDepuisRecord, candidatDepuisRecord, duelDepuisRecord,
};
