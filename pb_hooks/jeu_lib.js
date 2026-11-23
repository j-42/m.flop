// Monsieur Flop : logique du jeu, partagée par toutes les routes de main.pb.js.
// Toutes les règles de calcul des points sont ici, et sont décrites dans la page « Règles » de l'application.

const TYPES = ["choix", "oui_non", "classement", "estimation", "vote", "scores"];
const PHASES = ["campagne", "parrainages", "premier_tour", "second_tour"];
const STATUTS_CANDIDAT = ["declare", "officiel", "non_retenu", "retire"];

// Points gagnés par le vainqueur d'un duel. Le perdant ne perd rien. Un joueur lance un seul duel par pari.
const BONUS_DUEL = 20;
// Une réponse rapporte au plus ce nombre de points (avant coefficient) : au-delà, le classement
// se jouerait à la loterie sur les outsiders à 1 ou 2 %. Le plafond s'applique sous 3,4 % environ.
const PLAFOND_POINTS = 300;
// Écart toléré, en points de pourcentage, entre la somme des probabilités et 100 % (par place pour un classement).
const TOLERANCE_SOMME = 5;

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

// 10 ÷ probabilité, plafonné : 50 % → 20 points, 10 % → 100 points, 1 % → 300 points (au lieu de 1000).
function pointsProba(pct) {
  const p = Math.min(99, Math.max(1, Number(pct) || 50));
  return Math.min(PLAFOND_POINTS, Math.round(1000 / p));
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
  } else if (pari.type === "scores") {
    // Moyenne, candidat par candidat, de « 100 moins la pente par point d'écart » : au plus 100 points.
    const pente = Number(pari.config.pente) || 10;
    const reels = resultat.valeurs || {};
    const donnes = reponse.valeurs || {};
    let total = 0;
    let n = 0;
    options.forEach((o) => {
      const reel = Number(reels[o.id]);
      if (reels[o.id] === undefined || reels[o.id] === null || !isFinite(reel)) return;
      n++;
      const v = Number(donnes[o.id]);
      if (donnes[o.id] === undefined || donnes[o.id] === null || !isFinite(v)) return;
      total += Math.max(0, 100 - pente * Math.abs(v - reel));
    });
    brut = n ? Math.round(total / n) : 0;
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
  if (pari.type === "scores") {
    const valeurs = {};
    const src = r.valeurs || {};
    (pari.options || []).forEach((o) => {
      const brut = src[o.id];
      const v = Number(String(brut).replace(",", "."));
      if (brut === "" || brut === null || brut === undefined || !isFinite(v)) throw erreur("Donne un score pour « " + o.label + " ».");
      if (v < 0 || v > 100) throw erreur("Le score de « " + o.label + " » doit être entre 0 et 100 %.");
      valeurs[o.id] = arrondir(v, 1);
    });
    if (!Object.keys(valeurs).length) throw erreur("Il n'y a aucun nom dans ce pari.");
    return { valeurs: valeurs };
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
  if (pari.type === "scores") {
    const valeurs = {};
    const src = r.valeurs || {};
    (pari.options || []).forEach((o) => {
      const v = Number(String(src[o.id]).replace(",", "."));
      if (src[o.id] === "" || src[o.id] === null || src[o.id] === undefined || !isFinite(v)) throw erreur("Indique le score réel de « " + o.label + " ».");
      valeurs[o.id] = v;
    });
    return { valeurs: valeurs };
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
      options.push({ id: id, label: label, pct: b.type === "scores" || b.type === "vote" ? null : pct });
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
  if (b.type === "scores") {
    config.unite = "%";
    config.pente = Number(String(cfg.pente || 10).replace(",", "."));
    if (!isFinite(config.pente) || config.pente <= 0) throw erreur("Les points perdus par point d'écart doivent être positifs.");
  }
  // Pari relié au tableau des candidats : ses réponses, ses cotes et son résultat en viennent.
  if (cfg.lien) {
    const lien = LIENS[cfg.lien];
    if (!lien) throw erreur("Lien inconnu avec le tableau des candidats.");
    if (lien.type !== b.type) throw erreur("« " + lien.nom + " » demande un pari de type " + NOMS_TYPES[lien.type] + ".");
    config.lien = cfg.lien;
  }

  if (statut === "publie") {
    if (b.type === "choix" && options.length < 2) throw erreur("Un pari à choix doit proposer au moins deux réponses.");
    if (b.type === "oui_non" && options.length < 1) throw erreur("Ajoute au moins un nom.");
    if (b.type === "classement" && options.length < config.places) throw erreur("Il faut au moins " + config.places + " noms pour ce classement.");
    if (b.type === "vote" && options.length < 1) throw erreur("Ajoute au moins une réponse possible.");
    if (b.type === "scores" && options.length < 1) throw erreur("Ajoute au moins un nom.");
    if (b.type === "choix" || b.type === "oui_non" || b.type === "classement") {
      options.forEach((o) => {
        if (o.pct === null) {
          throw erreur(config.lien
            ? "« " + o.label + " » n'a pas de cote : complète le tableau des candidats avant de publier."
            : "Indique la probabilité de « " + o.label + " » avant de publier.");
        }
      });
    }
    // Une seule réponse est juste : les probabilités doivent faire 100 %. Pour un classement, chaque place
    // est occupée par un nom : elles font 100 % par place. Sinon les gains affichés seraient faux.
    // Les cotes d'un pari relié sont calculées par le jeu : leur somme peut dépasser 100 % de quelques points,
    // parce qu'aucune cote ne descend sous 1 %.
    if ((b.type === "choix" || b.type === "classement") && !config.lien) {
      const attendu = b.type === "choix" ? 100 : 100 * config.places;
      const tolerance = b.type === "choix" ? TOLERANCE_SOMME : TOLERANCE_SOMME * config.places;
      const somme = Math.round(options.reduce((s, o) => s + Number(o.pct), 0) * 10) / 10;
      if (Math.abs(somme - attendu) > tolerance) {
        throw erreur("Les probabilités font " + String(somme).replace(".", ",") + " % au total : il faut environ " + attendu + " %" +
          (b.type === "classement" ? " (100 % par place)" : "") + ", à " + tolerance + " points près.");
      }
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
  if (pari.type === "scores") return Object.keys(r.valeurs || {});
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

  // Dès le premier pari posé, ce qui compte pour les points est figé : l'admin, qui joue aussi,
  // ne peut plus changer les gains d'un pari après avoir vu partir les mises.
  const deja = "Des joueurs ont déjà parié : ";
  if (Math.abs(Number(nouveau.coef) - Number(actuel.coef)) > 1e-9) throw erreur(deja + "le coefficient ne peut plus changer.");
  const cfgA = actuel.config || {};
  const cfgN = nouveau.config || {};
  ["pente", "places", "sens", "lien"].forEach((k) => {
    if (cfgA[k] === undefined && cfgN[k] === undefined) return;
    if (String(cfgA[k]) !== String(cfgN[k])) throw erreur(deja + "le barème ne peut plus changer.");
  });
  (nouveau.options || []).forEach((o) => {
    const a = avant[o.id];
    if (a && !memePct(a.pct, o.pct)) throw erreur(deja + "la probabilité de « " + o.label + " » ne peut plus changer.");
  });

  const clos = maintenant >= dateMs(actuel.cloture);
  // Sur un pari à choix ou un classement, les probabilités font 100 % ensemble : une nouvelle réponse
  // obligerait à baisser les autres, qui sont figées. Sur un oui ou non, chaque nom est indépendant.
  const ajoutPossible = !clos && (actuel.type === "oui_non" || actuel.type === "vote");
  (nouveau.options || []).forEach((o) => {
    if (avant[o.id]) return;
    if (!ajoutPossible) throw erreur(deja + "on ne peut plus ajouter de réponse à ce pari (« " + o.label + " »).");
  });

  if (!clos) return;
  // Après la clôture, les pronos sont dévoilés : le pari ne peut pas être rouvert, ni sa liste changer.
  if (dateMs(nouveau.cloture) > maintenant) throw erreur("Ce pari est clos et les pronos ont été dévoilés : il ne peut pas être rouvert.");
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
  } else if (pari.type === "scores") {
    const sommes = {};
    const nbs = {};
    pronos.forEach((p) => {
      const v = (p.reponse && p.reponse.valeurs) || {};
      Object.keys(v).forEach((id) => {
        sommes[id] = (sommes[id] || 0) + Number(v[id]);
        nbs[id] = (nbs[id] || 0) + 1;
      });
    });
    stats.moyennes = {};
    Object.keys(sommes).forEach((id) => { stats.moyennes[id] = arrondir(sommes[id] / nbs[id], 1); });
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

// aParie(id) : ce joueur a-t-il un prono sur le pari du duel ?
// Un duel où l'un des deux n'a pas parié est annulé : sinon, défier tous les joueurs inactifs
// donnerait des victoires sans risque. Tant que le pari n'est pas résolu, le duel reste « en cours »
// pour tout le monde, afin de ne pas révéler qui a parié.
function issueDuel(duel, pariEtat, pointsDe, aParie) {
  if (pariEtat !== "resolu") return { statut: "en_cours" };
  if (!aParie(duel.lanceur) || !aParie(duel.adversaire)) return { statut: "annule" };
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

  // Bonus des duels gagnés, compté avec le pari du duel.
  const bonusParPari = {};
  duels.forEach((d) => {
    const pari = parisParId[d.pari];
    if (!pari || pari.statut !== "resolu") return;
    const pts = pointsParPari[d.pari] || {};
    const issue = issueDuel(d, "resolu", (id) => pts[id] || 0, (id) => pts[id] !== undefined);
    if (issue.statut !== "termine" || totaux[issue.gagnant] === undefined) return;
    totaux[issue.gagnant] += BONUS_DUEL;
    parPhase[issue.gagnant][pari.phase] = (parPhase[issue.gagnant][pari.phase] || 0) + BONUS_DUEL;
    if (!bonusParPari[d.pari]) bonusParPari[d.pari] = {};
    bonusParPari[d.pari][issue.gagnant] = (bonusParPari[d.pari][issue.gagnant] || 0) + BONUS_DUEL;
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
    const bonus = bonusParPari[p.id] || {};
    joueurs.forEach((j) => {
      cumul[j.id] += (pts[j.id] || 0) + (bonus[j.id] || 0);
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
    // pointsParPari ne contient que les joueurs qui ont un prono sur ce pari résolu.
    const issue = issueDuel(d, pari.statut === "resolu" ? "resolu" : "autre", (id) => pts[id] || 0, (id) => pts[id] !== undefined);
    if (issue.statut === "annule") return;
    [d.lanceur, d.adversaire].forEach((id) => {
      if (!bilanDuels[id]) return;
      if (issue.statut === "en_cours") bilanDuels[id].enCours++;
      else if (issue.statut === "nul") bilanDuels[id].nuls++;
      else if (issue.gagnant === id) bilanDuels[id].gagnes++;
      else bilanDuels[id].perdus++;
    });
  });

  const trophees = calculerTrophees(joueurs, listeJoueurs, paris, parisParId, pronos, bilanDuels, maintenant);
  // Le bonus des duels a déjà été ajouté aux totaux, plus haut.
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

    if (p.type === "estimation" || p.type === "scores") sniper[j] = (sniper[j] || 0) + pr.points;

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
  ajouter("sniper", "Le Sniper", "Le plus de points sur les paris d’estimation et de scores.",
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

// ---------- Tableau des candidats : cotes calculées, paris reliés, résultats déduits ----------
//
// L'admin tient un seul tableau : pour chaque candidat, son statut, sa cote pour les 500 signatures,
// ses intentions de vote aux deux tours, puis ses scores réels. Plus le vote blanc et l'abstention réels.
// Les paris « reliés » (config.lien) en tirent leurs réponses, leurs cotes et leur résultat.

// Bords politiques, pour les sons. « autre » regroupe aussi les souverainistes.
const BORDS = ["extreme_gauche", "gauche", "ecolo", "centre", "droite", "extreme_droite", "autre"];
const BORD_SOURCE = { gauche: "gauche", ecolo: "ecolo", centre: "centre", droite: "droite", extdroite: "extreme_droite", souverainiste: "autre", autre: "autre" };
// La source classe l'extrême gauche avec la gauche : on la repère par le parti.
const PARTIS_EXTREME_GAUCHE = /lutte ouvri|npa|r[ée]volution permanente|parti ouvrier ind[ée]pendant/i;

const NOMS_TYPES = { choix: "Un seul choix", oui_non: "Oui ou non", classement: "Classement", estimation: "Estimation", vote: "Mon vote", scores: "Scores" };
const BLANC = { id: "x_blanc", label: "Vote blanc" };
const ABSTENTION = { id: "x_abstention", label: "Abstention" };

// Écart type de l'erreur des sondages, en points, selon l'intention de vote : environ 4 points
// pour un candidat à 30 %, 1 point pour un candidat à 4 %.
function ecartTypeSondage(intention) {
  return 0.5 + 0.12 * intention;
}
const TIRAGES = 10000;
// Écart type, en points, de la part du premier finaliste au 2nd tour.
const ECART_TYPE_T2 = 3.5;

function nombreOuNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return isFinite(n) ? n : null;
}

// Générateur pseudo-aléatoire à graine fixe : les mêmes intentions donnent toujours les mêmes cotes.
function generateur(graine) {
  let a = graine >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ramène des probabilités entre 1 et 99 % en gardant leur somme égale à la cible (100, ou 300 pour 3 places).
function ajusterSomme(valeurs, cible) {
  const ids = Object.keys(valeurs);
  const v = {};
  ids.forEach((id) => { v[id] = Math.max(0, Number(valeurs[id]) || 0); });
  const fixe = {};
  for (let tour = 0; tour < 30; tour++) {
    let sommeFixe = 0;
    let sommeLibre = 0;
    const libres = ids.filter((id) => !fixe[id]);
    ids.forEach((id) => { if (fixe[id]) sommeFixe += v[id]; else sommeLibre += v[id]; });
    if (!libres.length) break;
    const reste = cible - sommeFixe;
    libres.forEach((id) => { v[id] = sommeLibre > 0 ? (v[id] * reste) / sommeLibre : reste / libres.length; });
    let change = false;
    libres.forEach((id) => {
      if (v[id] < 1) { v[id] = 1; fixe[id] = true; change = true; }
      else if (v[id] > 99) { v[id] = 99; fixe[id] = true; change = true; }
    });
    if (!change) break;
  }
  const sortie = {};
  ids.forEach((id) => { sortie[id] = arrondir(Math.min(99, Math.max(1, v[id])), 1); });
  return sortie;
}

// Simulation du 1er tour à partir des intentions de vote. Renvoie, pour chaque candidat, ses chances
// d'arriver en tête, d'être qualifié, d'être sur le podium, dans le flop 3, et d'être dernier.
function cotesPremierTour(liste) {
  const n = liste.length;
  const vide = { premier: {}, qualifie: {}, podium: {}, flop: {}, dernier: {} };
  if (!n) return vide;
  const mu = liste.map((c) => { const x = nombreOuNull(c.intention); return x === null ? 0.5 : Math.max(0, x); });
  const sigma = mu.map(ecartTypeSondage);
  const compte = { premier: new Array(n).fill(0), qualifie: new Array(n).fill(0), podium: new Array(n).fill(0), flop: new Array(n).fill(0), dernier: new Array(n).fill(0) };
  const alea = generateur(2027);
  const scores = new Array(n);
  const ordre = new Array(n);
  for (let t = 0; t < TIRAGES; t++) {
    for (let i = 0; i < n; i++) {
      // Loi normale par la méthode de Box-Muller.
      const u = 1 - alea();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * alea());
      scores[i] = Math.max(0, mu[i] + sigma[i] * z) + alea() * 1e-6;
      ordre[i] = i;
    }
    ordre.sort((a, b) => scores[b] - scores[a]);
    compte.premier[ordre[0]]++;
    for (let k = 0; k < Math.min(2, n); k++) compte.qualifie[ordre[k]]++;
    for (let k = 0; k < Math.min(3, n); k++) compte.podium[ordre[k]]++;
    for (let k = Math.max(0, n - 3); k < n; k++) compte.flop[ordre[k]]++;
    compte.dernier[ordre[n - 1]]++;
  }
  const cibles = { premier: 100, qualifie: 100 * Math.min(2, n), podium: 100 * Math.min(3, n), flop: 100 * Math.min(3, n), dernier: 100 };
  const sortie = {};
  Object.keys(compte).forEach((k) => {
    const brut = {};
    liste.forEach((c, i) => { brut[c.id] = (100 * compte[k][i]) / TIRAGES; });
    sortie[k] = ajusterSomme(brut, cibles[k]);
  });
  return sortie;
}

// Fonction de répartition de la loi normale (approximation d'Abramowitz et Stegun).
function repartitionNormale(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// Chances de gagner le 2nd tour, d'après les intentions de vote des deux finalistes.
function cotesSecondTour(a, b) {
  const ia = nombreOuNull(a.intention_t2);
  const ib = nombreOuNull(b.intention_t2);
  if (ia === null || ib === null || ia + ib <= 0) return null;
  const part = (100 * ia) / (ia + ib);
  const pa = arrondir(Math.min(99, Math.max(1, 100 * repartitionNormale((part - 50) / ECART_TYPE_T2))), 1);
  const sortie = {};
  sortie[a.id] = pa;
  sortie[b.id] = arrondir(100 - pa, 1);
  return sortie;
}

function scrutinParDefaut() {
  return {
    liste_officielle: false, resultats_t1: false, resultats_t2: false,
    t1: { abstention: null, blanc: null }, t2: { abstention: null, blanc: null },
    sondage: null,
  };
}

function lireScrutin(app) {
  let rec = null;
  try { rec = app.findFirstRecordByFilter("reglages", "cle = 'scrutin'"); } catch (err) { rec = null; }
  const s = Object.assign(scrutinParDefaut(), rec ? lireJSON(rec, "valeur", {}) || {} : {});
  s.t1 = Object.assign({ abstention: null, blanc: null }, s.t1 || {});
  s.t2 = Object.assign({ abstention: null, blanc: null }, s.t2 || {});
  return s;
}

function ecrireScrutin(app, s) {
  let rec = null;
  try { rec = app.findFirstRecordByFilter("reglages", "cle = 'scrutin'"); } catch (err) { rec = null; }
  if (!rec) {
    rec = new Record(app.findCollectionByNameOrId("reglages"));
    rec.set("cle", "scrutin");
  }
  rec.set("valeur", s);
  app.save(rec);
}

function donneesCandidat(rec) {
  const d = lireJSON(rec, "donnees", {}) || {};
  return {
    cote_parrainages: nombreOuNull(d.cote_parrainages),
    intention_t1: nombreOuNull(d.intention_t1),
    intention_t2: nombreOuNull(d.intention_t2),
    score_t1: nombreOuNull(d.score_t1),
    score_t2: nombreOuNull(d.score_t2),
    bord: BORDS.indexOf(d.bord) >= 0 ? d.bord : "",
  };
}

// Tout ce qu'il faut pour relier les paris au tableau. Les cotes sont calculées à la demande.
function contexteTableau(app) {
  const candidats = app.findRecordsByFilter("candidats", "id != ''", "nom", 0, 0).map((r) =>
    Object.assign({ id: r.id, nom: r.getString("nom"), parti: r.getString("parti"), statut: r.getString("statut") }, donneesCandidat(r)));
  const scrutin = lireScrutin(app);
  const ctx = { app: app, candidats: candidats, scrutin: scrutin, _cache: {} };
  return ctx;
}

// Les candidats du 1er tour : ceux de la liste officielle dès qu'il y en a, sinon les déclarés.
function candidatsPremierTour(ctx) {
  const officiels = ctx.candidats.filter((c) => c.statut === "officiel");
  if (officiels.length || ctx.scrutin.liste_officielle) return officiels;
  return ctx.candidats.filter((c) => c.statut === "declare");
}

// Classement réel du 1er tour : les candidats qui ont un score, du plus haut au plus bas.
function classementReel(liste, champ) {
  return liste.filter((c) => c[champ] !== null).slice().sort((a, b) => b[champ] - a[champ]);
}

function finalistes(ctx) {
  const ordre = classementReel(candidatsPremierTour(ctx), "score_t1");
  return ordre.length >= 2 ? ordre.slice(0, 2) : [];
}

// La simulation prend une seconde ou plus sur un petit serveur : son résultat est gardé dans « reglages »
// et réutilisé tant que la liste des candidats du 1er tour et leurs intentions ne changent pas.
function cotesT1(ctx) {
  if (ctx._cache.t1) return ctx._cache.t1;
  const liste = candidatsPremierTour(ctx).map((c) => ({ id: c.id, intention: c.intention_t1 }));
  const cle = "v1|" + TIRAGES + "|" + liste.map((c) => c.id + ":" + (c.intention === null ? "" : c.intention)).join(",");
  let rec = null;
  if (ctx.app) {
    try { rec = ctx.app.findFirstRecordByFilter("reglages", "cle = 'cache_cotes'"); } catch (err) { rec = null; }
    const v = rec ? lireJSON(rec, "valeur", null) : null;
    if (v && v.cle === cle && v.cotes) { ctx._cache.t1 = v.cotes; return v.cotes; }
  }
  const cotes = cotesPremierTour(liste);
  ctx._cache.t1 = cotes;
  if (ctx.app) {
    try {
      if (!rec) {
        rec = new Record(ctx.app.findCollectionByNameOrId("reglages"));
        rec.set("cle", "cache_cotes");
      }
      rec.set("valeur", { cle: cle, cotes: cotes });
      ctx.app.save(rec);
    } catch (err) { /* le cache est facultatif */ }
  }
  return cotes;
}

function optionsCandidats(liste, cotes) {
  return liste.map((c) => ({ id: c.id, label: c.nom, pct: cotes ? (cotes[c.id] === undefined ? null : cotes[c.id]) : null }));
}

function valeursScores(liste, champ) {
  const v = {};
  for (let i = 0; i < liste.length; i++) {
    if (liste[i][champ] === null) return null;
    v[liste[i].id] = liste[i][champ];
  }
  return liste.length ? v : null;
}

function pourcentagesVote(liste, champ, tour) {
  const p = {};
  liste.forEach((c) => { if (c[champ] !== null) p[c.id] = c[champ]; });
  if (tour.blanc !== null && tour.blanc !== undefined) p[BLANC.id] = tour.blanc;
  if (tour.abstention !== null && tour.abstention !== undefined) p[ABSTENTION.id] = tour.abstention;
  return p;
}

function valeurTour(ctx, tour, champ, drapeau) {
  if (!ctx.scrutin[drapeau]) return null;
  const v = nombreOuNull(ctx.scrutin[tour][champ]);
  return v === null ? null : { valeur: v };
}

// options(ctx) : les réponses possibles, avec leur cote (null si le lien ne fixe pas les réponses).
// resultat(ctx, pari) : le résultat officiel, ou null tant qu'il n'est pas connu.
const LIENS = {
  parrainages: {
    nom: "Les 500 signatures", type: "oui_non",
    options: (ctx) => ctx.candidats.filter((c) => c.statut === "declare" || c.statut === "officiel" || c.statut === "non_retenu")
      .map((c) => ({ id: c.id, label: c.nom, pct: c.cote_parrainages })),
    resultat: (ctx) => ctx.scrutin.liste_officielle ? { oui: ctx.candidats.filter((c) => c.statut === "officiel").map((c) => c.id) } : null,
  },
  nb_officiels: {
    nom: "Le nombre de candidats officiels", type: "estimation", options: null,
    resultat: (ctx) => ctx.scrutin.liste_officielle ? { valeur: ctx.candidats.filter((c) => c.statut === "officiel").length } : null,
  },
  podium_t1: {
    nom: "Le podium du 1er tour", type: "classement",
    options: (ctx) => optionsCandidats(candidatsPremierTour(ctx), cotesT1(ctx).podium),
    resultat: (ctx, p) => {
      if (!ctx.scrutin.resultats_t1) return null;
      const ids = (p.options || []).map((o) => o.id);
      const ordre = classementReel(ctx.candidats.filter((c) => ids.indexOf(c.id) >= 0), "score_t1");
      const places = Number(p.config.places) || 3;
      return ordre.length >= places ? { ordre: ordre.slice(0, places).map((c) => c.id) } : null;
    },
  },
  flop_t1: {
    nom: "Le flop 3 du 1er tour", type: "classement",
    options: (ctx) => optionsCandidats(candidatsPremierTour(ctx), cotesT1(ctx).flop),
    resultat: (ctx, p) => {
      if (!ctx.scrutin.resultats_t1) return null;
      const ids = (p.options || []).map((o) => o.id);
      const ordre = classementReel(ctx.candidats.filter((c) => ids.indexOf(c.id) >= 0), "score_t1").reverse();
      const places = Number(p.config.places) || 3;
      return ordre.length >= places ? { ordre: ordre.slice(0, places).map((c) => c.id) } : null;
    },
  },
  boulet_t1: {
    nom: "Le pire score du 1er tour", type: "choix",
    options: (ctx) => optionsCandidats(candidatsPremierTour(ctx), cotesT1(ctx).dernier),
    resultat: (ctx, p) => {
      if (!ctx.scrutin.resultats_t1) return null;
      const ids = (p.options || []).map((o) => o.id);
      const ordre = classementReel(ctx.candidats.filter((c) => ids.indexOf(c.id) >= 0), "score_t1");
      return ordre.length ? { option: ordre[ordre.length - 1].id } : null;
    },
  },
  en_tete_t1: {
    nom: "Le premier du 1er tour", type: "choix",
    options: (ctx) => optionsCandidats(candidatsPremierTour(ctx), cotesT1(ctx).premier),
    resultat: (ctx, p) => {
      if (!ctx.scrutin.resultats_t1) return null;
      const ids = (p.options || []).map((o) => o.id);
      const ordre = classementReel(ctx.candidats.filter((c) => ids.indexOf(c.id) >= 0), "score_t1");
      return ordre.length ? { option: ordre[0].id } : null;
    },
  },
  scores_t1: {
    nom: "Les scores du 1er tour", type: "scores",
    options: (ctx) => optionsCandidats(candidatsPremierTour(ctx), null),
    resultat: (ctx, p) => {
      if (!ctx.scrutin.resultats_t1) return null;
      const ids = (p.options || []).map((o) => o.id);
      const v = valeursScores(ctx.candidats.filter((c) => ids.indexOf(c.id) >= 0), "score_t1");
      return v ? { valeurs: v } : null;
    },
  },
  abstention_t1: { nom: "L’abstention au 1er tour", type: "estimation", options: null, resultat: (ctx) => valeurTour(ctx, "t1", "abstention", "resultats_t1") },
  participation_t1: {
    nom: "La participation au 1er tour", type: "estimation", options: null,
    resultat: (ctx) => { const v = valeurTour(ctx, "t1", "abstention", "resultats_t1"); return v ? { valeur: arrondir(100 - v.valeur, 2) } : null; },
  },
  blanc_t1: { nom: "Le vote blanc au 1er tour", type: "estimation", options: null, resultat: (ctx) => valeurTour(ctx, "t1", "blanc", "resultats_t1") },
  vote_t1: {
    nom: "Mon vote au 1er tour", type: "vote",
    options: (ctx) => optionsCandidats(candidatsPremierTour(ctx), null).concat([{ id: BLANC.id, label: BLANC.label, pct: null }, { id: ABSTENTION.id, label: ABSTENTION.label, pct: null }]),
    resultat: (ctx) => ctx.scrutin.resultats_t1 ? { pourcentages: pourcentagesVote(candidatsPremierTour(ctx), "score_t1", ctx.scrutin.t1) } : null,
  },
  elu: {
    nom: "L’élu au 2nd tour", type: "choix",
    options: (ctx) => {
      const f = finalistes(ctx);
      return optionsCandidats(f, f.length === 2 ? cotesSecondTour(f[0], f[1]) : null);
    },
    resultat: (ctx, p) => {
      if (!ctx.scrutin.resultats_t2) return null;
      const ids = (p.options || []).map((o) => o.id);
      const ordre = classementReel(ctx.candidats.filter((c) => ids.indexOf(c.id) >= 0), "score_t2");
      return ordre.length ? { option: ordre[0].id } : null;
    },
  },
  score_vainqueur_t2: {
    nom: "Le score de l’élu", type: "estimation", options: null,
    resultat: (ctx) => {
      if (!ctx.scrutin.resultats_t2) return null;
      const ordre = classementReel(finalistes(ctx), "score_t2");
      return ordre.length ? { valeur: ordre[0].score_t2 } : null;
    },
  },
  scores_t2: {
    nom: "Les scores du 2nd tour", type: "scores",
    options: (ctx) => optionsCandidats(finalistes(ctx), null),
    resultat: (ctx, p) => {
      if (!ctx.scrutin.resultats_t2) return null;
      const ids = (p.options || []).map((o) => o.id);
      const v = valeursScores(ctx.candidats.filter((c) => ids.indexOf(c.id) >= 0), "score_t2");
      return v ? { valeurs: v } : null;
    },
  },
  abstention_t2: { nom: "L’abstention au 2nd tour", type: "estimation", options: null, resultat: (ctx) => valeurTour(ctx, "t2", "abstention", "resultats_t2") },
  blanc_t2: { nom: "Le vote blanc au 2nd tour", type: "estimation", options: null, resultat: (ctx) => valeurTour(ctx, "t2", "blanc", "resultats_t2") },
  vote_t2: {
    nom: "Mon vote au 2nd tour", type: "vote",
    options: (ctx) => optionsCandidats(finalistes(ctx), null).concat([{ id: BLANC.id, label: BLANC.label, pct: null }, { id: ABSTENTION.id, label: ABSTENTION.label, pct: null }]),
    resultat: (ctx) => ctx.scrutin.resultats_t2 ? { pourcentages: pourcentagesVote(finalistes(ctx), "score_t2", ctx.scrutin.t2) } : null,
  },
};

// Les réponses d'un pari relié, d'après le tableau. Sans pronos, la liste et les cotes suivent le tableau.
// Avec des pronos, rien ne change, sauf sur un oui/non ou « Mon vote » encore ouvert : on peut y ajouter des noms.
function optionsReliees(pari, ctx, nbPronos, maintenant) {
  const lien = LIENS[(pari.config || {}).lien];
  if (!lien || !lien.options) return null;
  const cible = lien.options(ctx);
  if (!nbPronos) return cible;
  const clos = maintenant >= dateMs(pari.cloture);
  if (clos || (pari.type !== "oui_non" && pari.type !== "vote")) return pari.options;
  const deja = {};
  (pari.options || []).forEach((o) => { deja[o.id] = true; });
  const ajouts = cible.filter((o) => !deja[o.id] && (pari.type === "vote" || o.pct !== null));
  return (pari.options || []).concat(ajouts);
}

// Met à jour les réponses de tous les paris reliés, puis résout ceux dont le résultat est connu.
// resolutionSeule : sans recalcul des réponses ni des cotes (tâche planifiée, plus légère).
function synchroniserParis(app, resolutionSeule) {
  const ctx = contexteTableau(app);
  const maintenant = Date.now();
  const bilan = { majs: 0, resolus: 0, corriges: 0 };
  app.findRecordsByFilter("paris", "id != ''", "", 0, 0).forEach((rec) => {
    const p = pariDepuisRecord(rec);
    const lien = LIENS[(p.config || {}).lien];
    if (!lien || lien.type !== p.type) return;
    const nbPronos = app.countRecords("pronos", $dbx.exp("pari = {:p}", { p: p.id }));
    let change = false;
    if (p.statut !== "resolu" && !resolutionSeule) {
      const options = optionsReliees(p, ctx, nbPronos, maintenant);
      if (options && stable(options) !== stable(p.options)) {
        rec.set("options", options);
        p.options = options;
        change = true;
        bilan.majs++;
      }
    }
    // Résolution : seulement pour un pari publié et clos.
    let res = null;
    if (p.statut !== "brouillon" && maintenant >= dateMs(p.cloture)) {
      try {
        const brut = lien.resultat(ctx, p);
        res = brut ? normaliserResultat(p, brut) : null;
      } catch (err) {
        res = null;
      }
    }
    if (res && (p.statut !== "resolu" || stable(res) !== stable(p.resultat))) {
      if (p.statut === "resolu") bilan.corriges++;
      else bilan.resolus++;
      rec.set("resultat", res);
      rec.set("statut", "resolu");
      if (!rec.getString("resolu_le")) rec.set("resolu_le", new Date().toISOString());
      app.runInTransaction((tx) => {
        tx.save(rec);
        recalculerPoints(tx, rec);
      });
      return;
    }
    if (change) app.save(rec);
  });
  return bilan;
}

// Cotes calculées, pour l'affichage dans l'administration.
function cotesAffichees(ctx) {
  const t1 = cotesT1(ctx);
  const f = finalistes(ctx);
  return {
    premier: t1.premier, podium: t1.podium, flop: t1.flop, dernier: t1.dernier, qualifie: t1.qualifie,
    elu: f.length === 2 ? cotesSecondTour(f[0], f[1]) || {} : {},
    candidatsT1: candidatsPremierTour(ctx).map((c) => c.id),
    finalistes: f.map((c) => c.id),
  };
}

// Le nouveau nom d'un candidat est reporté dans les paris où il figure, y compris ceux qui ont des pronos.
function renommerDansParis(tx, id, nom) {
  tx.findRecordsByFilter("paris", "id != ''", "", 0, 0).forEach((pr) => {
    const options = lireJSON(pr, "options", []) || [];
    let change = false;
    options.forEach((o) => {
      if (o.id === id && o.label !== nom) {
        o.label = nom;
        change = true;
      }
    });
    if (change) {
      pr.set("options", options);
      tx.save(pr);
    }
  });
}

function etatTableau(app) {
  const ctx = contexteTableau(app);
  const paris = app.findRecordsByFilter("paris", "id != ''", "cloture", 0, 0).map(pariDepuisRecord)
    .filter((p) => p.config && p.config.lien)
    .map((p) => ({ id: p.id, titre: p.titre, lien: p.config.lien, statut: p.statut, cloture: p.cloture, nbOptions: (p.options || []).length,
      nbPronos: app.countRecords("pronos", $dbx.exp("pari = {:p}", { p: p.id })) }));
  const liens = {};
  Object.keys(LIENS).forEach((k) => { liens[k] = { nom: LIENS[k].nom, type: LIENS[k].type }; });
  return {
    candidats: ctx.candidats,
    scrutin: ctx.scrutin,
    cotes: cotesAffichees(ctx),
    paris: paris,
    liens: liens,
  };
}

// ---------- Import des intentions de vote ----------

// Source : le jeu de données ouvert de « 2027 et moi » (Licence ouverte), qui reprend les notices
// déposées à la Commission des sondages. Un fichier par sondage et par hypothèse, sur environ sept semaines.
const SOURCE_SONDAGES = "https://raw.githubusercontent.com/2027etmoi/2027etmoi/main/data/sondages.json";
const SOURCE_NOMS = "https://raw.githubusercontent.com/2027etmoi/2027etmoi/main/data/candidats.json";

function slug(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Moyenne par candidat : d'abord la moyenne des hypothèses de chaque sondage où il figure,
// puis la moyenne de ces sondages.
function moyennesSondages(donnees) {
  const parSondage = {};
  const sondages = (donnees && donnees.sondages) || [];
  sondages.forEach((s, i) => {
    const somme = {};
    const nb = {};
    (s.hypotheses || []).forEach((h) => {
      const sc = h.scores || {};
      Object.keys(sc).forEach((id) => {
        const v = Number(sc[id]);
        if (!isFinite(v)) return;
        somme[id] = (somme[id] || 0) + v;
        nb[id] = (nb[id] || 0) + 1;
      });
    });
    Object.keys(somme).forEach((id) => {
      if (!parSondage[id]) parSondage[id] = [];
      parSondage[id].push(somme[id] / nb[id]);
    });
  });
  const moyennes = {};
  Object.keys(parSondage).forEach((id) => {
    const l = parSondage[id];
    moyennes[id] = { valeur: arrondir(l.reduce((a, b) => a + b, 0) / l.length, 1), sondages: l.length };
  });
  const dates = sondages.map((s) => s.terrain_fin).filter(Boolean).sort();
  return { moyennes: moyennes, nb: sondages.length, du: dates[0] || "", au: dates[dates.length - 1] || "", mise_a_jour: (donnees && donnees.mise_a_jour) || "" };
}

// Rapproche un identifiant de la source (« le-pen ») d'un candidat du jeu (« Marine Le Pen »).
function rapprocher(idSource, nomSource, candidats) {
  const cibleNom = slug(nomSource);
  let trouve = candidats.find((c) => cibleNom && slug(c.nom) === cibleNom);
  if (!trouve) trouve = candidats.find((c) => slug(c.nom) === idSource || slug(c.nom).endsWith("-" + idSource));
  return trouve || null;
}

function lireReponseHttp(res) {
  if (res.statusCode !== 200) throw erreur("La source des sondages ne répond pas (code " + res.statusCode + ").");
  if (res.json) return res.json;
  return JSON.parse(toString(res.body));
}

function importerSondages(app) {
  let donnees;
  let noms = {};
  const blocsSource = {};
  try {
    donnees = lireReponseHttp($http.send({ url: SOURCE_SONDAGES, method: "GET", timeout: 30 }));
    try {
      const c = lireReponseHttp($http.send({ url: SOURCE_NOMS, method: "GET", timeout: 30 }));
      (c.candidats || []).forEach((x) => { noms[x.id] = x.nom; if (x.bloc) blocsSource[x.id] = x.bloc; });
    } catch (err) { noms = {}; }
  } catch (err) {
    throw erreur("Import impossible : le serveur du jeu n'arrive pas à joindre la source des sondages. " + (err && err.message ? err.message : ""));
  }
  Object.keys((donnees && donnees.noms_hors_liste) || {}).forEach((id) => { if (!noms[id]) noms[id] = donnees.noms_hors_liste[id]; });
  const m = moyennesSondages(donnees);
  const recs = app.findRecordsByFilter("candidats", "id != ''", "nom", 0, 0);
  const candidats = recs.map((r) => ({ id: r.id, nom: r.getString("nom"), rec: r }));
  const trouves = [];
  const horsTableau = [];
  const vus = {};
  Object.keys(m.moyennes).forEach((idSource) => {
    const c = rapprocher(idSource, noms[idSource] || "", candidats);
    if (!c) { horsTableau.push((noms[idSource] || idSource) + " (" + String(m.moyennes[idSource].valeur).replace(".", ",") + " %)"); return; }
    vus[c.id] = true;
    const d = lireJSON(c.rec, "donnees", {}) || {};
    d.intention_t1 = m.moyennes[idSource].valeur;
    c.rec.set("donnees", d);
    app.save(c.rec);
    trouves.push({ id: c.id, nom: c.nom, valeur: m.moyennes[idSource].valeur, sondages: m.moyennes[idSource].sondages });
  });
  const s = lireScrutin(app);
  s.sondage = { source: "2027 et moi, d'après les notices de la Commission des sondages", url: "https://github.com/2027etmoi/2027etmoi", mise_a_jour: m.mise_a_jour, importe_le: new Date().toISOString(), nb: m.nb, du: m.du, au: m.au };
  ecrireScrutin(app, s);
  // Bords politiques : seulement pour les candidats qui n'en ont pas encore.
  const blocs = {};
  Object.keys(noms).forEach((id) => { if (noms[id] && blocsSource[id]) blocs[id] = blocsSource[id]; });
  let bordsAjoutes = 0;
  candidats.forEach((c) => {
    const d = lireJSON(c.rec, "donnees", {}) || {};
    if (BORDS.indexOf(d.bord) >= 0) return;
    let bord = "";
    if (PARTIS_EXTREME_GAUCHE.test(c.rec.getString("parti"))) bord = "extreme_gauche";
    else {
      const idSource = Object.keys(blocs).find((id) => rapprocher(id, noms[id], [c]));
      if (idSource) bord = BORD_SOURCE[blocs[idSource]] || "";
    }
    if (!bord) return;
    d.bord = bord;
    c.rec.set("donnees", d);
    app.save(c.rec);
    bordsAjoutes++;
  });
  const sansSondage = recs.filter((r) => !vus[r.id] && (r.getString("statut") === "declare" || r.getString("statut") === "officiel")).map((r) => r.getString("nom"));
  return { trouves: trouves, horsTableau: horsTableau, sansSondage: sansSondage, bordsAjoutes: bordsAjoutes, sondage: s.sondage };
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
  return { id: c.id, nom: c.getString("nom"), parti: c.getString("parti"), statut: c.getString("statut"), bord: donneesCandidat(c).bord };
}

function duelDepuisRecord(d) {
  return { id: d.id, lanceur: d.getString("lanceur"), adversaire: d.getString("adversaire"), pari: d.getString("pari"), cree: versISO(d.getString("created")) };
}

module.exports = {
  TYPES, PHASES, STATUTS_CANDIDAT, PLAFOND_POINTS, BONUS_DUEL, BORDS,
  lireJSON, dateMs, versISO, erreur,
  pariDepuisRecord, pronoDepuisRecord, joueurDepuisRecord,
  etatPari, estDevoile, pointsProba, calculerPoints,
  normaliserReponse, normaliserResultat, normaliserPari, verifierModifPari,
  statistiques, issueDuel, classementComplet,
  trouver, tous, exigerAdmin, stable, recalculerPoints,
  guildeDepuisRecord, candidatDepuisRecord, duelDepuisRecord,
  NOMS_TYPES, LIENS, nombreOuNull, ajusterSomme, cotesPremierTour, cotesSecondTour, moyennesSondages, rapprocher, slug,
  renommerDansParis, etatTableau, lireScrutin, ecrireScrutin, donneesCandidat, contexteTableau, optionsReliees, synchroniserParis, cotesAffichees, importerSondages,
};
